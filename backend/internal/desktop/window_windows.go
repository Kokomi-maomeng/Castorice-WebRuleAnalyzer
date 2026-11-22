//go:build windows

package desktop

import (
	"crypto/rand"
	"errors"
	"strconv"
	"time"
	"unsafe"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	wmClose         = 0x0010
	wmSize          = 0x0005
	wmNCDestroy     = 0x0082
	wmNCCalcSize    = 0x0083
	wmNCHitTest     = 0x0084
	wmNCLButtonDown = 0x00A1
	wmFinishClose   = 0x8001

	htClient   = 1
	htCaption  = 2
	htTop      = 12
	htTopLeft  = 13
	htTopRight = 14
	swMinimize = 6
	swMaximize = 3
	swRestore  = 9

	gwlExStyle  = ^uintptr(19) // -20
	wsExLayered = 0x00080000
	lwaAlpha    = 2
	frameStep   = 16 * time.Millisecond
)

var (
	showWindow          = user32.NewProc("ShowWindow")
	isWindowVisible     = user32.NewProc("IsWindowVisible")
	isZoomed            = user32.NewProc("IsZoomed")
	isIconic            = user32.NewProc("IsIconic")
	getCursorPos        = user32.NewProc("GetCursorPos")
	getWindowRect       = user32.NewProc("GetWindowRect")
	releaseCapture      = user32.NewProc("ReleaseCapture")
	postMessage         = user32.NewProc("PostMessageW")
	setWindowsHook      = user32.NewProc("SetWindowsHookExW")
	unhookWindowsHook   = user32.NewProc("UnhookWindowsHookEx")
	callNextHook        = user32.NewProc("CallNextHookEx")
	getMonitor          = user32.NewProc("MonitorFromRect")
	getMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	getDPIForWindow     = user32.NewProc("GetDpiForWindow")
	getMetricsForDPI    = user32.NewProc("GetSystemMetricsForDpi")
	getMetrics          = user32.NewProc("GetSystemMetrics")
	getSystemParameters = user32.NewProc("SystemParametersInfoW")
	getWindowLong       = user32.NewProc("GetWindowLongPtrW")
	setWindowLong       = user32.NewProc("SetWindowLongPtrW")
	setWindowAlpha      = user32.NewProc("SetLayeredWindowAttributes")
	comctl32            = windows.NewLazySystemDLL("comctl32.dll")
	setSubclass         = comctl32.NewProc("SetWindowSubclass")
	removeSubclass      = comctl32.NewProc("RemoveWindowSubclass")
	defSubclass         = comctl32.NewProc("DefSubclassProc")
)

type windowPoint struct{ X, Y int32 }
type windowRect struct{ Left, Top, Right, Bottom int32 }
type monitorInfo struct {
	Size          uint32
	Monitor, Work windowRect
	Flags         uint32
}
type windowCreation struct {
	Params, Instance, Menu, Parent uintptr
	Height, Width, Y, X, Style     int32
	Title, Class                   *uint16
	ExStyle                        uint32
}

// Windows owns and keeps these structures alive for the duration of the
// callback. LPARAM is an integer in the callback ABI.
func windowMessageData[T any](value uintptr) *T {
	return *(**T)(unsafe.Pointer(&value))
}

type windowsFrame struct {
	hwnd, subclass     uintptr
	view               webview2.WebView
	closing, maximized bool
	closeTimer         *time.Timer
	closeStarted       time.Time
}

