//go:build !windows && !linux

package desktop

import (
	"errors"
	"fmt"
)

func Alert(message string) { fmt.Println(message) }
func Supervisor() error {
	return errors.New("当前平台请使用 --server")
}
func Worker(string) error { return errors.New("Windows-only worker") }
