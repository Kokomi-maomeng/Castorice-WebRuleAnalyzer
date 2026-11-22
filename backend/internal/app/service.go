// Package app hosts the same core service for desktop and development entry points.
package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/api"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

type Options struct {
	Address, DataDir, DevOrigin, PublicURL string
	AccessPasswordFile, BrowserPath        string
	Policy                                 security.Policy
	SaveExport                             func(string, string) (string, error)
}
type Service struct {
	URL       string
	Scans     *scanner.Manager
	Store     *storage.Store
	server    *http.Server
	cancel    context.CancelFunc
	done      chan error
	once      sync.Once
	rulesDone chan struct{}
	dataLock  io.Closer
	// AccessPasswordFile tells the operator where to find the password without logging it.
	AccessPasswordFile string
}

func Start(o Options) (*Service, error) {
	if err := browser.CheckSandboxUser(); err != nil {
		return nil, err
	}
	host, _, err := net.SplitHostPort(o.Address)
	if err != nil {
		return nil, err
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !ip.IsLoopback() && o.PublicURL == "" {
		return nil, errors.New("非回环监听需要显式设置 --public-url")
	}
	needsAccess := o.PublicURL != "" || o.AccessPasswordFile != ""
	if o.PublicURL != "" {
		u, e := url.Parse(o.PublicURL)
		if e != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
			return nil, errors.New("public-url 必须是精确的 HTTP(S) 来源，不能包含路径、凭据或查询")
		}
		originIP, _ := netip.ParseAddr(u.Hostname())
		if u.Scheme != "https" && !originIP.IsLoopback() && u.Hostname() != "localhost" {
			return nil, errors.New("远程访问的 --public-url 必须使用 HTTPS")
		}
	}
	if needsAccess && o.DevOrigin != "" {
		return nil, errors.New("启用访问认证时请从服务地址打开页面，不能同时启用 --dev-origin")
	}
	managedBrowser, err := browser.ManagedPath(o.BrowserPath)
	if err != nil {
		return nil, err
	}
	dataDir, err := storage.PrepareDataDir(o.DataDir)
	if err != nil {
		return nil, err
	}
	dataLock, err := storage.LockData(dataDir)
	if err != nil {
		return nil, err
	}
	started := false
	defer func() {
		if !started {
			_ = dataLock.Close()
		}
	}()
	listener, err := net.Listen("tcp", o.Address)
	if err != nil {
		return nil, err
	}
	defer func() {
		if !started {
			_ = listener.Close()
		}
	}()
	base := "http://" + listener.Addr().String()
	if o.PublicURL != "" {
		base = o.PublicURL
	}
	var accessFile string
	var accessHash *[32]byte
	if needsAccess {
		accessFile = o.AccessPasswordFile
		if accessFile == "" {
			accessFile = filepath.Join(dataDir, "access-password")
			if err = ensureAccessPassword(accessFile); err != nil {
				return nil, err
			}
		}
		accessHash, err = readAccessPassword(accessFile)
		if err != nil {
			return nil, err
		}
	}
	sessionDir := filepath.Join(dataDir, "sessions")
	resolvedSessions, err := storage.PrepareDataDir(sessionDir)
	if err != nil {
		return nil, err
	}
	if relative, e := filepath.Rel(dataDir, resolvedSessions); e != nil || !strings.EqualFold(relative, "sessions") {
		return nil, errors.New("临时浏览器目录必须位于数据目录中")
	}
	if err = scanner.CleanSessions(sessionDir); err != nil {
		return nil, err
	}
	store, err := storage.Open(filepath.Join(dataDir, "castorice.db"))
	if err != nil {
		return nil, err
	}
	rm, err := rules.NewManager(store)
	if err != nil {
		store.Close()
		return nil, err
	}
	scans := scanner.NewManager(store, rm, scanner.Engine{Policy: o.Policy, SessionDir: sessionDir, BrowserPath: managedBrowser})
	handler, err := api.New(store, scans, rm, base, o.DevOrigin)
	if err != nil {
		scans.Close()
		store.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	handler.SaveExport = o.SaveExport
	handler.AccessHash = accessHash
	server := &http.Server{Handler: handler.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10, BaseContext: func(net.Listener) context.Context { return ctx }}
	s := &Service{URL: base, Scans: scans, Store: store, server: server, cancel: cancel, done: make(chan error, 1), rulesDone: make(chan struct{}), dataLock: dataLock, AccessPasswordFile: accessFile}
	go func() { defer close(s.rulesDone); rm.Run(ctx) }()
	go func() { s.done <- server.Serve(listener) }()
	started = true
	return s, nil
}
func (s *Service) Done() <-chan error { return s.done }
func (s *Service) Close() {
	s.once.Do(func() {
		s.cancel()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.server.Shutdown(ctx); err != nil {
			_ = s.server.Close()
		}
		<-s.rulesDone
		s.Scans.Close()
		_ = s.Store.Close()
		_ = s.dataLock.Close()
	})
}
