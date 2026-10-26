package security

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/netip"
	"os"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestFakeIPFallbackStillRejectsPrivateAndMixed(t *testing.T) {
	r := NewAutoResolver()
	defer r.Close()
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("198.18.2.1")}, nil
	})
	r.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(req.Body)
		var question dnsmessage.Message
		_ = question.Unpack(b)
		response := dnsmessage.Message{Header: dnsmessage.Header{ID: question.ID, Response: true}, Questions: question.Questions}
		if question.Questions[0].Type == dnsmessage.TypeA {
			response.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: question.Questions[0].Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}}}}
		}
		wire, _ := response.Pack()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(wire))}, nil
	})}
	if _, err := (Policy{Resolver: r}).Resolve(context.Background(), "example.com", "443"); err == nil {
		t.Fatal("DoH private answer bypassed safety")
	}
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("198.18.2.1"), netip.MustParseAddr("8.8.8.8")}, nil
	})
	if _, err := (Policy{Resolver: r}).Resolve(context.Background(), "mixed.example.com", "443"); err == nil {
		t.Fatal("mixed system answer bypassed safety")
	}
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("10.0.0.1")}, nil
	})
	if _, err := (Policy{Resolver: r}).Resolve(context.Background(), "internal.example.com", "443"); err == nil {
		t.Fatal("private system answer reinterpreted")
	}
}

func TestDualStackFakeIPFallback(t *testing.T) {
	r := NewAutoResolver()
	defer r.Close()
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("198.18.2.1"), netip.MustParseAddr("fdfe:dcba:9876::123")}, nil
	})
	r.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(req.Body)
		var q dnsmessage.Message
		_ = q.Unpack(b)
		response := dnsmessage.Message{Header: dnsmessage.Header{ID: q.ID, Response: true}, Questions: q.Questions}
		if q.Questions[0].Type == dnsmessage.TypeA {
			response.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: q.Questions[0].Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 30}, Body: &dnsmessage.AResource{A: [4]byte{8, 8, 8, 8}}}}
		}
		wire, _ := response.Pack()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(wire))}, nil
	})}
	ips, err := (Policy{Resolver: r}).Resolve(context.Background(), "example.com", "443")
	if err != nil || len(ips) != 1 || ips[0].String() != "8.8.8.8" {
		t.Fatal("dual-stack fake IP not revalidated", ips, err)
	}
}

func TestKnownFakeMixedWithPublicUsesIndependentDNS(t *testing.T) {
	r := NewAutoResolver()
	defer r.Close()
	fallbacks := 0
	r.OnFallback = func(string) { fallbacks++ }
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("198.18.2.1"), netip.MustParseAddr("2606:4700:4700::1111")}, nil
	})
	r.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		wire, _ := io.ReadAll(req.Body)
		var q dnsmessage.Message
		_ = q.Unpack(wire)
		answer := dnsmessage.Message{Header: dnsmessage.Header{ID: q.ID, Response: true}, Questions: q.Questions}
		if q.Questions[0].Type == dnsmessage.TypeA {
			answer.Answers = []dnsmessage.Resource{{Header: dnsmessage.ResourceHeader{Name: q.Questions[0].Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 30}, Body: &dnsmessage.AResource{A: [4]byte{9, 9, 9, 9}}}}
		}
		body, _ := answer.Pack()
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body))}, nil
	})}
	ips, err := (Policy{Resolver: r}).Resolve(context.Background(), "mixed-public.example", "443")
	if err != nil || len(ips) != 1 || ips[0].String() != "9.9.9.9" || fallbacks != 1 {
		t.Fatal("mixed synthetic answers not independently resolved", ips, err, fallbacks)
	}
	for _, private := range []string{"10.0.0.1", "127.0.0.1", "169.254.169.254"} {
		r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr(private), netip.MustParseAddr("198.18.2.1"), netip.MustParseAddr("8.8.8.8")}, nil
		})
		if _, err = (Policy{Resolver: r}).Resolve(context.Background(), "mixed-private.example", "443"); err == nil || fallbacks != 1 {
			t.Fatal("genuine private answer reinterpreted", private, err, fallbacks)
		}
	}
}
func TestLiveFixedHTTPSDNS(t *testing.T) {
	if os.Getenv("CASTORICE_DNS_LIVE") != "1" {
		t.Skip("设置 CASTORICE_DNS_LIVE=1 验证固定端点 HTTPS DNS")
	}
	r := NewAutoResolver()
	defer r.Close()
	r.System = resolverFunc(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("198.18.2.1")}, nil
	})
	ips, err := (Policy{Resolver: r}).Resolve(context.Background(), "example.com", "443")
	if err != nil || len(ips) == 0 {
		t.Fatal(ips, err)
	}
	t.Log("validated public answers", ips)
}
