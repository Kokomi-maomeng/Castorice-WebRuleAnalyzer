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
	"runtime"
	"strings"
	"syscall"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/app"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/desktop"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
)

func main() {
	serverMode := flag.Bool("server", false, "开发/独立 HTTP 服务；默认启动 Windows 桌面窗口")
	worker := flag.String("desktop-worker", "", "内部监督进程使用")
	address := flag.String("listen", "127.0.0.1:19110", "服务模式回环地址")
	dataDir := flag.String("data-dir", "", "仅独立服务模式可指定；桌面模式固定在 EXE 旁 data")
	noOpen := flag.Bool("no-open", false, "服务模式不打开外部浏览器")
	devOrigin := flag.String("dev-origin", "", "Vite 开发来源")
	publicURL := flag.String("public-url", "", "容器/反向代理的精确界面来源，例如 http://127.0.0.1:19110")
	testAllow := flag.String("test-allow-loopback", "", "仅测试：精确回环 IP:端口")
	testMap := flag.String("test-map-loopback", "", "仅测试：精确 *.test:端口=回环IP")
	version := flag.Bool("version", false, "显示版本")
	flag.Parse()
	if *version {
		fmt.Println("Castorice-WebRuleAnalyzer " + model.Version)
		return
	}
	var err error
	if *worker != "" {
		err = desktop.Worker(*worker)
	} else if *serverMode || runtime.GOOS != "windows" {
		err = runServer(*address, *dataDir, *devOrigin, *publicURL, *testAllow, *testMap, *noOpen)
	} else {
		err = desktop.Supervisor()
	}
	if err != nil {
		if *worker != "" {
			fmt.Fprintln(os.Stderr, err.Error())
			desktop.RecordWorkerError(err)
		}
		slog.Error("应用退出", "error", err)
		if !*serverMode && *worker == "" {
			desktop.Alert(err.Error())
		}
		os.Exit(1)
	}
}
func runServer(address, dataDir, devOrigin, publicURL, testAllow, testMap string, noOpen bool) error {
	if dataDir == "" {
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		dataDir = filepath.Join(filepath.Dir(exe), "data")
	}
	policy := security.Policy{TestAllow: map[string]bool{}, TestMappings: map[string]netip.Addr{}}
	if testMap != "" {
		for _, entry := range strings.Split(testMap, ",") {
			name, rawIP, ok := strings.Cut(entry, "=")
			host, port, e := net.SplitHostPort(name)
			ip, pe := netip.ParseAddr(rawIP)
			if !ok || e != nil || pe != nil || !ip.IsLoopback() || !strings.HasSuffix(host, ".test") || strings.Contains(host, "*") || port == "" {
				return errors.New("测试映射必须是精确 *.test:端口=回环IP")
			}
			policy.TestMappings[name] = ip
		}
	}
	if testAllow != "" {
		for _, entry := range strings.Split(testAllow, ",") {
			host, port, e := net.SplitHostPort(entry)
			ip, pe := netip.ParseAddr(host)
			if e != nil || pe != nil || !ip.IsLoopback() || port == "" {
				return errors.New("测试白名单必须是精确回环 IP:端口")
			}
			policy.TestAllow[entry] = true
		}
	}
	s, err := app.Start(app.Options{Address: address, DataDir: dataDir, DevOrigin: devOrigin, PublicURL: publicURL, Policy: policy})
	if err != nil {
		return err
	}
	defer s.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Printf("Castorice-WebRuleAnalyzer %s · Web分流规则分析器\n界面: %s\n数据: %s\n", model.Version, s.URL, dataDir)
	if !noOpen {
		if err = browser.OpenURL(s.URL); err != nil {
			slog.Warn("自动打开失败", "error", err)
		}
	}
	select {
	case <-ctx.Done():
		return nil
	case err = <-s.Done():
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
