//go:build !linux

package scanner

import "github.com/chromedp/chromedp"

func browserProcessScope(string) ([]chromedp.ExecAllocatorOption, func()) {
	return nil, func() {}
}
