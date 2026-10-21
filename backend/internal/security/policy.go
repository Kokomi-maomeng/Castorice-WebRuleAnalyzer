package security

import (
	"context"
	"errors"
	"fmt"
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
	Resolver Resolver
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
	if !strings.Contains(host, ".") && !strings.Contains(host, ":") || strings.HasSuffix(host, ".localhost") || host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".home.arpa") {
		return nil, errors.New("已阻止本机或内部网络目标")
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
			return nil, fmt.Errorf("DNS 解析失败: %s（%s）", host, RedactText(err.Error()))
		}
	}
	if len(addresses) == 0 {
		return nil, errors.New("DNS 未返回可用地址")
	}
	// Reject mixed public/private answers too. The connection below is pinned to a
	// validated literal IP; no second name resolution can change its destination.
	for _, ip := range addresses {
		if !PublicIP(ip) {
			return nil, fmt.Errorf("已阻止非公网目标: %s", host)
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
	dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 20 * time.Second}
	var last error
	for _, ip := range ips {
		c, e := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), port))
		if e == nil {
			return c, nil
		}
		last = e
		if ctx.Err() != nil {
			break
		}
	}
	return nil, last
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
