package scanner

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
)

var http3Alternative = regexp.MustCompile(`(?:^|,)\s*h3\s*=\s*"[^"]+"`)

func (e Engine) diagnoseHTTP3(ctx context.Context, u *url.URL, o model.ScanOptions, mode string) model.HTTP3Diagnosis {
	host := u.Hostname()
	result := model.HTTP3Diagnosis{Route: "系统网络 UDP（可由 TUN 接管）"}
	if mode == "direct" {
		o.UpstreamProxy = ""
		result.Route = "独立使用系统网络 UDP（可由 TUN 接管）"
	} else if o.UpstreamProxy != "" {
		scheme, _, _ := strings.Cut(o.UpstreamProxy, ":")
		result.Route = "本机 " + strings.ToUpper(scheme) + " 代理"
	}
	switch o.DNSMode {
	case "secure":
		result.Route += " · 独立安全 DNS"
	case "system":
		result.Route += " · 系统 DNS"
	default:
		result.Route += " · 自动 DNS（已知 Fake-IP 可回退）"
	}
	if u.Scheme != "https" {
		result.Diagnostic = security.Explain(security.Fail("http3_https_required", "http3", "HTTP/3 探测需要 HTTPS 地址", "可在主界面明确输入 https:// 开头的网址。", host, nil))
		return result
	}
	policy, closeResolver := e.policyFor(o)
	defer closeResolver()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	advertisement := make(chan *bool, 1)
	go func() { advertisement <- probeHTTPSAdvertisement(ctx, u, policy) }()

	var advertisedOverQUIC bool
	if policy.UpstreamProxy != "" {
		result.Diagnostic = security.Explain(security.Fail("http3_proxy_unsupported", "http3", "当前所选代理路径未提供 UDP 转发", "可在网络诊断里明确选择独立使用系统网络探测 HTTP/3。", host, nil))
	} else {
		var err error
		advertisedOverQUIC, err = probeQUIC(ctx, u, policy, &result)
		if err != nil {
			result.Diagnostic = http3Failure(host, result.ALPN, err)
		}
	}
	result.Advertised = <-advertisement
	if result.Advertised != nil {
		result.AdvertisementSource = "HTTPS（TCP）响应"
	}
	if result.HTTPStatus != 0 && (result.Advertised == nil || advertisedOverQUIC && !*result.Advertised) {
		result.Advertised = &advertisedOverQUIC
		result.AdvertisementSource = "HTTP/3 响应"
	}
	return result
}

func advertisesHTTP3(h http.Header) bool {
	return slices.ContainsFunc(h.Values("Alt-Svc"), http3Alternative.MatchString)
}

func probeHTTPSAdvertisement(ctx context.Context, u *url.URL, policy security.Policy) *bool {
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil
	}
	transport := &http.Transport{
		DialContext: policy.DialContext, ForceAttemptHTTP2: true,
		TLSHandshakeTimeout: 4 * time.Second, MaxResponseHeaderBytes: 32 << 10,
		DisableCompression: true,
	}
	defer transport.CloseIdleConnections()
	// RoundTrip exposes the site's initial response without following redirects.
	resp, err := transport.RoundTrip(request)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	advertised := advertisesHTTP3(resp.Header)
	return &advertised
}

func probeQUIC(ctx context.Context, u *url.URL, policy security.Policy, result *model.HTTP3Diagnosis) (bool, error) {
	host, port := u.Hostname(), u.Port()
	if port == "" {
		port = "443"
	}
	ips, err := policy.Resolve(ctx, host, port)
	if err != nil {
		return false, err
	}
	portNum, err := strconv.ParseUint(port, 10, 16)
	if err != nil {
		return false, err
	}
	// Prefer an IPv4 and an IPv6 address before trying additional addresses
	// within the overall diagnostic deadline.
	var candidates []netip.Addr
	for _, v4 := range []bool{true, false} {
		i := slices.IndexFunc(ips, func(ip netip.Addr) bool { return ip.Unmap().Is4() == v4 })
		if i >= 0 {
			candidates = append(candidates, ips[i].Unmap())
		}
	}
	for _, ip := range ips {
		if !slices.Contains(candidates, ip.Unmap()) {
			candidates = append(candidates, ip.Unmap())
		}
	}
	config := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS13, NextProtos: []string{http3.NextProtoH3}}
	var last error
	for _, ip := range candidates[:min(4, len(candidates))] {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		remote := netip.AddrPortFrom(ip, uint16(portNum))
		attempt, cancel := context.WithTimeout(ctx, 4*time.Second)
		advertised, attemptErr := requestHTTP3(attempt, u, remote, config, result)
		cancel()
		last = attemptErr
		var cert *tls.CertificateVerificationError
		if attemptErr == nil || result.ALPN != "" || errors.As(attemptErr, &cert) {
			return advertised, attemptErr
		}
	}
	return false, last
}

