package security

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// GuardProxy tunnels TLS without decrypting it. The actual TCP destination is
// always resolved and pinned by Policy, including redirects and subresources.
type GuardProxy struct {
	Address   string
	policy    Policy
	ctx       context.Context
	cancel    context.CancelFunc
	server    *http.Server
	transport *http.Transport
	mu        sync.Mutex
	conns     map[net.Conn]bool
	slots     chan struct{}
	onBlock   func(string)
}

func StartProxy(parent context.Context, p Policy, onBlock func(string)) (*GuardProxy, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	proxy := &GuardProxy{Address: listener.Addr().String(), policy: p, ctx: ctx, cancel: cancel, conns: map[net.Conn]bool{}, slots: make(chan struct{}, 64), onBlock: onBlock}
	proxy.transport = &http.Transport{DialContext: p.DialContext, Proxy: nil, MaxIdleConns: 64, MaxConnsPerHost: 16, IdleConnTimeout: 20 * time.Second, ResponseHeaderTimeout: 30 * time.Second, ForceAttemptHTTP2: false}
	proxy.server = &http.Server{Handler: proxy, ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 64 << 10, BaseContext: func(net.Listener) context.Context { return ctx }}
	go func() { _ = proxy.server.Serve(listener) }()
	return proxy, nil
}

func (p *GuardProxy) Close() {
	p.cancel()
	_ = p.server.Close()
	p.transport.CloseIdleConnections()
	p.mu.Lock()
	defer p.mu.Unlock()
	for c := range p.conns {
		_ = c.Close()
	}
}

func (p *GuardProxy) track(c net.Conn, add bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if add {
		p.conns[c] = true
	} else {
		delete(p.conns, c)
	}
}
func (p *GuardProxy) block(w http.ResponseWriter, err error) {
	if p.onBlock != nil {
		p.onBlock(RedactText(err.Error()))
	}
	http.Error(w, "目标被安全策略阻止或连接失败", http.StatusBadGateway)
}

func (p *GuardProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select {
	case p.slots <- struct{}{}:
		defer func() { <-p.slots }()
	case <-p.ctx.Done():
		http.Error(w, "任务已停止", 503)
		return
	default:
		http.Error(w, "连接数量已达上限", 429)
		return
	}
	if r.Method == http.MethodConnect {
		destination := r.Host
		if _, _, err := net.SplitHostPort(destination); err != nil {
			p.block(w, errors.New("CONNECT 地址无效"))
			return
		}
		upstream, err := p.policy.DialContext(p.ctx, "tcp", destination)
		if err != nil {
			p.block(w, err)
			return
		}
		defer upstream.Close()
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			return
		}
		client, buffer, err := hijacker.Hijack()
		if err != nil {
			return
		}
		defer client.Close()
		p.track(client, true)
		p.track(upstream, true)
		defer p.track(client, false)
		defer p.track(upstream, false)
		_, _ = buffer.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		if buffer.Flush() != nil {
			return
		}
		done := make(chan struct{})
		go func() { _, _ = io.Copy(upstream, buffer); _ = upstream.Close(); close(done) }()
		_, _ = io.Copy(client, upstream)
		_ = client.Close()
		_ = upstream.Close()
		<-done
		return
	}
	if r.URL.Scheme != "http" || r.URL.Host == "" {
		p.block(w, errors.New("代理仅接受 HTTP 或 CONNECT"))
		return
	}
	r.RequestURI = ""
	r.Header.Del("Proxy-Connection")
	r.Header.Del("Proxy-Authorization")
	response, err := p.transport.RoundTrip(r)
	if err != nil {
		p.block(w, err)
		return
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusSwitchingProtocols {
		upstream, ok := response.Body.(io.ReadWriteCloser)
		if !ok {
			return
		}
		client, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer client.Close()
		p.track(client, true)
		defer p.track(client, false)
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\n")
		_ = response.Header.Write(buffer)
		_, _ = buffer.WriteString("\r\n")
		_ = buffer.Flush()
		done := make(chan struct{})
		go func() { _, _ = io.Copy(upstream, buffer); _ = upstream.Close(); close(done) }()
		_, _ = io.Copy(client, upstream)
		_ = client.Close()
		_ = upstream.Close()
		<-done
		return
	}
	for key, values := range response.Header {
		if strings.EqualFold(key, "Connection") {
			continue
		}
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}
