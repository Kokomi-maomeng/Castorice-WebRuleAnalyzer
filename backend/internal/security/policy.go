package security

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
)

type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}
type Policy struct {
	Resolver      Resolver
	UpstreamProxy string
	// TestAllow is intentionally unavailable in settings/API. Only an explicit CLI test flag
	// or a test harness can whitelist a literal loopback host:port.
	TestAllow map[string]bool
	// TestMappings is injected by tests or an explicit test CLI flag, never by
	// settings/API. Exact *.test:port entries must map to a loopback IP.
	TestMappings map[string]netip.Addr
}

var forbiddenPrefixes = func() []netip.Prefix {
	raw := []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "168.63.129.16/32", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "::/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/32", "2001:db8::/32", "2002::/16", "fc00::/7", "fe80::/10", "ff00::/8"}
	result := make([]netip.Prefix, 0, len(raw))
	for _, s := range raw {
		result = append(result, netip.MustParsePrefix(s))
	}
	return result
}()

func PublicIP(a netip.Addr) bool {
	a = a.Unmap()
	if !a.IsValid() || !a.IsGlobalUnicast() || a.IsPrivate() || a.IsLoopback() || a.IsLinkLocalUnicast() {
		return false
	}
	for _, p := range forbiddenPrefixes {
		if p.Contains(a) {
			return false
		}
	}
	return true
}

func (p Policy) Resolve(ctx context.Context, host, port string) ([]netip.Addr, error) {
	host, _, err := domain.NormalizeHost(host)
	if err != nil {
		return nil, err
	}
	if ip, ok := p.TestMappings[net.JoinHostPort(host, port)]; ok && ip.IsLoopback() && strings.HasSuffix(host, ".test") {
		return []netip.Addr{ip}, nil
	}
	if p.TestAllow[net.JoinHostPort(host, port)] {
		ip, e := netip.ParseAddr(host)
		if e == nil && ip.IsLoopback() {
			return []netip.Addr{ip}, nil
		}
	}
	if InternalHost(host) {
		return nil, Fail("target_internal", "safety", "已阻止本机或内部网络目标", "仅支持公网网站，请检查输入的主机名。", host, nil)
	}
	var addresses []netip.Addr
	if ip, e := netip.ParseAddr(host); e == nil {
		addresses = []netip.Addr{ip}
	} else {
		resolver := p.Resolver
		if resolver == nil {
			resolver = net.DefaultResolver
		}
		lookupCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		addresses, err = resolver.LookupNetIP(lookupCtx, "ip", host)
		if err != nil {
			return nil, DNSError(host, err)
		}
	}
	if len(addresses) == 0 {
		return nil, Fail("dns_no_address", "dns", "DNS 未返回可用的地址记录: "+host, "请核对域名，或运行网络诊断检查解析服务。", host, nil)
	}
	// Reject mixed public/private answers too. The connection below is pinned to a
	// validated literal IP; no second name resolution can change its destination.
	for _, ip := range addresses {
		if !PublicIP(ip) {
			literal := false
			if _, e := netip.ParseAddr(host); e == nil {
				literal = true
			}
			message, hint, code := "DNS 返回受限地址，已停止连接: "+host, "系统解析可能受 Hosts、缓存或代理环境影响；运行网络诊断，或明确选择独立安全 DNS 重新校验。", "dns_non_public"
			if ip.IsLoopback() {
				message = "系统 DNS 将目标解析到回环地址，已停止连接: " + host
			}
			if literal {
				message, hint, code = "已阻止非公网目标: "+host, "仅支持公网目标，回环、私网及保留地址不可用于扫描。", "target_non_public"
			}
			failure := Fail(code, "safety", message, hint, host, nil)
			for _, a := range addresses {
				if len(failure.Diagnostic.Addresses) < 16 {
					failure.Diagnostic.Addresses = append(failure.Diagnostic.Addresses, a.String())
				}
			}
			return nil, failure
		}
	}
	return addresses, nil
}

func (p Policy) Validate(ctx context.Context, u *url.URL) error {
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	_, err := p.Resolve(ctx, u.Hostname(), port)
	return err
}

func (p Policy) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, errors.New("连接地址缺少端口")
	}
	ips, err := p.Resolve(ctx, host, port)
	if err != nil {
		return nil, err
	}
	// Literal-IP dialing has no hostname Happy Eyeballs. Prefer IPv4 to avoid
	// spending multiple full timeouts on unusable IPv6 paths; IPv6-only still works.
	sort.SliceStable(ips, func(i, j int) bool { return ips[i].Is4() && !ips[j].Is4() })
	var last error
	for _, ip := range ips {
		c, e := DialOutbound(ctx, p.UpstreamProxy, net.JoinHostPort(ip.String(), port))
		if e == nil {
			return c, nil
		}
		last = e
		if ctx.Err() != nil {
			break
		}
	}
	code, stage, message, hint := "connection_failed", "connection", "未能连接目标网站: "+host, "请检查目标端口和网络路径；连接失败不能证明域名不存在。"
	if p.UpstreamProxy != "" {
		code, stage, message, hint = "proxy_connection", "proxy", "本机代理未能建立到目标的连接: "+host, "请检查本机代理监听地址及代理节点连接。"
	}
	return nil, Fail(code, stage, message, hint, host, last)
}

func InternalHost(host string) bool {
	return !strings.Contains(host, ".") && !strings.Contains(host, ":") || strings.HasSuffix(host, ".localhost") || host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".home.arpa")
}

var longSecret = regexp.MustCompile(`^[A-Za-z0-9_\-=+.]{48,}$`)
var secretPath = regexp.MustCompile(`(?i)^(token|access_token|auth|reset|secret|session|password)$`)
var urlInText = regexp.MustCompile(`https?://[^\s<>"']+`)

// Every query value is redacted, rather than relying on an incomplete token name
// list. Bodies, cookies and headers are never part of our data model.
func RedactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "[无效 URL]"
	}
	u.User = nil
	u.Fragment = ""
	query := u.Query()
	for key := range query {
		query[key] = []string{"[REDACTED]"}
	}
	u.RawQuery = query.Encode()
	parts := strings.Split(u.Path, "/")
	maskNext := false
	for i, s := range parts {
		if maskNext || longSecret.MatchString(s) {
			parts[i] = "[REDACTED]"
		}
		maskNext = secretPath.MatchString(s)
	}
	u.Path = strings.Join(parts, "/")
	u.RawPath = ""
	return u.String()
}

func RedactText(raw string) string {
	raw = urlInText.ReplaceAllStringFunc(raw, RedactURL)
	if len(raw) > 2000 {
		raw = raw[:2000] + "…"
	}
	return raw
}

// Hash routes are page identities, but ordinary fragments may be credentials.
// Preserve only route-shaped fragments and apply query/path redaction inside.
func RedactPageURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "[无效 URL]"
	}
	fragment := u.Fragment
	base := RedactURL(raw)
	prefix := ""
	if strings.HasPrefix(fragment, "!/") {
		prefix = "!"
		fragment = strings.TrimPrefix(fragment, "!")
	}
	if strings.HasPrefix(fragment, "/") {
		route := RedactURL("https://route.invalid" + fragment)
		route = strings.TrimPrefix(route, "https://route.invalid")
		return base + "#" + prefix + route
	}
	return base
}
