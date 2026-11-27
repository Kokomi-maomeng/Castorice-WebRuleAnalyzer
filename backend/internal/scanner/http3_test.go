package scanner

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/quic-go/quic-go/http3"
)

func TestHTTP3DiagnosticOnUDPOnlyEndpoint(t *testing.T) {
	// Reuse the Go fixture certificate, then close its TCP listener. The actual
	// endpoint under test listens only on UDP and issues a redirect response.
	cert := httptest.NewTLSServer(http.NotFoundHandler())
	cert.Close()
	packet, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer packet.Close()
	server := &http3.Server{
		TLSConfig: &tls.Config{Certificates: cert.TLS.Certificates},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != packet.LocalAddr().String() || r.URL.Path != "/" {
				t.Errorf("unexpected HTTP/3 probe: %s %s", r.Host, r.URL.Path)
			}
			w.Header().Set("Alt-Svc", `h3=":443"; ma=60`)
			w.Header().Set("Location", "https://example.com/other")
			w.WriteHeader(http.StatusFound)
		}),
	}
	go func() { _ = server.Serve(packet) }()
	defer server.Close()

	target, err := url.Parse("https://" + packet.LocalAddr().String() + "/")
	if err != nil {
		t.Fatal(err)
	}
	peer := packet.LocalAddr().(*net.UDPAddr).AddrPort()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	roots := x509.NewCertPool()
	roots.AddCert(cert.Certificate())
	result := model.HTTP3Diagnosis{}
	advertised, err := requestHTTP3(ctx, target, peer, &tls.Config{
		ServerName: target.Hostname(), MinVersion: tls.VersionTLS13,
		NextProtos: []string{http3.NextProtoH3}, RootCAs: roots,
	}, &result)
	if err != nil || !advertised || result.ALPN != "h3" || result.HTTPStatus != http.StatusFound {
		t.Fatalf("UDP-only probe = %+v, advertised = %v, error = %v", result, advertised, err)
	}

	options := model.DefaultOptions()
	options.DNSMode = "system"
	blocked := (Engine{}).diagnoseHTTP3(ctx, target, options, "selected")
	if blocked.Diagnostic == nil || blocked.Diagnostic.Stage != "safety" || blocked.ALPN != "" {
		t.Fatalf("loopback was not blocked: %+v", blocked)
	}
	e := Engine{Policy: security.Policy{TestAllow: map[string]bool{target.Host: true}}}
	untrusted := e.diagnoseHTTP3(ctx, target, options, "selected")
	if untrusted.Diagnostic == nil || untrusted.Diagnostic.Code != "http3_certificate" || untrusted.ALPN != "" {
		t.Fatalf("untrusted certificate was not distinguished: %+v", untrusted)
	}
	options.UpstreamProxy = "http://127.0.0.1:1"
	proxied := e.diagnoseHTTP3(ctx, target, options, "selected")
	if proxied.Diagnostic == nil || proxied.Diagnostic.Code != "http3_proxy_unsupported" || proxied.ALPN != "" {
		t.Fatalf("proxy path attempted QUIC: %+v", proxied)
	}
}

func TestHTTP3QuietUDPTimeout(t *testing.T) {
	packet, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer packet.Close()
	peer := netip.MustParseAddrPort(packet.LocalAddr().String())
	target := &url.URL{Scheme: "https", Host: peer.String(), Path: "/"}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	result := model.HTTP3Diagnosis{}
	_, err = requestHTTP3(ctx, target, peer, &tls.Config{
		ServerName: target.Hostname(), MinVersion: tls.VersionTLS13, NextProtos: []string{http3.NextProtoH3},
	}, &result)
	if err == nil || http3Failure(target.Hostname(), result.ALPN, err).Code != "http3_timeout" {
		t.Fatalf("expected QUIC timeout, got %+v (%v)", result, err)
	}
}
