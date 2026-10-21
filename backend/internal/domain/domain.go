package domain

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
	"golang.org/x/net/publicsuffix"
)

var labelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var numericHost = regexp.MustCompile(`^[0-9.]+$`)

func NormalizeHost(host string) (string, string, error) {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	host = strings.Trim(host, "[]")
	if addr, err := netip.ParseAddr(host); err == nil {
		addr = addr.Unmap()
		if addr.Zone() != "" {
			return "", "", errors.New("不支持带 Zone 的 IPv6 地址")
		}
		if addr.Is4() {
			return addr.String(), "ipv4", nil
		}
		return addr.String(), "ipv6", nil
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil || len(ascii) == 0 || len(ascii) > 253 || numericHost.MatchString(ascii) {
		return "", "", errors.New("无效的主机名")
	}
	for _, label := range strings.Split(ascii, ".") {
		if !labelPattern.MatchString(label) {
			return "", "", errors.New("无效的域名标签")
		}
	}
	return ascii, "domain", nil
}

func Registrable(host string) string {
	if _, kind, err := NormalizeHost(host); err != nil || kind != "domain" {
		return ""
	}
	name, _ := publicsuffix.EffectiveTLDPlusOne(host)
	return name
}

func NormalizeURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 8192 || strings.ContainsAny(raw, "\r\n\t\\") {
		return nil, errors.New("请输入有效的 HTTP/HTTPS 地址")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Opaque != "" {
		return nil, errors.New("网址格式不正确")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("只支持 HTTP 和 HTTPS")
	}
	if u.User != nil {
		return nil, errors.New("网址不能包含用户名或密码")
	}
	host, _, err := NormalizeHost(u.Hostname())
	if err != nil {
		return nil, err
	}
	port := u.Port()
	if strings.HasSuffix(u.Host, ":") {
		return nil, errors.New("端口不能为空")
	}
	if port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return nil, errors.New("端口范围必须为 1–65535")
		}
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	if !strings.HasPrefix(u.Fragment, "/") && !strings.HasPrefix(u.Fragment, "!/") {
		u.Fragment = ""
	}
	if u.Path == "" {
		u.Path = "/"
	}
	return u, nil
}

func Origin(u *url.URL) string {
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return strings.ToLower(u.Scheme + "://" + net.JoinHostPort(u.Hostname(), port))
}