// The pinned WebView2 wrapper creates and shows its HWND in one call. Attach
// the frame to that exact window on the worker's own thread before ShowWindow.
// Let ShowWindow run normally so WebView2 initializes against a visible parent.
func newWindowsFrame(options webview2.WebViewOptions) (*windowsFrame, error) {
	frame := &windowsFrame{}
	frame.subclass = windows.NewCallback(frame.windowProc)
	const whCBT, hcbtCreateWnd = 5, 3
	callback := windows.NewCallback(func(code int32, hwnd, data uintptr) uintptr {
		if code == hcbtCreateWnd && frame.hwnd == 0 && data != 0 {
			creation := *windowMessageData[*windowCreation](data)
			if creation != nil && creation.Parent == 0 &&
				windows.UTF16PtrToString(creation.Title) == options.WindowOptions.Title {
				creation.Style |= 0x02000000 // WS_CLIPCHILDREN
				if ok, _, _ := setSubclass.Call(hwnd, frame.subclass, 1, 0); ok != 0 {
					frame.hwnd = hwnd
				}
			}
		}
		result, _, _ := callNextHook.Call(0, uintptr(code), hwnd, data)
		return result
	})
	hook, _, err := setWindowsHook.Call(whCBT, callback, 0, uintptr(windows.GetCurrentThreadId()))
	if hook == 0 {
		return nil, err
	}
	defer unhookWindowsHook.Call(hook)
	view := webview2.NewWithOptions(options)
	if view == nil {
		return nil, errors.New("WebView2 窗口初始化失败，请查看 data/logs/application.log")
	}
	if frame.hwnd == 0 || frame.hwnd != uintptr(view.Window()) {
		view.Destroy()
		return nil, errors.New("无法在显示前初始化桌面窗口栏")
	}
	frame.view = view
	return frame, nil
}

func (f *windowsFrame) installBridge(origin string, paths portable.Paths) error {
	key := rand.Text()
	if err := f.view.Bind("__castoriceWindowCommand", func(proof, action string) {
		if proof == key {
			f.view.Dispatch(func() { f.command(action) })
		}
	}); err != nil {
		return err
	}
	f.view.Init(windowBridge(origin, paths, "void window.__castoriceWindowCommand("+strconv.Quote(key)+", action);"))
	return nil
}

func (f *windowsFrame) command(action string) {
	if f.hwnd == 0 || f.closing {
		return
	}
	switch action {
	case "minimize":
		showWindow.Call(f.hwnd, swMinimize)
	case "toggle-maximize":
		if zoomed, _, _ := isZoomed.Call(f.hwnd); zoomed != 0 {
			showWindow.Call(f.hwnd, swRestore)
		} else {
			showWindow.Call(f.hwnd, swMaximize)
		}
	case "close":
		postMessage.Call(f.hwnd, wmClose, 0, 0)
	case "move":
		var point windowPoint
		if ok, _, _ := getCursorPos.Call(uintptr(unsafe.Pointer(&point))); ok != 0 {
			releaseCapture.Call()
			pos := uintptr(uint16(point.X)) | uintptr(uint16(point.Y))<<16
			postMessage.Call(f.hwnd, wmNCLButtonDown, htCaption, pos)
		}
	}
}

