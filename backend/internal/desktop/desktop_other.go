//go:build !windows

package desktop

import (
	"errors"
	"fmt"
)

func Alert(message string) { fmt.Println(message) }
func Supervisor() error {
	return errors.New("当前原生桌面窗口只支持 Windows；其他平台请使用 --server")
}
func Worker(string) error { return errors.New("Windows-only worker") }
