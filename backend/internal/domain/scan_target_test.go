package domain

import (
	"strings"
	"testing"
)

func TestPrepareScanTarget(t *testing.T) {
	for _, tc := range []struct {
		input, host, url string
		prefix, suffix   bool
	}{
		{"  Example.COM.  ", "example.com", "https://example.com/", false, false},
		{"http://https://example.com/path?discarded=yes#fragment", "example.com", "https://example.com/", true, true},
		{`http\://EXAMPLE.org:0080\path`, "example.org", "http://example.org:80/", true, true},
		{"//example.org", "example.org", "https://example.org/", true, false},
		{"example.org?key=value", "example.org", "https://example.org/", false, true},
		{"中文.cn", "xn--fiq228c.cn", "https://xn--fiq228c.cn/", false, false},
		{"https://[2001:db8::1]:8443/a", "2001:db8::1", "https://[2001:db8::1]:8443/", true, true},
		{"192.0.2.1", "192.0.2.1", "https://192.0.2.1/", false, false},
	} {
		t.Run(tc.input, func(t *testing.T) {
			got, err := PrepareScanTarget(tc.input)
			want := ScanTarget{Host: tc.host, URL: tc.url, RemovedPrefix: tc.prefix, RemovedSuffix: tc.suffix}
			if err != nil || got != want {
				t.Fatalf("got %+v, %v; want %+v", got, err, want)
			}
		})
	}
}

func TestScanTargetInputMessages(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"", "完整的域名"},
		{"hostname", "域名后缀"},
		{"example。com", "英文点"},
		{"ex ample.com", "空格"},
		{"example..com", "拼写"},
		{"-example.com", "连字符"},
		{"user@example.com", "去掉用户名"},
		{"ftp://example.com", "只支持"},
		{"https:/example.com", "检查 HTTP"},
		{"example.com:0", "端口"},
		{"[example.com]:443", "IPv6"},
		{"256.12.34.56", "IP 地址"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			if _, err := PrepareScanTarget(tc.input); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v; want %q", err, tc.want)
			}
		})
	}
	for _, tc := range []struct{ host, want string }{
		{"example.zzzzzz", "顶级域名"},
		{"co.uk", "填写网站名称"},
		{"example.co.uk", ""},
		{"xn--fiq228c.cn", ""},
	} {
		t.Run(tc.host, func(t *testing.T) {
			err := CheckScanSuffix(tc.host)
			if tc.want == "" && err != nil || tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("got %v; want %q", err, tc.want)
			}
		})
	}
}
