package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/api"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/config"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("启动失败", "error", err)
		os.Exit(1)
	}
}
func run() error {
	dirDefault, err := config.DataDir()
	if err != nil {
		return err
	}
	address := flag.String("listen", "127.0.0.1:19110", "仅允许回环监听地址；端口 0 自动选择")
	dataDir := flag.String("data-dir", dirDefault, "SQLite 与浏览器会话数据目录")
	noOpen := flag.Bool("no-open", false, "不自动打开 GUI 浏览器")
	devOrigin := flag.String("dev-origin", "", "开发界面 Origin，例如 http://127.0.0.1:5173")
	testAllow := flag.String("test-allow-loopback", "", "仅供测试：允许精确的 IP:端口（只接受回环地址）")
	testMap := flag.String("test-map-loopback", "", "仅供测试：精确的 *.test:端口=回环IP 映射，逗号分隔")
	version := flag.Bool("version", false, "显示版本")
	flag.Parse()
	if *version {
		fmt.Println("Castorice-WebRuleAnalyzer " + model.Version)
		return nil
	}
	host, _, err := net.SplitHostPort(*address)
	if err != nil {
		return err
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !ip.IsLoopback() {
		return errors.New("v1.0 只允许监听回环 IP；远程多用户认证尚未实现")
	}
	if err = os.MkdirAll(*dataDir, 0700); err != nil {
		return err
	}
	store, err := storage.Open(filepath.Join(*dataDir, "castorice.db"))
	if err != nil {
		return err
	}
	defer store.Close()
	ruleManager, err := rules.NewManager(store)
	if err != nil {
		return err
	}
	policy := security.Policy{TestAllow: map[string]bool{}, TestMappings: map[string]netip.Addr{}}
	if *testMap != "" {
		for _, entry := range strings.Split(*testMap, ",") {
			name, rawIP, ok := strings.Cut(entry, "=")
			host, port, e := net.SplitHostPort(name)
			ip, pe := netip.ParseAddr(rawIP)
			if !ok || e != nil || pe != nil || !ip.IsLoopback() || !strings.HasSuffix(host, ".test") || strings.Contains(host, "*") || port == "" {
				return errors.New("测试映射必须是精确 *.test:端口=回环IP")
			}
			policy.TestMappings[name] = ip
		}
		slog.Warn("显式 .test 回环映射已启用，仅用于测试站")
	}
	if *testAllow != "" {
		for _, entry := range strings.Split(*testAllow, ",") {
			h, port, e := net.SplitHostPort(entry)
			addr, pe := netip.ParseAddr(h)
			if e != nil || pe != nil || !addr.IsLoopback() || port == "" {
				return errors.New("测试白名单必须是精确回环 IP:端口")
			}
			policy.TestAllow[entry] = true
		}
		slog.Warn("显式测试白名单已启用，仅用于本地测试站")
	}
	manager := scanner.NewManager(store, ruleManager, scanner.Engine{Policy: policy, SessionDir: filepath.Join(*dataDir, "sessions")})
	defer manager.Close()
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		return fmt.Errorf("端口无法使用，请关闭已运行实例或通过 --listen 指定其他端口: %w", err)
	}
	base := "http://" + listener.Addr().String()
	server, err := api.New(store, manager, ruleManager, base, *devOrigin)
	if err != nil {
		listener.Close()
		return err
	}
	httpServer := &http.Server{Handler: server.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpServer.Serve(listener) }()
	fmt.Printf("\nCastorice-WebRuleAnalyzer %s · Web分流规则分析器\n界面: %s\n数据: %s\n按 Ctrl+C 停止服务\n\n", model.Version, base, *dataDir)
	if !*noOpen {
		if err = browser.OpenURL(base); err != nil {
			slog.Warn("未能自动打开界面，请使用上方地址", "error", err)
		}
	}
	select {
	case <-ctx.Done():
		manager.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
		return nil
	case err = <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}
