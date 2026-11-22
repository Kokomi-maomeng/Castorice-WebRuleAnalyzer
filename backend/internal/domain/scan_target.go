package domain

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/net/publicsuffix"
)

type ScanTarget struct {
	Host          string `json:"host"`
	URL           string `json:"url"`
	RemovedPrefix bool   `json:"removed_prefix"`
	RemovedSuffix bool   `json:"removed_suffix"`
}

var scanPrefix = regexp.MustCompile(`(?i)^(https?)[\\]?:[/\\]{2}`)
var otherScheme = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*[\\]?:[/\\]{2}`)
var brokenHTTPPrefix = regexp.MustCompile(`(?i)^https?[\\]?:`)

// PrepareScanTarget keeps only the site origin for navigation. The caller uses
// Host as the display address and keeps the scheme and port for the connection.
func PrepareScanTarget(raw string) (ScanTarget, error) {
	target := ScanTarget{}
	rest := strings.TrimSpace(raw)
	if len(rest) > 8192 {
		return target, errors.New("地址太长，请只输入域名")
	}
	scheme := "https"
	for {
		if prefix := scanPrefix.FindStringSubmatch(rest); prefix != nil {
			scheme = strings.ToLower(prefix[1])
			rest = rest[len(prefix[0]):]
			target.RemovedPrefix = true
		} else if stripped, ok := strings.CutPrefix(rest, "//"); ok {
			rest = stripped
			target.RemovedPrefix = true
		} else {
			break
		}
		rest = strings.TrimSpace(rest)
	}
	if otherScheme.MatchString(rest) {
		return target, errors.New("只支持 HTTP 和 HTTPS 网站")
	}
	if brokenHTTPPrefix.MatchString(rest) {
		return target, errors.New("请检查 HTTP 或 HTTPS 前缀，也可以只填域名")
	}
	authority := rest
	if separator := strings.IndexAny(rest, "/\\?#"); separator >= 0 {
		authority = rest[:separator]
		target.RemovedSuffix = true
	}
	switch {
	case authority == "":
		return target, errors.New("请输入完整的域名")
	case strings.ContainsAny(authority, "。．｡"):
		return target, errors.New("请检查域名里的标点，把中文句号换成英文点")
	case strings.IndexFunc(authority, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0:
		return target, errors.New("域名里有空格或换行，请检查输入")
	case strings.Contains(authority, "@"):
		return target, errors.New("请输入域名，去掉用户名、密码或邮箱前缀")
	}

	host, port, err := targetAuthority(authority)
	if err != nil {
		return target, err
	}
	normalized, kind, err := NormalizeHost(host)
	if err != nil {
		if numericHost.MatchString(host) || strings.Contains(host, ":") {
			return target, errors.New("请检查 IP 地址的格式")
		}
		return target, errors.New("请检查域名拼写、标点和连字符的位置")
	}
	if kind == "domain" && !strings.Contains(normalized, ".") && normalized != "localhost" {
		return target, errors.New("请输入完整的域名，包括点和域名后缀")
	}
	target.Host = normalized
	authority = normalized
	if port != "" {
		authority = net.JoinHostPort(normalized, port)
	} else if kind == "ipv6" {
		authority = "[" + normalized + "]"
	}
	target.URL = (&url.URL{Scheme: scheme, Host: authority, Path: "/"}).String()
	return target, nil
}

func targetAuthority(authority string) (host, port string, err error) {
	if ip, e := netip.ParseAddr(authority); e == nil {
		return ip.String(), "", nil
	}
	if strings.HasPrefix(authority, "[") && strings.HasSuffix(authority, "]") {
		host := authority[1 : len(authority)-1]
		if ip, err := netip.ParseAddr(host); err == nil && ip.Is6() {
			return host, "", nil
		}
		return "", "", errors.New("请检查方括号内的 IPv6 地址")
	}
	if !strings.Contains(authority, ":") {
		if strings.ContainsAny(authority, "[]") {
			return "", "", errors.New("请检查 IPv6 地址的方括号")
		}
		return authority, "", nil
	}
	host, port, err = net.SplitHostPort(authority)
	if err != nil {
		return "", "", errors.New("请检查域名端口或 IPv6 地址格式")
	}
	if strings.HasPrefix(authority, "[") {
		if ip, err := netip.ParseAddr(host); err != nil || !ip.Is6() {
			return "", "", errors.New("请检查方括号内的 IPv6 地址")
		}
	}
	value, err := strconv.ParseUint(port, 10, 16)
	if err != nil || value == 0 {
		return "", "", errors.New("端口需填写 1–65535 的数字")
	}
	if host == "" {
		return "", "", errors.New("请在端口前填写域名或 IP 地址")
	}
	return host, strconv.FormatUint(value, 10), nil
}

// CheckScanSuffix is used for the interactive target field. Lower-level
// navigation and explicitly mapped test hosts keep their existing semantics.
func CheckScanSuffix(host string) error {
	if _, err := netip.ParseAddr(host); err == nil {
		return nil
	}
	last := host[strings.LastIndexByte(host, '.')+1:]
	if _, known := publicsuffix.PublicSuffix(last); !known {
		return errors.New("请检查顶级域名，最后一段后缀无法识别")
	}
	if suffix, icann := publicsuffix.PublicSuffix(host); icann && suffix == host {
		return errors.New("请在域名后缀前填写网站名称")
	}
	return nil
}
