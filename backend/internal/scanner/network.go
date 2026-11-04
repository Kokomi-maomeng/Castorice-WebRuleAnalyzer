package scanner

import (
	"context"
	"net"
	"net/netip"
	"strings"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

func (m *Manager) History(q string, limit, offset int) (storage.HistoryPage, error) {
	page, err := m.store.History(q, limit, offset)
	if err != nil {
		return page, err
	}
	m.mu.Lock()
	r := m.active
	m.mu.Unlock()
	if r != nil {
		task := r.snapshot()
		for i, old := range page.Items {
			if old.ID == task.ID {
				page.Items[i] = task
			}
		}
	}
	return page, nil
}
func (m *Manager) DeleteHistory(ids []string, all bool) (storage.HistoryDeletion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	activeID := ""
	if m.active != nil {
		activeID = m.active.task.ID
	}
	return m.store.DeleteHistory(ids, all, activeID)
}

func (m *Manager) Diagnose(ctx context.Context, raw string, o model.ScanOptions) (model.NetworkDiagnosis, error) {
	result := model.NetworkDiagnosis{DNSMode: o.DNSMode, DNSProvider: o.DNSProvider, Route: "系统网络（可由 TUN 接管）"}
	if err := ValidateOptions(o); err != nil {
		return result, err
	}
	u, err := domain.NormalizeURL(raw)
	if err != nil {
		return result, security.Fail("invalid_url", "input", err.Error(), "请输入有效的 HTTP(S) 网站地址。", "", nil)
	}
	host := u.Hostname()
	result.URL = security.RedactURL(u.String())
	result.Host = host
	if result.DNSProvider == "" {
		result.DNSProvider = "cloudflare"
	}
	if o.UpstreamProxy != "" {
		result.Route = "本机 " + strings.ToUpper(strings.Split(o.UpstreamProxy, ":")[0]) + " 代理"
	}
	port := u.Port()
	if port == "" {
		port = "443"
		if u.Scheme == "http" {
			port = "80"
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	check := func(p security.Policy) model.DNSCheck {
		ips, e := p.Resolve(ctx, host, port)
		out := model.DNSCheck{Addresses: []string{}, Diagnostic: security.Explain(e)}
		for _, ip := range ips {
			out.Addresses = append(out.Addresses, ip.String())
		}
		if out.Diagnostic != nil {
			out.Addresses = append(out.Addresses, out.Diagnostic.Addresses...)
		}
		return out
	}
	// Never send internal hostnames or private literal targets to external DNS.
	if ip, e := netip.ParseAddr(host); security.InternalHost(host) || e == nil && !security.PublicIP(ip) {
		result.System = check(security.Policy{})
		result.Secure = result.System
		result.Connection = result.System.Diagnostic
		return result, nil
	}
	system := security.Policy{Resolver: net.DefaultResolver}
	result.System = check(system)
	secureOptions := o
	secureOptions.DNSMode = "secure"
	secure, closeSecure := m.engine.policyFor(secureOptions)
	defer closeSecure()
	result.Secure = check(secure)
	selected, closeSelected := m.engine.policyFor(o)
	defer closeSelected()
	connectCtx, connectCancel := context.WithTimeout(ctx, 8*time.Second)
	defer connectCancel()
	conn, e := selected.DialContext(connectCtx, "tcp", net.JoinHostPort(host, port))
	if e != nil {
		result.Connection = security.Explain(e)
	} else {
		result.Connected = true
		_ = conn.Close()
	}
	return result, nil
}
