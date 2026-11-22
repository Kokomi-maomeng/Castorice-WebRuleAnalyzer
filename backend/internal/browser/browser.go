package browser

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type Candidate struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func VisibleSupported() bool {
	return runtime.GOOS != "linux" || os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}

func Detect() []Candidate {
	paths := []Candidate{}
	switch runtime.GOOS {
	case "windows":
		for _, root := range []string{os.Getenv("PROGRAMFILES"), os.Getenv("PROGRAMFILES(X86)"), os.Getenv("LOCALAPPDATA")} {
			if root != "" {
				paths = append(paths, Candidate{"Google Chrome", filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe")}, Candidate{"Microsoft Edge", filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe")}, Candidate{"Chromium", filepath.Join(root, "Chromium", "Application", "chrome.exe")})
			}
		}
	case "darwin":
		paths = append(paths, Candidate{"Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}, Candidate{"Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"}, Candidate{"Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"})
	}
	for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "msedge", "chrome"} {
		if p, err := exec.LookPath(name); err == nil {
			paths = append(paths, Candidate{name, p})
		}
	}
	result := []Candidate{}
	seen := map[string]bool{}
	for _, c := range paths {
		if info, err := os.Stat(c.Path); err == nil && !info.IsDir() && !seen[c.Path] {
			result = append(result, c)
			seen[c.Path] = true
		}
	}
	return result
}

func Find(explicit string) (string, error) {
	found := Detect()
	if explicit != "" {
		for _, candidate := range found {
			if explicit == candidate.Path || runtime.GOOS == "windows" && strings.EqualFold(explicit, candidate.Path) {
				return candidate.Path, nil
			}
		}
		return "", errors.New("所选浏览器不在已检测列表中，请在设置中选择自动检测")
	}
	if len(found) == 0 {
		return "", errors.New("未检测到 Chrome、Edge 或 Chromium，请安装其中一个后重试")
	}
	return found[0].Path, nil
}

// ManagedPath is for the process owner (CLI), never for settings or API requests.
func ManagedPath(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("--browser-path 需要 Chrome、Edge 或 Chromium 的绝对路径")
	}
	name := strings.TrimSuffix(strings.ToLower(filepath.Base(path)), ".exe")
	switch name {
	case "chrome", "google chrome", "google-chrome", "google-chrome-stable", "msedge", "microsoft edge", "microsoft-edge", "microsoft-edge-stable", "chromium", "chromium-browser":
		if found, err := exec.LookPath(path); err == nil {
			if info, err := os.Stat(found); err == nil && info.Mode().IsRegular() {
				return found, nil
			}
		}
	}
	return "", errors.New("--browser-path 必须指向可执行的 Chrome、Edge 或 Chromium")
}

func CheckSandboxUser() error {
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		return errors.New("请使用普通用户启动 Linux 服务或桌面窗口，以启用 Chromium 沙箱")
	}
	return nil
}

func OpenURL(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