func (f *windowsFrame) windowProc(hwnd, message, wp, lp, id, data uintptr) uintptr {
	next := func() uintptr {
		result, _, _ := defSubclass.Call(hwnd, message, wp, lp)
		return result
	}
	switch message {
	case wmNCCalcSize:
		// Hide the caption while retaining WS_CAPTION for DWM and the system
		// menu. Restored windows retain native side and bottom resize borders.
		client := windowMessageData[windowRect](lp)
		if zoomed, _, _ := isZoomed.Call(hwnd); zoomed != 0 {
			// The maximized bounding box includes a resize border beyond the
			// monitor work area. Keep the WebView and its controls inside it.
			var area monitorInfo
			area.Size = uint32(unsafe.Sizeof(area))
			monitor, _, _ := getMonitor.Call(uintptr(unsafe.Pointer(client)), 2) // MONITOR_DEFAULTTONEAREST
			if ok, _, _ := getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&area))); ok != 0 {
				client.Left = max(client.Left, area.Work.Left)
				client.Top = max(client.Top, area.Work.Top)
				client.Right = min(client.Right, area.Work.Right)
				client.Bottom = min(client.Bottom, area.Work.Bottom)
				return 0
			}
			return next()
		}
		top := client.Top
		next()
		client.Top = top
		return 0
	case wmNCHitTest:
		result := next()
		if zoomed, _, _ := isZoomed.Call(hwnd); zoomed == 0 {
			return hitTestTopResize(hwnd, lp, result)
		}
		if result != 0 {
			return htClient
		}
		return result
	case wmSize:
		result := next()
		if wp != 1 && f.view != nil { // SIZE_MINIMIZED keeps the prior state.
			now := wp == 2
			if now != f.maximized {
				f.maximized = now
				f.view.Eval("window.dispatchEvent(new CustomEvent('castorice-window-state', {detail: " + strconv.FormatBool(now) + "}));")
			}
		}
		return result
	case wmClose:
		if f.closing {
			return 0
		}
		minimized, _, _ := isIconic.Call(hwnd)
		visible, _, _ := isWindowVisible.Call(hwnd)
		if visible != 0 && minimized == 0 && f.view != nil && windowAnimationsEnabled() {
			f.closing = true
			// Fade the native frame and its WebView together, even when the
			// renderer is occluded and JavaScript animations are suspended.
			style, _, _ := getWindowLong.Call(hwnd, gwlExStyle)
			setWindowLong.Call(hwnd, gwlExStyle, style|wsExLayered)
			if ok, _, _ := setWindowAlpha.Call(hwnd, 0, 255, lwaAlpha); ok != 0 {
				f.closeStarted = time.Now()
				f.scheduleCloseFrame(hwnd, frameStep)
			} else {
				setWindowLong.Call(hwnd, gwlExStyle, style)
				f.view.Eval(windowClosingEvent)
				f.scheduleCloseFrame(hwnd, closeTransition)
			}
			return 0
		}
	case wmFinishClose:
		if f.closing {
			if !f.closeStarted.IsZero() {
				elapsed := time.Since(f.closeStarted)
				if elapsed < closeTransition {
					progress := float64(elapsed) / float64(closeTransition)
					alpha := uintptr(255 * (1 - progress*progress))
					if ok, _, _ := setWindowAlpha.Call(hwnd, 0, alpha, lwaAlpha); ok != 0 {
						f.scheduleCloseFrame(hwnd, min(frameStep, closeTransition-elapsed))
						return 0
					}
				}
			}
			result, _, _ := defSubclass.Call(hwnd, wmClose, 0, 0)
			return result
		}
	case wmNCDestroy:
		if f.closeTimer != nil {
			f.closeTimer.Stop()
		}
		f.hwnd = 0
		removeSubclass.Call(hwnd, f.subclass, id)
	}
	return next()
}

func (f *windowsFrame) scheduleCloseFrame(hwnd uintptr, delay time.Duration) {
	f.closeTimer = time.AfterFunc(delay, func() {
		postMessage.Call(hwnd, wmFinishClose, 0, 0)
	})
}

func hitTestTopResize(hwnd, point, fallback uintptr) uintptr {
	var rect windowRect
	if ok, _, _ := getWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&rect))); ok == 0 {
		return fallback
	}
	x, y := int32(int16(point)), int32(int16(point>>16))
	border := resizeBorder(hwnd, 33) // SM_CYSIZEFRAME + SM_CXPADDEDBORDER
	if x < rect.Left || x >= rect.Right || y < rect.Top || y >= rect.Top+border {
		return fallback
	}
	side := resizeBorder(hwnd, 32)
	switch {
	case x < rect.Left+side:
		return htTopLeft
	case x >= rect.Right-side:
		return htTopRight
	default:
		return htTop
	}
}

func resizeBorder(hwnd, metric uintptr) int32 {
	if getDPIForWindow.Find() == nil && getMetricsForDPI.Find() == nil {
		dpi, _, _ := getDPIForWindow.Call(hwnd)
		frame, _, _ := getMetricsForDPI.Call(metric, dpi)
		padding, _, _ := getMetricsForDPI.Call(92, dpi)
		return int32(frame + padding)
	}
	frame, _, _ := getMetrics.Call(metric)
	padding, _, _ := getMetrics.Call(92)
	return int32(frame + padding)
}

func windowAnimationsEnabled() bool {
	const spiGetClientAreaAnimation = 0x1042
	var enabled uint32
	ok, _, _ := getSystemParameters.Call(spiGetClientAreaAnimation, 0, uintptr(unsafe.Pointer(&enabled)), 0)
	return ok != 0 && enabled != 0
}
