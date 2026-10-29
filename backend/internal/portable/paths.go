// Package portable keeps application-owned files beside the executable.
package portable

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/exportname"
)

type Paths struct {
	Root     string `json:"root"`
	Data     string `json:"data"`
	Exports  string `json:"exports"`
	Logs     string `json:"logs"`
	Temp     string `json:"temp"`
	WebView  string `json:"webview"`
	Sessions string `json:"sessions"`
}

func Open(executable string) (Paths, error) {
	exe, err := filepath.Abs(executable)
	if err != nil {
		return Paths{}, err
	}
	root, err := filepath.EvalSymlinks(filepath.Dir(exe))
	if err != nil {
		return Paths{}, err
	}
	p := Paths{Root: root, Data: filepath.Join(root, "data"), Exports: filepath.Join(root, "exports")}
	p.Logs = filepath.Join(p.Data, "logs")
	p.Temp = filepath.Join(p.Data, "tmp")
	p.WebView = filepath.Join(p.Data, "webview2")
	p.Sessions = filepath.Join(p.Data, "sessions")
	for _, dir := range []string{p.Data, p.Exports, p.Logs, p.Temp, p.WebView, p.Sessions} {
		if err = os.MkdirAll(dir, 0700); err != nil {
			return Paths{}, fmt.Errorf("软件目录无法写入，请将整个软件文件夹移至可写目录: %w", err)
		}
		real, e := filepath.EvalSymlinks(dir)
		if e != nil || !strings.EqualFold(filepath.Clean(real), filepath.Clean(dir)) {
			return Paths{}, errors.New("应用数据目录不能使用指向其他位置的链接")
		}
	}
	probe, err := os.CreateTemp(p.Data, ".write-check-")
	if err != nil {
		return Paths{}, fmt.Errorf("软件目录不可写: %w", err)
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return p, nil
}

func (p Paths) Environment() error {
	for key, value := range map[string]string{"TEMP": p.Temp, "TMP": p.Temp, "SQLITE_TMPDIR": p.Temp, "WEBVIEW2_USER_DATA_FOLDER": p.WebView} {
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return nil
}

// SaveExport uses exclusive creation, keeping previous exports intact.
func (p Paths) SaveExport(name, content string) (string, error) {
	if !exportname.Valid(name) || filepath.Base(name) != name {
		return "", errors.New("导出文件名不合法")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".yaml" && ext != ".yml" && ext != ".json" && ext != ".txt" {
		return "", errors.New("只允许 YAML、JSON 或来源说明 TXT")
	}
	if len(content) > 16<<20 {
		return "", errors.New("导出内容超过 16 MiB")
	}
	for n := 0; n < 10000; n++ {
		candidate := name
		if n > 0 {
			candidate = fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, filepath.Ext(name)), n, filepath.Ext(name))
		}
		dest := filepath.Join(p.Exports, candidate)
		f, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if os.IsExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, err = f.WriteString(content)
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(dest)
			return "", err
		}
		return dest, nil
	}
	return "", errors.New("同名文件过多，请更换文件名")
}

func (p Paths) ClearTemp() error {
	real, err := filepath.EvalSymlinks(p.Temp)
	if err != nil {
		return err
	}
	if !strings.EqualFold(real, filepath.Join(p.Data, "tmp")) {
		return errors.New("临时目录路径校验失败")
	}
	entries, err := os.ReadDir(real)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		target := filepath.Join(real, entry.Name())
		if filepath.Dir(target) != real {
			return errors.New("临时文件路径校验失败")
		}
		if err = os.RemoveAll(target); err != nil {
			return err
		}
	}
	return nil
}
