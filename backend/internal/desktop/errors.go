package desktop

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const workerErrorFile = "window-error.txt"

// The worker's normal logger is closed by deferred cleanup before main sees
// a returned error. Use a separate bounded file so the supervisor can show the
// actual failure instead of losing it through a closed log descriptor.
func RecordWorkerError(err error) {
	exe, e := os.Executable()
	if e != nil {
		return
	}
	_ = recordError(filepath.Join(filepath.Dir(exe), "data", "logs"), err)
}
func recordError(logDir string, err error) error {
	message := []rune(err.Error())
	if len(message) > 4096 {
		message = message[:4096]
	}
	return os.WriteFile(filepath.Join(logDir, workerErrorFile), []byte(string(message)), 0600)
}
func reportedError(logDir, fallback string) string {
	f, err := os.Open(filepath.Join(logDir, workerErrorFile))
	if err != nil {
		return fallback
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 16<<10))
	if err != nil || strings.TrimSpace(string(b)) == "" {
		return fallback
	}
	return strings.TrimSpace(string(b)) + "\n\n详细记录位于软件目录 data/logs。"
}

// Read before deleting: the worker's precise startup failure must survive all
// supervisor cleanup, even though its temporary error file is consumed once.
func consumeWorkerExit(logDir string, exitErr error) error {
	defer os.Remove(filepath.Join(logDir, workerErrorFile))
	if exitErr == nil {
		return nil
	}
	fallback := fmt.Sprintf("桌面窗口异常退出，请查看软件目录 data/logs 下的日志: %v", exitErr)
	return errors.New(reportedError(logDir, fallback))
}
