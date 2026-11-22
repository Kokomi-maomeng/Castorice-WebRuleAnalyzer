//go:build linux

package desktop

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/app"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
)

//go:embed window_linux.py
var windowProgram string

func Alert(message string) { fmt.Fprintln(os.Stderr, message) }

func Supervisor() error {
	if !browser.VisibleSupported() {
		return errors.New("桌面窗口需要图形会话；服务模式请使用 --server")
	}
	if os.Geteuid() == 0 {
		return errors.New("请用普通用户启动 Linux 桌面窗口")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	paths, err := portable.Open(executable)
	if err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(paths.Data, "desktop.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return errors.New("此软件目录已有桌面实例运行")
	}
	service, err := app.Start(app.Options{Address: "127.0.0.1:0", DataDir: paths.Data, SaveExport: paths.SaveExport})
	if err != nil {
		return err
	}
	defer service.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Linux delivers Pdeathsig when the OS thread that created the child exits.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	command := exec.CommandContext(ctx, "/usr/bin/python3", "-I", "-c", windowProgram)
	command.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	command.Cancel = func() error { return command.Process.Signal(syscall.SIGTERM) }
	command.WaitDelay = 5 * time.Second
	input, _ := json.Marshal(map[string]any{
		"url":                 service.URL,
		"init":                windowBridge(service.URL, paths, "window.webkit.messageHandlers.castoriceWindow.postMessage(action);"),
		"size":                [2]int{windowWidth, windowHeight},
		"minimum_size":        [2]int{minWindowWidth, minWindowHeight},
		"close_transition_ms": closeTransition.Milliseconds(),
		"closing_event":       windowClosingEvent,
	})
	command.Stdin = bytes.NewReader(input)
	if err = command.Run(); err != nil && ctx.Err() == nil {
		return fmt.Errorf("桌面窗口启动或运行失败，请检查 Python GTK 3 和 WebKitGTK 4.1：%w", err)
	}
	return nil
}

func Worker(string) error { return errors.New("Windows-only worker") }
