package browser

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type Candidate struct {
	Name string `json:"name"`
	Path string `json:"path"`
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
	if explicit != "" {
		info, err := os.Stat(explicit)
		if err != nil || info.IsDir() {
			return "", errors.New("浏览器路径不存在，请在设置中选择 Chrome、Edge 或 Chromium 可执行文件")
		}
		return explicit, nil
	}
	found := Detect()
	if len(found) == 0 {
		return "", errors.New("未检测到 Chrome、Edge 或 Chromium，请安装浏览器或在设置中填写路径")
	}
	return found[0].Path, nil
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