// A connected UDP socket can send only to the literal address approved by
// Policy.Resolve, including if a peer advertises a QUIC migration endpoint.
type pinnedUDPSocket struct {
	net.Conn
	peer *net.UDPAddr
}

func (s pinnedUDPSocket) ReadFrom(p []byte) (int, net.Addr, error) {
	n, err := s.Read(p)
	return n, s.peer, err
}

func (s pinnedUDPSocket) WriteTo(p []byte, dst net.Addr) (int, error) {
	peer, ok := dst.(*net.UDPAddr)
	if !ok || peer.AddrPort() != s.peer.AddrPort() {
		return 0, errors.New("QUIC 请求了未经地址校验的 UDP 端点")
	}
	return s.Write(p)
}

func requestHTTP3(ctx context.Context, u *url.URL, address netip.AddrPort, config *tls.Config, result *model.HTTP3Diagnosis) (bool, error) {
	socket, err := (&net.Dialer{}).DialContext(ctx, "udp", address.String())
	if err != nil {
		return false, err
	}
	defer socket.Close()
	peer := net.UDPAddrFromAddrPort(address)
	transport := &quic.Transport{Conn: pinnedUDPSocket{Conn: socket, peer: peer}}
	defer transport.Close()
	conn, err := transport.Dial(ctx, peer, config, &quic.Config{
		HandshakeIdleTimeout:    2500 * time.Millisecond,
		MaxIdleTimeout:          5 * time.Second,
		MaxIncomingStreams:      -1,
		MaxIncomingUniStreams:   8,
		DisablePathMTUDiscovery: true,
	})
	if err != nil {
		return false, err
	}
	defer conn.CloseWithError(0, "")
	result.ALPN = conn.ConnectionState().TLS.NegotiatedProtocol
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return false, err
	}
	httpTransport := &http3.Transport{MaxResponseHeaderBytes: 32 << 10, DisableCompression: true}
	resp, err := httpTransport.NewClientConn(conn).RoundTrip(request)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	result.HTTPStatus = resp.StatusCode
	return advertisesHTTP3(resp.Header), nil
}

func http3Failure(host, alpn string, err error) *model.Diagnostic {
	var failure *security.Failure
	if errors.As(err, &failure) {
		return security.Explain(err)
	}
	var cert *tls.CertificateVerificationError
	var networkError net.Error
	code, message, hint := "http3_quic_failed", "未能协商 QUIC / HTTP/3", "请确认站点支持 HTTP/3，所选网络允许 UDP。"
	switch {
	case errors.As(err, &cert):
		code, message, hint = "http3_certificate", "HTTP/3 TLS 证书验证失败", "请确认目标域名、证书及本机时间。"
	case errors.Is(err, context.DeadlineExceeded) || errors.As(err, &networkError) && networkError.Timeout():
		code, message = "http3_timeout", "HTTP/3 探测超时"
		if alpn != "" {
			message, hint = "已协商 HTTP/3，等待 HTTP 响应超时", "站点已建立 QUIC 连接，可等待后重试。"
		}
	case alpn != "":
		code, message, hint = "http3_response_failed", "已协商 HTTP/3，未收到有效 HTTP 响应", "请检查站点的 HTTP/3 服务。"
	}
	return security.Explain(security.Fail(code, "http3", message, hint, host, err))
}
