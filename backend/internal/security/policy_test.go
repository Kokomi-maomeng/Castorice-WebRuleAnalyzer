package security

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

type resolverFunc func(context.Context, string, string) ([]netip.Addr, error)

func (f resolverFunc) LookupNetIP(c context.Context, n, h string) ([]netip.Addr, error) {
	return f(c, n, h)
}
func TestRejectNonPublicAndRebinding(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "198.18.0.1", "192.0.2.1"} {
		if PublicIP(netip.MustParseAddr(raw)) {
			t.Errorf("allowed %s", raw)
		}
	}
	for _, raw := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !PublicIP(netip.MustParseAddr(raw)) {
			t.Errorf("blocked public %s", raw)
		}
	}
	p := Policy{Resolver: resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")}, nil
	})}
	if _, err := p.Resolve(context.Background(), "mixed.example.com", "443"); err == nil {
		t.Fatal("mixed public/private DNS accepted")
	}
	var calls atomic.Int32
	p.Resolver = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		if calls.Add(1) == 1 {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	})
	u, _ := url.Parse("https://rebind.example.com")
	if p.Validate(context.Background(), u) != nil {
		t.Fatal("first public answer rejected")
	}
	if c, err := p.DialContext(context.Background(), "tcp", "rebind.example.com:443"); err == nil {
		c.Close()
		t.Fatal("rebound destination connected")
	}
}
func TestRedaction(t *testing.T) {
	page := RedactPageURL("https://example.com/#/chat?token=private-fragment")
	if !strings.Contains(page, "#/chat?") || strings.Contains(page, "private-fragment") {
		t.Fatal("SPA route redaction", page)
	}
	raw := "https://example.com/api?access_token=private-secret&q=private-search#token=private-fragment"
	text := RedactURL(raw)
	for _, s := range []string{"private-secret", "private-search", "private-fragment"} {
		if strings.Contains(text, s) {
			t.Fatal("leaked", s)
		}
	}
	if !strings.Contains(text, "example.com/api") {
		t.Fatal("lost host/path")
	}
	if strings.Contains(RedactText("navigation "+raw), "private-secret") {
		t.Fatal("error URL leaked")
	}
}
func TestGuardProxyHTTPAndCONNECT(t *testing.T) {
	for _, https := range []bool{false, true} {
		t.Run(map[bool]string{false: "http", true: "https"}[https], func(t *testing.T) {
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "through-guard") })
			var target *httptest.Server
			if https {
				target = httptest.NewTLSServer(handler)
			} else {
				target = httptest.NewServer(handler)
			}
			defer target.Close()
			u, _ := url.Parse(target.URL)
			proxy, err := StartProxy(context.Background(), Policy{TestAllow: map[string]bool{u.Host: true}}, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer proxy.Close()
			proxyURL, _ := url.Parse("http://" + proxy.Address)
			client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL), TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
			defer client.CloseIdleConnections()
			response, err := client.Get(target.URL)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != 200 || string(body) != "through-guard" {
				t.Fatalf("proxy failed: %d %s", response.StatusCode, body)
			}
		})
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("normal mode reached private target") }))
	defer target.Close()
	proxy, err := StartProxy(context.Background(), Policy{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	pu, _ := url.Parse("http://" + proxy.Address)
	client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(pu)}}
	defer client.CloseIdleConnections()
	resp, err := client.Get(target.URL)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 502 {
		t.Fatal("private not blocked")
	}
}
