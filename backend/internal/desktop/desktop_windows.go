//go:build windows

// Package desktop provides a native WebView2 window and an owning Windows Job.
package desktop

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/app"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

var user32 = windows.NewLazySystemDLL("user32.dll")
var messageBox = user32.NewProc("MessageBoxW")

func Alert(message string) {
	messageBox.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(message))), uintptr(unsafe.Pointer(windows.StringToUTF16Ptr("Castorice-WebRuleAnalyzer "+model.Version))), 0x10)
}

func openLog(dir, name string) (*os.File, error) {
	path := filepath.Join(dir, name)
	if info, err := os.Stat(path); err == nil && info.Size() > 5<<20 {
		_ = os.Remove(path + ".2")
		_ = os.Rename(path+".1", path+".2")
		_ = os.Rename(path, path+".1")
	}
	return os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
}
func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0600)
}

// Supervisor starts an identical executable behind a pipe gate. No browser can
// start until AssignProcessToJobObject succeeds. Closing this process (even via
// Task Manager) closes its non-inherited job handle, terminating its own tree.
// No system-wide process-name matching or taskkill is used.
func Supervisor() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	p, err := portable.Open(exe)
	if err != nil {
		return err
	}
	if err = p.Environment(); err != nil {
		return err
	}
	lock, err := windows.CreateFile(windows.StringToUTF16Ptr(filepath.Join(p.Data, "desktop.lock")), windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return errors.New("此软件目录已有实例运行，或目录不可写。请先关闭原窗口。")
	}
	defer windows.CloseHandle(lock)
	if err = scanner.CleanSessions(p.Sessions); err != nil {
		return err
	}
	if err = p.ClearTemp(); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(p.Data, "runtime.json"))
	logFile, err := openLog(p.Logs, "desktop.log")
	if err != nil {
		return err
	}
	defer logFile.Close()
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(job)
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return err
	}
	defer reader.Close()
	defer writer.Close()
	if err = windows.SetHandleInformation(windows.Handle(reader.Fd()), windows.HANDLE_FLAG_INHERIT, windows.HANDLE_FLAG_INHERIT); err != nil {
		return err
	}
	cmd := exec.Command(exe, "--desktop-worker="+strconv.FormatUint(uint64(reader.Fd()), 10))
	cmd.Dir = p.Root
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW, AdditionalInheritedHandles: []syscall.Handle{syscall.Handle(reader.Fd())}}
	if err = cmd.Start(); err != nil {
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(cmd.Process.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(job, process)
		windows.CloseHandle(process)
	}
	if err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return fmt.Errorf("无法建立应用进程隔离，已中止启动: %w", err)
	}
	started := time.Now().UTC()
	_, err = writer.Write([]byte{1})
	writer.Close()
	reader.Close()
	if err != nil {
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()
	workerExit := consumeWorkerExit(p.Logs, waitErr)
	// Allow a short normal Runtime shutdown before enforcing the owned job.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if jobActive(job) == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	before := jobActive(job)
	if before > 0 {
		_ = windows.TerminateJobObject(job, 0)
	}
	deadline = time.Now().Add(4 * time.Second)
	for jobActive(job) > 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	remaining := jobActive(job)
	cleanupErrors := []string{}
	if remaining == 0 {
		// Only marked profiles are removed, including those left after a hard crash.
		if e := scanner.CleanSessions(p.Sessions); e != nil {
			cleanupErrors = append(cleanupErrors, e.Error())
		}
		if e := p.ClearTemp(); e != nil {
			cleanupErrors = append(cleanupErrors, e.Error())
		}
	}
	_ = os.Remove(filepath.Join(p.Data, "runtime.json"))
	report := struct {
		Version                                       string `json:"version"`
		SupervisorPID, WorkerPID                      int
		StartedAt, EndedAt                            time.Time
		ExitCode                                      int `json:"exit_code"`
		ChildrenBeforeEnforcement, RemainingProcesses uint32
		CleanupErrors                                 []string `json:"cleanup_errors"`
	}{model.Version, os.Getpid(), cmd.Process.Pid, started, time.Now().UTC(), cmd.ProcessState.ExitCode(), before, remaining, cleanupErrors}
	_ = writeJSON(filepath.Join(p.Logs, "last-exit.json"), report)
	if workerExit != nil {
		return workerExit
	}
	if remaining != 0 || len(cleanupErrors) > 0 {
		return errors.New("退出清理未完整完成，请查看 data/logs/last-exit.json")
	}
	return nil
}

