package security

import (
	"bytes"
	"context"
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

// AutoResolver only falls back when every system answer is a benchmarking
// Fake-IP address. Genuine private/mixed answers are never reinterpreted. The
// TLS endpoint is pinned to 1.1.1.1 with normal hostname/certificate checks.
type AutoResolver struct {
	OnFallback func(string)
	System     Resolver
	client     *http.Client
	mu         sync.Mutex
	cache      map[string]dnsCache
}

func NewAutoResolver() *AutoResolver {
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "cloudflare-dns.com:443" {
			return nil, errors.New("DNS 端点不匹配")
		}
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", "1.1.1.1:443")
	}, MaxIdleConns: 4, IdleConnTimeout: 15 * time.Second, ResponseHeaderTimeout: 5 * time.Second, ForceAttemptHTTP2: true}
	return &AutoResolver{System: net.DefaultResolver, client: &http.Client{Transport: transport, Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, cache: map[string]dnsCache{}}
}
func (r *AutoResolver) Close() { r.client.CloseIdleConnections() }
func (r *AutoResolver) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	ips, err := r.System.LookupNetIP(ctx, network, host)
	if err != nil || len(ips) == 0 {
		return ips, err
	}
	allFake := true
	for _, ip := range ips {
		if !fakeIPPrefix.Contains(ip.Unmap()) && !fakeIPv6Prefix.Contains(ip) {
			allFake = false
			break
		}
	}
	if !allFake {
		return ips, nil
	}
	r.mu.Lock()
	cached, ok := r.cache[host]
	r.mu.Unlock()
	if ok && time.Now().Before(cached.until) {
		return append([]netip.Addr{}, cached.ips...), nil
	}
	if r.OnFallback != nil {
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
	for range 2 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case answer := <-ch:
			if answer.err != nil {
				return nil, fmt.Errorf("系统 DNS 返回 Fake-IP，但 HTTPS DNS 校验失败: %w", answer.err)
			}
			resolved = append(resolved, answer.ips...)
			if answer.ttl < ttl {
				ttl = answer.ttl
			}
		}
	}
	if len(resolved) == 0 {
		return nil, errors.New("系统 DNS 返回 Fake-IP，HTTPS DNS 未返回地址")
	}
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
	message := dnsmessage.Message{Header: dnsmessage.Header{ID: 1234, RecursionDesired: true}, Questions: []dnsmessage.Question{{Name: name, Type: typ, Class: dnsmessage.ClassINET}}}
	wire, err := message.Pack()
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", "https://cloudflare-dns.com/dns-query", bytes.NewReader(wire))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, 0, errors.New("无法连接固定 HTTPS DNS 端点")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, 0, fmt.Errorf("HTTPS DNS HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 65537))
	if err != nil || len(body) > 65536 {
		return nil, 0, errors.New("HTTPS DNS 响应过大或读取失败")
	}
	var response dnsmessage.Message
	if err = response.Unpack(body); err != nil || !response.Response || response.Truncated || response.ID != 1234 || response.RCode != dnsmessage.RCodeSuccess || len(response.Questions) != 1 || response.Questions[0].Name != name || response.Questions[0].Type != typ {
		return nil, 0, errors.New("HTTPS DNS 响应校验失败")
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
