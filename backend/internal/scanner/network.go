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

func (m *Manager) Diagnose(ctx context.Context, raw string, o model.ScanOptions, compareSecure bool, http3Mode string) (model.NetworkDiagnosis, error) {
	result := model.NetworkDiagnosis{DNSMode: o.DNSMode, DNSProvider: o.DNSProvider, Route: "系统网络（可由 TUN 接管）"}
	if err := ValidateOptions(o); err != nil {
		return result, err
	}
	if http3Mode != "" && http3Mode != "selected" && http3Mode != "direct" {
		return result, security.Fail("invalid_http3_mode", "input", "未知的 HTTP/3 探测路径", "", "", nil)
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
	var http3Result chan model.HTTP3Diagnosis
	if http3Mode != "" {
		http3Result = make(chan model.HTTP3Diagnosis, 1)
		go func() { http3Result <- m.engine.diagnoseHTTP3(ctx, u, o, http3Mode) }()
	}
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
	system := m.engine.Policy
	system.UpstreamProxy = o.UpstreamProxy
	result.System = check(system)
	selected, selectedDNS := system, "系统 DNS"
	_, literal := netip.ParseAddr(host)
	if (o.DNSMode == "secure" || compareSecure) && literal != nil && !security.InternalHost(host) && safeToCompare(result.System) {
		secureOptions := o
		secureOptions.DNSMode = "secure"
		secure, closeSecure := m.engine.policyFor(secureOptions)
		defer closeSecure()
		secureCheck := check(secure)
		result.Secure = &secureCheck
		if o.DNSMode == "secure" {
			selected, selectedDNS = secure, "独立安全 DNS"
		}
	} else if o.DNSMode == "secure" || compareSecure {
		result.SecureNote = "目标是 IP 地址或系统解析指向内部／受限网络，未向外部服务查询名称。"
	} else if o.DNSMode != "system" {
		result.SecureNote = "当前 TCP 诊断使用系统 DNS。扫描在自动模式下可对已知 Fake-IP 执行安全 DNS 回退。"
	}
	result.Route += " · " + selectedDNS
	connectCtx, connectCancel := context.WithTimeout(ctx, 8*time.Second)
	defer connectCancel()
	conn, e := selected.DialContext(connectCtx, "tcp", net.JoinHostPort(host, port))
	if e != nil {
		result.Connection = security.Explain(e)
	} else {
		result.Connected = true
		_ = conn.Close()
	}
	if http3Result != nil {
		outcome := <-http3Result
		result.HTTP3 = &outcome
	}
	return result, nil
}

func safeToCompare(check model.DNSCheck) bool {
	if check.Diagnostic == nil || check.Diagnostic.Stage != "safety" {
		return true
	}
	// When explicitly requested, allow comparison of known synthetic Fake-IP
	// answers, while keeping names with genuine non-public answers local.
	if check.Diagnostic.Code != "dns_non_public" || len(check.Addresses) == 0 {
		return false
	}
	for _, address := range check.Addresses {
		ip, err := netip.ParseAddr(address)
		if err != nil || !security.IsFakeAddress(ip) {
			return false
		}
	}
	return true
}
