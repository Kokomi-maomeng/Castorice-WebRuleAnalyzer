package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"runtime"
	"strings"
)

func ensureAccessPassword(path string) error {
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return err
	}
	var secret [24]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.WriteString(hex.EncodeToString(secret[:]) + "\n")
	closeErr := f.Close()
	if err = errors.Join(err, closeErr); err != nil {
		_ = os.Remove(path)
	}
	return err
}

func readAccessPassword(path string) (*[32]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("访问密码文件必须是普通文件，Linux/macOS 权限须为 0600 或 0400")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 1027))
	if err != nil {
		return nil, err
	}
	value := strings.TrimSuffix(strings.TrimSuffix(string(raw), "\n"), "\r")
	if len(value) < 16 || len(value) > 1024 || strings.ContainsAny(value, "\x00\r\n") {
		return nil, errors.New("访问密码文件须包含独立的一行密码（16 至 1024 字节）")
	}
	hash := sha256.Sum256([]byte(value))
	return &hash, nil
}
