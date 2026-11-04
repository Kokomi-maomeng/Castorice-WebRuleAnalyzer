package security

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

var fakeIPPrefix = netip.MustParsePrefix("198.18.0.0/15")
var fakeIPv6Prefix = netip.MustParsePrefix("fdfe:dcba:9876::/64")

type dnsCache struct {
	ips   []netip.Addr
	until time.Time
}

// AutoResolver falls back when a known synthetic Fake-IP is present and all
// remaining answers are public. Genuine private/mixed answers are never
// reinterpreted; the independently resolved result is revalidated by Policy. The
// TLS endpoint is pinned to 1.1.1.1 with normal hostname/certificate checks.
type AutoResolver struct {
	OnFallback  func(string)
	System      Resolver
	Independent bool
	endpoint    string
	client      *http.Client
	mu          sync.Mutex
	cache       map[string]dnsCache
}

func ValidDNSProvider(provider string) bool {
	return provider == "" || provider == "cloudflare" || provider == "google"
}
func NewAutoResolver() *AutoResolver { return NewResolver("auto", "", "") }
func NewResolver(mode, provider, upstream string) *AutoResolver {
	endpoint, addresses := "cloudflare-dns.com:443", []string{"1.1.1.1:443", "1.0.0.1:443"}
	if provider == "google" {
		endpoint, addresses = "dns.google:443", []string{"8.8.8.8:443", "8.8.4.4:443"}
	}
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != endpoint {
			return nil, errors.New("DNS 端点不匹配")
		}
		var last error
		for _, ip := range addresses {
			c, e := DialOutbound(ctx, upstream, ip)
			if e == nil {
				return c, nil
			}
			last = e
			if ctx.Err() != nil {
				break
			}
		}
		return nil, last
	}, MaxIdleConns: 4, IdleConnTimeout: 15 * time.Second, ResponseHeaderTimeout: 5 * time.Second, ForceAttemptHTTP2: true}
	return &AutoResolver{System: net.DefaultResolver, Independent: mode == "secure", endpoint: "https://" + endpoint + "/dns-query", client: &http.Client{Transport: transport, Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, cache: map[string]dnsCache{}}
}
func (r *AutoResolver) Close() { r.client.CloseIdleConnections() }
func (r *AutoResolver) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	if !r.Independent {
		ips, err := r.System.LookupNetIP(ctx, network, host)
		if err != nil || len(ips) == 0 {
			return ips, err
		}
		hasFake := false
		for _, ip := range ips {
			if fakeIPPrefix.Contains(ip.Unmap()) || fakeIPv6Prefix.Contains(ip) {
				hasFake = true
			} else if !PublicIP(ip) {
				return ips, nil
			}
		}
		if !hasFake {
			return ips, nil
		}
	}
	r.mu.Lock()
	cached, ok := r.cache[host]
	r.mu.Unlock()
	if ok && time.Now().Before(cached.until) {
		return append([]netip.Addr{}, cached.ips...), nil
	}
	if r.OnFallback != nil && !r.Independent {
		r.OnFallback(host)
	}
	type result struct {
		ips []netip.Addr
		ttl time.Duration
		err error
	}
	ch := make(chan result, 2)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	for _, typ := range []dnsmessage.Type{dnsmessage.TypeA, dnsmessage.TypeAAAA} {
		go func(typ dnsmessage.Type) { ips, ttl, err := r.query(ctx, host, typ); ch <- result{ips, ttl, err} }(typ)
	}
	resolved := []netip.Addr{}
	ttl := 60 * time.Second
	var firstError error
	var notFound error
	for range 2 {
		select {
		case <-ctx.Done():
			return nil, DNSError(host, ctx.Err())
		case answer := <-ch:
			if answer.err != nil {
				if firstError == nil {
					firstError = answer.err
				}
				if d := Explain(answer.err); d.Code == "dns_not_found" {
					notFound = answer.err
				}
				continue
			}
			resolved = append(resolved, answer.ips...)
			if answer.ttl < ttl {
				ttl = answer.ttl
			}
		}
	}
	if notFound != nil {
		if len(resolved) > 0 {
			return nil, Fail("dns_inconsistent", "dns", "安全 DNS 的地址记录不一致: "+host, "请稍后重试或选择其他安全 DNS。", host, notFound)
		}
		return nil, notFound
	}
	if len(resolved) == 0 {
		if firstError != nil {
			return nil, firstError
		}
		return nil, Fail("dns_no_address", "dns", "域名没有可用的地址记录: "+host, "请检查域名拼写及网站的 DNS 配置。", host, nil)
	}
	// A transient error in one address family cannot invalidate the other family.
	// Policy still validates every returned address and dials only those literal IPs.
	r.mu.Lock()
	if len(r.cache) >= 1024 {
		r.cache = map[string]dnsCache{}
	}
	r.cache[host] = dnsCache{append([]netip.Addr{}, resolved...), time.Now().Add(ttl)}
	r.mu.Unlock()
	return resolved, nil
}
func (r *AutoResolver) query(ctx context.Context, host string, typ dnsmessage.Type) ([]netip.Addr, time.Duration, error) {
	name, err := dnsmessage.NewName(strings.TrimSuffix(host, ".") + ".")
	if err != nil {
		return nil, 0, err
	}
	var idBytes [2]byte
	if _, err = rand.Read(idBytes[:]); err != nil {
		return nil, 0, err
	}
	queryID := binary.BigEndian.Uint16(idBytes[:])
	message := dnsmessage.Message{Header: dnsmessage.Header{ID: queryID, RecursionDesired: true}, Questions: []dnsmessage.Question{{Name: name, Type: typ, Class: dnsmessage.ClassINET}}}
	wire, err := message.Pack()
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", r.endpoint, bytes.NewReader(wire))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, 0, Fail("dns_transport", "dns", "无法连接安全 HTTPS DNS 服务: "+host, "请检查网络或本机代理，或选择其他安全 DNS。", host, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, 0, Fail("dns_http", "dns", fmt.Sprintf("安全 DNS 服务返回 HTTP %d", resp.StatusCode), "请稍后重试或选择其他安全 DNS。", host, nil)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 65537))
	if err != nil || len(body) > 65536 {
		return nil, 0, errors.New("HTTPS DNS 响应过大或读取失败")
	}
	var response dnsmessage.Message
	if err = response.Unpack(body); err != nil || !response.Response || response.Truncated || response.ID != queryID || len(response.Questions) != 1 || response.Questions[0].Name != name || response.Questions[0].Type != typ {
		return nil, 0, Fail("dns_invalid_response", "dns", "安全 DNS 响应校验失败", "请重试或选择其他安全 DNS；程序没有采用未通过校验的答案。", host, nil)
	}
	if response.Questions[0].Class != dnsmessage.ClassINET {
		return nil, 0, Fail("dns_invalid_response", "dns", "安全 DNS 问题类别不匹配", "请选择其他安全 DNS。", host, nil)
	}
	if response.RCode == dnsmessage.RCodeNameError {
		return nil, 0, Fail("dns_not_found", "dns", "域名不存在: "+host, "请检查拼写；如需访问名称相近的服务，请明确选择其官方地址。", host, nil)
	}
	if response.RCode != dnsmessage.RCodeSuccess {
		return nil, 0, Fail("dns_server_error", "dns", fmt.Sprintf("安全 DNS 暂时无法解析域名（%s）", response.RCode), "请稍后重试或选择其他安全 DNS。", host, nil)
	}
	allowed := map[string]bool{strings.ToLower(name.String()): true}
	for range 16 {
		changed := false
		for _, answer := range response.Answers {
			if cname, ok := answer.Body.(*dnsmessage.CNAMEResource); ok && allowed[strings.ToLower(answer.Header.Name.String())] && !allowed[strings.ToLower(cname.CNAME.String())] {
				allowed[strings.ToLower(cname.CNAME.String())] = true
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	ips := []netip.Addr{}
	ttl := 60 * time.Second
	for _, answer := range response.Answers {
		if !allowed[strings.ToLower(answer.Header.Name.String())] {
			continue
		}
		switch record := answer.Body.(type) {
		case *dnsmessage.AResource:
			if typ == dnsmessage.TypeA {
				ips = append(ips, netip.AddrFrom4(record.A))
			}
		case *dnsmessage.AAAAResource:
			if typ == dnsmessage.TypeAAAA {
				ips = append(ips, netip.AddrFrom16(record.AAAA))
			}
		}
		if time.Duration(answer.Header.TTL)*time.Second < ttl {
			ttl = time.Duration(answer.Header.TTL) * time.Second
		}
	}
	return ips, ttl, nil
}
