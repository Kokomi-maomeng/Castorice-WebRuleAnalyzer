package security

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	xproxy "golang.org/x/net/proxy"
)

// The proxy is a separately configured local connector, never a target exemption.
// Credentials and arbitrary remote proxy endpoints are intentionally unsupported.
func ValidateProxy(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u == nil {
		return errors.New("本机代理地址无效")
	}
	ip, e := netip.ParseAddr(u.Hostname())
	port, pe := strconv.Atoi(u.Port())
	if (u.Scheme != "http" && u.Scheme != "socks5") || e != nil || !ip.IsLoopback() || pe != nil || port < 1 || port > 65535 || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("本机代理须为 http:// 或 socks5://回环IP:端口，不包含认证、路径或参数")
	}
	return nil
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

type handshakeReader struct {
	io.Reader
	left    int
	limited bool
}

func (r *handshakeReader) Read(p []byte) (int, error) {
	if r.limited {
		if r.left <= 0 {
			return 0, errors.New("代理响应头过大")
		}
		if len(p) > r.left {
			p = p[:r.left]
		}
	}
	n, e := r.Reader.Read(p)
	if r.limited {
		r.left -= n
	}
	return n, e
}

func DialOutbound(ctx context.Context, upstream, address string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: 8 * time.Second, KeepAlive: 20 * time.Second}
	if upstream == "" {
		return dialer.DialContext(ctx, "tcp", address)
	}
	if err := ValidateProxy(upstream); err != nil {
		return nil, err
	}
	u, _ := url.Parse(upstream)
	if u.Scheme == "socks5" {
		d, err := xproxy.SOCKS5("tcp", u.Host, nil, dialer)
		if err != nil {
			return nil, err
		}
		return d.(xproxy.ContextDialer).DialContext(ctx, "tcp", address)
	}
	conn, err := dialer.DialContext(ctx, "tcp", u.Host)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			_ = conn.Close()
		}
	}()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	deadline := time.Now().Add(8 * time.Second)
	if d, exists := ctx.Deadline(); exists && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)
	if _, err = fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", address, address); err != nil {
		return nil, err
	}
	bounded := &handshakeReader{Reader: conn, left: 16 << 10, limited: true}
	reader := bufio.NewReader(bounded)
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	parts := strings.Fields(line)
	if len(parts) < 2 || !strings.HasPrefix(parts[0], "HTTP/1.") || parts[1] != "200" {
		return nil, errors.New("本机 HTTP 代理未接受连接隧道")
	}
	for {
		line, err = reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		if line == "\r\n" || line == "\n" {
			break
		}
	}
	bounded.limited = false
	_ = conn.SetDeadline(time.Time{})
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	ok = true
	return &bufferedConn{Conn: conn, reader: reader}, nil
}