func jobActive(job windows.Handle) uint32 {
	var accounting struct {
		TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime int64
		TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses     uint32
	}
	if err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&accounting)), uint32(unsafe.Sizeof(accounting)), nil); err != nil {
		return ^uint32(0)
	}
	return accounting.ActiveProcesses
}

func Worker(gate string) error {
	handle, err := strconv.ParseUint(gate, 10, 64)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(handle), "startup-gate")
	var b [1]byte
	_, err = io.ReadFull(f, b[:])
	f.Close()
	if err != nil || b[0] != 1 {
		return errors.New("启动监督进程未就绪")
	}
	// WebView2 COM and its Windows message loop must use the same OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	p, err := portable.Open(exe)
	if err != nil {
		return err
	}
	if err = p.Environment(); err != nil {
		return err
	}
	logFile, err := openLog(p.Logs, "application.log")
	if err != nil {
		return err
	}
	defer logFile.Close()
	log.SetOutput(logFile)
	slog.SetDefault(slog.New(slog.NewTextHandler(logFile, nil)))
	runtimeVersion, err := webviewloader.GetInstalledVersion()
	if err != nil || runtimeVersion == "" {
		return errors.New("缺少 Microsoft Edge WebView2 Runtime。请安装微软官方 Evergreen Runtime 后重试：https://developer.microsoft.com/microsoft-edge/webview2/")
	}
	// Explicit arguments prevent the GUI Runtime from using a user's profile or
	// Downloads directory. Scanner Chromium has a separate temporary profile.
	arguments := `--no-first-run --disable-background-networking --disable-features=msEdgeSidebarV2 --crash-dumps-dir="` + filepath.Join(p.Data, "crashes") + `"`
	testPort, _ := strconv.Atoi(os.Getenv("CASTORICE_DESKTOP_TEST_PORT"))
	testingWindow := os.Getenv("CASTORICE_DESKTOP_TEST") == "1" && testPort >= 1024 && testPort <= 65535
	if testingWindow {
		arguments += " --remote-debugging-address=127.0.0.1 --remote-debugging-port=" + strconv.Itoa(testPort)
	}
	_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", arguments)
	service, err := app.Start(app.Options{Address: "127.0.0.1:0", DataDir: p.Data, SaveExport: p.SaveExport})
	if err != nil {
		return err
	}
	defer service.Close()
	w := webview2.NewWithOptions(webview2.WebViewOptions{DataPath: p.WebView, AutoFocus: true, WindowOptions: webview2.WindowOptions{Title: "Castorice-WebRuleAnalyzer " + model.Version + " · Web分流规则分析器", Width: 1280, Height: 800, Center: true, IconId: 1}})
	if w == nil {
		return errors.New("WebView2 窗口初始化失败，请查看 data/logs/application.log")
	}
	defer w.Destroy()
	w.SetSize(720, 480, webview2.HintMin)
	if testingWindow {
		// Explicit local acceptance hook: post the same native WM_CLOSE message
		// as the title-bar close button. Absent in ordinary application windows.
		_ = w.Bind("__castoriceTestClose", func() {
			w.Dispatch(func() {
				user32.NewProc("PostMessageW").Call(uintptr(w.Window()), 0x0010, 0, 0)
			})
		})
	}
	meta, _ := json.Marshal(map[string]string{"dataDir": p.Data, "exportDir": p.Exports, "version": model.Version})
	origin, _ := json.Marshal(service.URL)
	w.Init(`if(location.origin===` + string(origin) + `){Object.defineProperty(window,'castoriceDesktop',{value:Object.freeze(` + string(meta) + `),writable:false});}`)
	// The desktop GUI only navigates to its local service. External text is
	// displayed as text; it cannot load scripts through the production CSP.
	w.Navigate(service.URL)
	key := sha256.Sum256([]byte(strings.ToLower(p.Root)))
	_ = writeJSON(filepath.Join(p.Data, "runtime.json"), map[string]any{"version": model.Version, "pid": os.Getpid(), "url": service.URL, "root_id": hex.EncodeToString(key[:8]), "paths": p})
	slog.Info("desktop_started", "version", model.Version, "data", p.Data)
	w.Run()
	slog.Info("desktop_window_closed", "action", "cancel scans and close listener")
	service.Close()
	slog.Info("desktop_service_closed")
	return nil
}
