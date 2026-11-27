//go:build !windows

package scanner

import (
	"context"
	"strings"

	"github.com/chromedp/chromedp"
)

func openScanBrowser(ctx context.Context, launch browserLaunch) (scanBrowser, error) {
	opts := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	// An explicit false disables chromedp's implicit --no-sandbox for root.
	opts = append(opts, chromedp.ExecPath(launch.executable), chromedp.Flag("no-sandbox", false),
		chromedp.Flag("headless", false), chromedp.Flag("disable-popup-blocking", false))
	for _, arg := range launch.flags() {
		name, value, hasValue := strings.Cut(arg[2:], "=")
		if hasValue {
			opts = append(opts, chromedp.Flag(name, value))
		} else {
			opts = append(opts, chromedp.Flag(name, true))
		}
	}
	scopeOptions, closeScope := browserProcessScope(launch.profile)
	allocCtx, cancelAllocator := chromedp.NewExecAllocator(ctx, append(opts, scopeOptions...)...)
	tabCtx, cancelTab := chromedp.NewContext(allocCtx, quietBrowser)
	return scanBrowser{
		tab: tabCtx,
		close: func() error {
			cancelTab()
			cancelAllocator()
			closeScope()
			return nil
		},
	}, nil
}
