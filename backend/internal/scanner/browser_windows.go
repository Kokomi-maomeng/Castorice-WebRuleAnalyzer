package scanner

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/winjob"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
	"github.com/gorilla/websocket"
	"golang.org/x/sys/windows"
)

// Assign the launcher before its first instruction. Edge may exit the launcher
// after spawning the actual browser, which inherits this same job.
const procThreadAttributeJobList = 0x0002000d

var (
	devToolsPath        = regexp.MustCompile(`(?i)^/devtools/browser/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
	getExtendedTCPTable = windows.NewLazySystemDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")
	isProcessInJob      = windows.NewLazySystemDLL("kernel32.dll").NewProc("IsProcessInJob")
)

func openScanBrowser(ctx context.Context, launch browserLaunch) (scanBrowser, error) {
	if err := ctx.Err(); err != nil {
		return scanBrowser{}, err
	}
	job, err := winjob.New()
	if err != nil {
		return scanBrowser{}, browserFailure("browser_start_failed", "无法建立采集浏览器的进程隔离", err)
	}
	var endpoint string
	var process windows.Handle
	closeJob := func() error { return closeBrowserJob(job, endpoint) }
	opened := false
	defer func() {
		if !opened {
			_ = closeJob()
			if process != 0 {
				_ = windows.CloseHandle(process)
			}
		}
	}()
	if err = startBrowserInJob(job, launch); err != nil {
		return scanBrowser{}, browserFailure("browser_start_failed", "无法启动独立采集浏览器进程", err)
	}
	readyCtx, stopReady := context.WithTimeout(ctx, 12*time.Second)
	defer stopReady()
	readyEndpoint, process, err := waitDevToolsPort(readyCtx, job, launch.profile)
	if err != nil {
		return scanBrowser{}, browserFailure("browser_port_failed", "采集浏览器的独立调试端口未就绪", err)
	}

	attachCtx, stopAttach := context.WithTimeout(ctx, 5*time.Second)
	defer stopAttach()
	tabID, err := browserTab(attachCtx, readyEndpoint, filepath.Base(launch.executable))
	if err != nil {
		return scanBrowser{}, browserFailure("browser_cdp_failed", "无法验证采集浏览器的 CDP 会话", err)
	}
	endpoint = readyEndpoint
	allocCtx, cancelAllocator := chromedp.NewRemoteAllocator(context.WithoutCancel(ctx), endpoint, chromedp.NoModifyURL)
	tabCtx, cancelTab := chromedp.NewContext(allocCtx, quietBrowser, chromedp.WithTargetID(tabID),
		chromedp.WithBrowserOption(chromedp.WithDialTimeout(2*time.Second)))
	// The remote allocator uses the first Run context for the websocket lifetime.
	// Cancel it on startup failure, then give scan actions their own cancel scope.
	stopFailedAttach := context.AfterFunc(attachCtx, cancelAllocator)
	err = chromedp.Run(tabCtx)
	if !stopFailedAttach() && err == nil {
		err = attachCtx.Err()
	}
	if err != nil {
		cancelTab()
		cancelAllocator()
		chromedp.FromContext(tabCtx).Allocator.Wait()
		return scanBrowser{}, browserFailure("browser_cdp_failed", "无法连接到采集浏览器的 CDP 会话", err)
	}
	scanTab, cancelScan := context.WithCancel(tabCtx)
	stopScan := context.AfterFunc(ctx, cancelScan)
	opened = true
	return scanBrowser{
		tab: scanTab,
		close: func() error {
			defer windows.CloseHandle(process)
			stopScan()
			cancelScan()
			err := closeJob()
			cancelTab()
			cancelAllocator()
			chromedp.FromContext(tabCtx).Allocator.Wait()
			return err
		},
		cleanExit: func() bool {
			// Edge's initial launcher can exit long before the scan ends.
			// Check the retained handle of the process that owned the CDP port.
			status, err := windows.WaitForSingleObject(process, 1500)
			var code uint32
			return err == nil && status == windows.WAIT_OBJECT_0 &&
				windows.GetExitCodeProcess(process, &code) == nil && code == 0
		},
	}, nil
}

func startBrowserInJob(job windows.Handle, launch browserLaunch) error {
	attributes, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return err
	}
	defer attributes.Delete()
	if err = attributes.Update(procThreadAttributeJobList, unsafe.Pointer(&job), unsafe.Sizeof(job)); err != nil {
		return err
	}
	args := append([]string{launch.executable,
		"--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
		"--no-first-run", "--no-default-browser-check", "--enable-automation",
		"--disable-default-apps", "--disable-breakpad", "--disable-prompt-on-repost",
		"--disable-features=site-per-process,Translate,BlinkGenPropertyTrees,msEdgeSidebarV2",
		"--hide-scrollbars", "--mute-audio",
	}, launch.flags()...)
	line, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(append(args, "about:blank")))
	if err != nil {
		return err
	}
	startup := windows.StartupInfoEx{ProcThreadAttributeList: attributes.List()}
	startup.Cb = uint32(unsafe.Sizeof(startup))
	var process windows.ProcessInformation
	if err = windows.CreateProcess(windows.StringToUTF16Ptr(launch.executable), line, nil, nil, false,
		windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_NO_WINDOW, nil,
		windows.StringToUTF16Ptr(filepath.Dir(launch.executable)), &startup.StartupInfo, &process); err != nil {
		return err
	}
	_ = windows.CloseHandle(process.Thread)
	_ = windows.CloseHandle(process.Process)
	return nil
}

func waitDevToolsPort(ctx context.Context, job windows.Handle, profile string) (string, windows.Handle, error) {
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()
	for {
		active, err := winjob.Active(job)
		if err != nil {
			return "", 0, err
		}
		if active == 0 {
			return "", 0, errors.New("浏览器进程在调试端口就绪前退出")
		}
		if port, path := readDevToolsPort(profile); port != 0 {
			if process := devToolsProcess(job, port); process != 0 {
				return fmt.Sprintf("ws://127.0.0.1:%d%s", port, path), process, nil
			}
		}
		select {
		case <-ctx.Done():
			return "", 0, ctx.Err()
		case <-ticker.C:
		}
	}
}

func readDevToolsPort(profile string) (uint16, string) {
	f, err := os.Open(filepath.Join(profile, "DevToolsActivePort"))
	if err != nil {
		return 0, ""
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 256))
	fields := strings.Fields(string(data))
	if err != nil || len(data) == 256 || len(fields) != 2 || !devToolsPath.MatchString(fields[1]) {
		return 0, ""
	}
	port, err := strconv.ParseUint(fields[0], 10, 16)
	if err != nil {
		return 0, ""
	}
	return uint16(port), fields[1]
}

func devToolsProcess(job windows.Handle, port uint16) windows.Handle {
	const (
		tcpTableOwnerPIDListener = 3
		rowSize                  = 24
		loopback                 = 0x0100007f // 127.0.0.1 in a Windows DWORD
	)
	table := make([]byte, 16<<10)
	size := uint32(len(table))
	call := func() uintptr {
		rc, _, _ := getExtendedTCPTable.Call(uintptr(unsafe.Pointer(&table[0])), uintptr(unsafe.Pointer(&size)), 0,
			windows.AF_INET, tcpTableOwnerPIDListener, 0)
		return rc
	}
	result := call()
	if result == uintptr(windows.ERROR_INSUFFICIENT_BUFFER) && size > uint32(len(table)) && size <= 4<<20 {
		table = make([]byte, size)
		result = call()
	}
	if result != 0 {
		return 0
	}
	count := min(int(binary.LittleEndian.Uint32(table)), (len(table)-4)/rowSize)
	for i := 0; i < count; i++ {
		row := table[4+i*rowSize:][:rowSize]
		if binary.LittleEndian.Uint32(row[4:]) != loopback || binary.BigEndian.Uint16(row[8:]) != port {
			continue
		}
		pid := binary.LittleEndian.Uint32(row[20:])
		process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
		if err != nil {
			return 0
		}
		var member int32
		ok, _, _ := isProcessInJob.Call(uintptr(process), uintptr(job), uintptr(unsafe.Pointer(&member)))
		if ok != 0 && member != 0 {
			return process
		}
		_ = windows.CloseHandle(process)
		return 0
	}
	return 0
}

func browserTab(ctx context.Context, endpoint, executable string) (target.ID, error) {
	address := "http://" + strings.TrimPrefix(strings.SplitN(endpoint, "/devtools/", 2)[0], "ws://")
	transport := &http.Transport{DisableKeepAlives: true, MaxResponseHeaderBytes: 16 << 10}
	read := func(path string, out any) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+path, nil)
		if err != nil {
			return err
		}
		resp, err := transport.RoundTrip(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("调试接口返回 HTTP %d", resp.StatusCode)
		}
		return json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(out)
	}
	var version struct {
		Browser              string
		WebSocketDebuggerURL string
	}
	if err := read("/json/version", &version); err != nil {
		return "", err
	}
	product, _, _ := strings.Cut(strings.ToLower(version.Browser), "/")
	validProduct := product == "chrome" || product == "headlesschrome" || product == "chromium"
	if strings.Contains(strings.ToLower(executable), "edge") {
		validProduct = product == "edg"
	}
	if !validProduct || version.WebSocketDebuggerURL != endpoint {
		return "", errors.New("调试端口返回的浏览器身份与本次会话不一致")
	}
	var tabs []struct {
		ID   target.ID
		Type string
		URL  string
	}
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := read("/json/list", &tabs); err != nil {
			return "", err
		}
		for _, tab := range tabs {
			if tab.Type == "page" && tab.ID != "" && tab.URL == "about:blank" {
				return tab.ID, nil
			}
		}
		select {
		case <-ctx.Done():
			return "", errors.New("采集浏览器未创建初始标签页")
		case <-ticker.C:
		}
	}
}

func closeBrowserJob(job windows.Handle, endpoint string) error {
	defer windows.CloseHandle(job)
	// chromedp's remote allocator closes its tab but doesn't own the browser.
	// Send Browser.close on a separate websocket even if the scan was cancelled.
	if endpoint != "" {
		address, _, _ := strings.Cut(strings.TrimPrefix(endpoint, "ws://"), "/")
		_, portText, _ := net.SplitHostPort(address)
		port, err := strconv.ParseUint(portText, 10, 16)
		if err == nil {
			if process := devToolsProcess(job, uint16(port)); process != 0 {
				_ = windows.CloseHandle(process)
				requestBrowserClose(endpoint)
			}
		}
		if waitBrowserExit(job, 800*time.Millisecond) {
			return nil
		}
	}
	if active, err := winjob.Active(job); err == nil && active == 0 {
		return nil
	}
	if err := windows.TerminateJobObject(job, 0); err != nil {
		return err
	}
	if !waitBrowserExit(job, 2*time.Second) {
		return errors.New("等待采集浏览器进程退出超时")
	}
	return nil
}

func requestBrowserClose(endpoint string) {
	ctx, cancel := context.WithTimeout(context.Background(), 450*time.Millisecond)
	defer cancel()
	dialer := &websocket.Dialer{HandshakeTimeout: 450 * time.Millisecond}
	ws, response, err := dialer.DialContext(ctx, endpoint, nil)
	if err != nil {
		if response != nil {
			_ = response.Body.Close()
		}
		return
	}
	defer ws.Close()
	deadline, _ := ctx.Deadline()
	_ = ws.SetWriteDeadline(deadline)
	_ = ws.WriteMessage(websocket.TextMessage, []byte(`{"id":1,"method":"Browser.close"}`))
}

func waitBrowserExit(job windows.Handle, wait time.Duration) bool {
	deadline := time.Now().Add(wait)
	for {
		active, err := winjob.Active(job)
		if err != nil || active == 0 {
			return err == nil
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(30 * time.Millisecond)
	}
}
