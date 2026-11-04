package security

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

func dnsFixture(r *AutoResolver, rcode dnsmessage.RCode, failAAAA bool, ip [4]byte) {
	r.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(req.Body)
		var q dnsmessage.Message
		_ = q.Unpack(b)
		if failAAAA && q.Questions[0].Type == dnsmessage.TypeAAAA {
			return nil, errors.New("fixture unavailable")
		}
		answer := dnsmessage.Message{Header: dnsmessage.Header{ID: q.ID, Response: true, RCode: rcode}, Questions: q.Questions}
		if rcode == dnsmessage.RCodeSuccess && q.Questions[0].Type == dnsmessage.TypeA {
			answer.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: q.Questions[0].Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 30}, Body: &dnsmessage.AResource{A: ip}}}
		}
		wire, _ := answer.Pack()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(wire))}, nil
	})}
}

func TestIndependentDNSAndAddressFamilyFailure(t *testing.T) {
	r := NewResolver("secure", "", "")
	defer r.Close()
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		t.Fatal("independent resolver consulted system DNS")
		return nil, nil
	})
	dnsFixture(r, dnsmessage.RCodeSuccess, true, [4]byte{8, 8, 8, 8})
	ips, err := (Policy{Resolver: r}).Resolve(context.Background(), "family.example", "443")
	if err != nil || len(ips) != 1 || ips[0].String() != "8.8.8.8" {
		t.Fatal(ips, err)
	}
	dnsFixture(r, dnsmessage.RCodeNameError, false, [4]byte{})
	_, err = (Policy{Resolver: r}).Resolve(context.Background(), "missing.example", "443")
	if err == nil || Explain(err).Code != "dns_not_found" {
		t.Fatal("NXDOMAIN was misclassified", err)
	}
	dnsFixture(r, dnsmessage.RCodeSuccess, true, [4]byte{127, 0, 0, 1})
	if _, err = (Policy{Resolver: r}).Resolve(context.Background(), "private.example", "443"); err == nil || Explain(err).Stage != "safety" {
		t.Fatal("private independent answer accepted", err)
	}
}

func TestHTTPUpstreamPinsDestinationAndNeverBypassesTargetPolicy(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "CONNECT" || r.Host != "8.8.8.8:443" {
			t.Errorf("upstream received unvalidated hostname: %s %s", r.Method, r.Host)
		}
		c, b, e := w.(http.Hijacker).Hijack()
		if e != nil {
			return
		}
		defer c.Close()
		_, _ = fmt.Fprint(b, "HTTP/1.1 200 Connection Established\r\n\r\nfixture")
		_ = b.Flush()
	}))
	defer upstream.Close()
	p := Policy{UpstreamProxy: upstream.URL, Resolver: resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	})}
	c, err := p.DialContext(context.Background(), "tcp", "target.example:443")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(c)
	c.Close()
	if string(b) != "fixture" || calls.Load() != 1 {
		t.Fatal(string(b), calls.Load())
	}
	if _, err = p.DialContext(context.Background(), "tcp", "127.0.0.1:443"); err == nil || calls.Load() != 1 {
		t.Fatal("private target reached proxy", err)
	}
	for _, raw := range []string{"http://localhost:7890", "http://user:pass@127.0.0.1:7890", "http://8.8.8.8:80", "socks5://127.0.0.1:0", "http://127.0.0.1:7890/path"} {
		if ValidateProxy(raw) == nil {
			t.Errorf("accepted unsupported connector: %s", raw)
		}
	}
}

func TestNavigationDiagnostics(t *testing.T) {
	for _, code := range []int{401, 403, 404, 429, 503} {
		d := NavigationFailure(errors.New("fixture"), code, "example.com")
		if d.Stage != "http" || d.Code != fmt.Sprintf("http_%d", code) || d.Hint == "" {
			t.Fatal(d)
		}
	}
	for raw, code := range map[string]string{"net::ERR_SSL_PROTOCOL_ERROR": "tls_handshake", "net::ERR_CONNECTION_CLOSED": "connection_closed", "net::ERR_TOO_MANY_REDIRECTS": "redirect_loop"} {
		if d := NavigationFailure(errors.New(raw), 0, "example.com"); d.Code != code {
			t.Fatal(raw, d)
		}
	}
}
