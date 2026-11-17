//go:build windows

package desktop

import (
	"crypto/rand"
	"errors"
	"strconv"
	"unsafe"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

var (
	setWindowStyle = user32.NewProc("SetWindowLongPtrW")
	setWindowPos   = user32.NewProc("SetWindowPos")
	showWindow     = user32.NewProc("ShowWindow")
	isZoomed       = user32.NewProc("IsZoomed")
	getCursorPos   = user32.NewProc("GetCursorPos")
	releaseCapture = user32.NewProc("ReleaseCapture")
	postMessage    = user32.NewProc("PostMessageW")
	comctl32       = windows.NewLazySystemDLL("comctl32.dll")
	setSubclass    = comctl32.NewProc("SetWindowSubclass")
	defSubclass    = comctl32.NewProc("DefSubclassProc")
)

func installWindowBar(w webview2.WebView, origin string, paths portable.Paths) error {
	const (
		gwlStyle     = ^uintptr(15) // GWL_STYLE (-16)
		windowStyle  = 0x000F0000   // THICKFRAME, SYSMENU, MINIMIZEBOX, MAXIMIZEBOX
		frameChanged = 0x0037       // FRAMECHANGED|NOACTIVATE|NOZORDER|NOMOVE|NOSIZE
		wmSize       = 0x0005
		wmClose      = 0x0010
		wmNCLButton  = 0x00A1
		htCaption    = 2
		swMinimize   = 6
		swMaximize   = 3
		swRestore    = 9
	)

	hwnd := uintptr(w.Window())
	key := rand.Text()
	if err := w.Bind("__castoriceWindowCommand", func(proof, action string) {
		if proof != key {
			return
		}
		w.Dispatch(func() {
			switch action {
			case "minimize":
				showWindow.Call(hwnd, swMinimize)
			case "toggle-maximize":
				if zoomed, _, _ := isZoomed.Call(hwnd); zoomed != 0 {
					showWindow.Call(hwnd, swRestore)
				} else {
					showWindow.Call(hwnd, swMaximize)
				}
			case "close":
				postMessage.Call(hwnd, wmClose, 0, 0)
			case "move":
				var point struct{ X, Y int32 }
				if ok, _, _ := getCursorPos.Call(uintptr(unsafe.Pointer(&point))); ok != 0 {
					releaseCapture.Call()
					pos := uintptr(uint16(point.X)) | uintptr(uint16(point.Y))<<16
					postMessage.Call(hwnd, wmNCLButton, htCaption, pos)
				}
			}
		})
	}); err != nil {
		return err
	}
	w.Init(windowBridge(origin, paths, `void window.__castoriceWindowCommand(`+strconv.Quote(key)+`, action);`))

	maximized := false
	subclass := windows.NewCallback(func(window, message, wp, lp, id, data uintptr) uintptr {
		result, _, _ := defSubclass.Call(window, message, wp, lp)
		if message == wmSize && wp != 1 { // Ignore SIZE_MINIMIZED.
			now := wp == 2
			if now != maximized {
				maximized = now
				w.Dispatch(func() {
					w.Eval(`window.dispatchEvent(new CustomEvent('castorice-window-state', {detail: ` + strconv.FormatBool(now) + `}));`)
				})
			}
		}
		return result
	})
	if ok, _, _ := setSubclass.Call(hwnd, subclass, 1, 0); ok == 0 {
		return errors.New("无法初始化桌面窗口栏")
	}
	if previous, _, err := setWindowStyle.Call(hwnd, gwlStyle, windowStyle|0x10000000|0x02000000); previous == 0 {
		return err
	}
	if ok, _, err := setWindowPos.Call(hwnd, 0, 0, 0, 0, 0, frameChanged); ok == 0 {
		return err
	}
	return nil
}
