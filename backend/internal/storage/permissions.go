package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// PrepareDataDir returns a canonical path so aliases share the same data lock.
func PrepareDataDir(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(absolute, 0700); err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0700 {
		return "", fmt.Errorf("数据目录须是应用专用目录，且权限为 0700：%s", resolved)
	}
	return resolved, nil
}

func privateDatabase(path string) error {
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		name := path + suffix
		info, err := os.Lstat(name)
		if os.IsNotExist(err) {
			if suffix == "" {
				f, e := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
				if e != nil {
					return e
				}
				if e = f.Close(); e != nil {
					return e
				}
			}
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("数据文件必须是普通文件：%s", filepath.Base(name))
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
			if err = os.Chmod(name, 0600); err != nil {
				return err
			}
		}
	}
	return nil
}
