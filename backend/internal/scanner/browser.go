package scanner

import (
	"context"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/chromedp/chromedp"
)

type scanBrowser struct {
	tab       context.Context
	close     func() error
	cleanExit func() bool
}

type browserLaunch struct {
	executable, profile, crashDir, proxy string
	headless                             bool
}

func (b browserLaunch) flags() []string {
	flags := []string{
		"--user-data-dir=" + b.profile,
		"--proxy-server=http://" + b.proxy,
		"--proxy-bypass-list=<-loopback>",
		"--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
		"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
		"--disable-quic",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-sync",
		"--window-size=1360,900",
		"--crash-dumps-dir=" + b.crashDir,
		"--disable-crash-reporter",
	}
	if b.headless {
		flags = append(flags, "--headless")
	}
	return flags
}

// Protocol diagnostics may contain unredacted URLs. Task failures are logged separately.
var quietBrowser = chromedp.WithErrorf(func(string, ...any) {})

func browserFailure(code, message string, err error) *security.Failure {
	return security.Fail(code, "browser", message, "请在设置中确认采集浏览器可用，或选择其他已安装的浏览器。", "", err)
}
