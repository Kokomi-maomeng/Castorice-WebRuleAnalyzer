// Package app hosts the same core service for desktop and development entry points.
package app

import (
	"context"
	"errors"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/api"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Options struct {
	Address, DataDir, DevOrigin, PublicURL string
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
}

func Start(o Options) (*Service, error) {
	host, _, err := net.SplitHostPort(o.Address)
	if err != nil {
		return nil, err
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !ip.IsLoopback() && o.PublicURL == "" {
		return nil, errors.New("非回环监听需要显式设置 --public-url")
	}
	if o.PublicURL != "" {
		u, e := url.Parse(o.PublicURL)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("public-url 必须是精确的 HTTP(S) 来源，不能包含路径、凭据或查询")
		}
	}
	if err = os.MkdirAll(o.DataDir, 0700); err != nil {
		return nil, err
	}
	store, err := storage.Open(filepath.Join(o.DataDir, "castorice.db"))
	if err != nil {
		return nil, err
	}
	rm, err := rules.NewManager(store)
	if err != nil {
		store.Close()
		return nil, err
	}
	scans := scanner.NewManager(store, rm, scanner.Engine{Policy: o.Policy, SessionDir: filepath.Join(o.DataDir, "sessions")})
	listener, err := net.Listen("tcp", o.Address)
	if err != nil {
		scans.Close()
		store.Close()
		return nil, err
	}
	base := "http://" + listener.Addr().String()
	if o.PublicURL != "" {
		base = o.PublicURL
	}
	handler, err := api.New(store, scans, rm, base, o.DevOrigin)
	if err != nil {
		listener.Close()
		scans.Close()
		store.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	handler.SaveExport = o.SaveExport
	server := &http.Server{Handler: handler.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10, BaseContext: func(net.Listener) context.Context { return ctx }}
	s := &Service{URL: base, Scans: scans, Store: store, server: server, cancel: cancel, done: make(chan error, 1), rulesDone: make(chan struct{})}
	go func() { defer close(s.rulesDone); rm.Run(ctx) }()
	go func() { s.done <- server.Serve(listener) }()
	return s, nil
}
func (s *Service) Done() <-chan error { return s.done }
func (s *Service) Close() {
	s.once.Do(func() {
		s.cancel()
		<-s.rulesDone
		s.Scans.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.server.Shutdown(ctx); err != nil {
			_ = s.server.Close()
		}
		_ = s.Store.Close()
	})
}
