package desktop

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkerExitConsumesPreciseErrorBeforeCleanup(t *testing.T) {
	root := t.TempDir()
	if err := recordError(root, errors.New("WebView2 初始化失败测试")); err != nil {
		t.Fatal(err)
	}
	err := consumeWorkerExit(root, errors.New("exit status 1"))
	if err == nil || !strings.Contains(err.Error(), "WebView2 初始化失败测试") {
		t.Fatal("specific error lost", err)
	}
	if _, err = os.Stat(filepath.Join(root, workerErrorFile)); !os.IsNotExist(err) {
		t.Fatal("stale error remains", err)
	}
}

func TestWorkerErrorSurvivesClosedLogger(t *testing.T) {
	root := t.TempDir()
	if actual := reportedError(root, "fallback"); actual != "fallback" {
		t.Fatal(actual)
	}
	if err := recordError(root, errors.New("缺少 Microsoft Edge WebView2 Runtime")); err != nil {
		t.Fatal(err)
	}
	actual := reportedError(root, "fallback")
	if !strings.Contains(actual, "缺少 Microsoft Edge WebView2 Runtime") || !strings.Contains(actual, "data/logs") {
		t.Fatal(actual)
	}
	if err := recordError(root, errors.New(strings.Repeat("界", 10000))); err != nil {
		t.Fatal(err)
	}
	if len([]rune(reportedError(root, "fallback"))) > 4200 {
		t.Fatal("unbounded native error message")
	}
}
