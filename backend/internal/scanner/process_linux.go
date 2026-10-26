//go:build linux

package scanner

import (
	"os/exec"
	"path/filepath"
	"syscall"

	"github.com/chromedp/chromedp"
)

// Give each scan its own process group. Killing the Chromium parent alone can
// leave children writing the deleted profile after allocator.Wait has returned.
func browserProcessScope(profile string) ([]chromedp.ExecAllocatorOption, func()) {
	var command *exec.Cmd
	options := []chromedp.ExecAllocatorOption{
		chromedp.ModifyCmdFunc(func(cmd *exec.Cmd) {
			command = cmd
			cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
		}),
		chromedp.Env("XDG_CONFIG_HOME="+filepath.Join(profile, "config"), "XDG_CACHE_HOME="+filepath.Join(profile, "cache")),
	}
	return options, func() {
		if command != nil && command.Process != nil {
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		}
	}
}
