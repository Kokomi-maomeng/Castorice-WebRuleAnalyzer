package security

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

type Failure struct {
	Diagnostic model.Diagnostic
	Cause      error
}

func (e *Failure) Error() string { return e.Diagnostic.Message }
func (e *Failure) Unwrap() error { return e.Cause }

func Fail(code, stage, message, hint, host string, cause error) *Failure {
	d := model.Diagnostic{Code: code, Stage: stage, Message: message, Hint: hint, Host: host}
	if cause != nil {
		d.Detail = RedactText(cause.Error())
	}
	return &Failure{Diagnostic: d, Cause: cause}
}

func Explain(err error) *model.Diagnostic {
	if err == nil {
		return nil
	}
	var failure *Failure
	if errors.As(err, &failure) {
		d := failure.Diagnostic
		d.Addresses = append([]string{}, d.Addresses...)
		return &d
	}
	return &model.Diagnostic{Code: "operation_failed", Stage: "application", Message: RedactText(err.Error())}
}

func DNSError(host string, err error) error {
	var failure *Failure
	if errors.As(err, &failure) {
		return err
	}
	var dns *net.DNSError
	if errors.As(err, &dns) && dns.IsNotFound {
		return Fail("dns_not_found", "dns", "域名不存在或没有可用的地址记录: "+host, "请检查域名拼写；这不代表应自动改成名称相近的网站。", host, err)
	}
	var timeout net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &timeout) && timeout.Timeout() {
		return Fail("dns_timeout", "dns", "DNS 解析超时: "+host, "检查网络或代理连接，或在网络设置中选择其他安全 DNS。", host, err)
	}
	return Fail("dns_failed", "dns", "DNS 解析暂时失败: "+host, "请运行网络诊断，检查解析服务和代理环境后重试。", host, err)
}

func NavigationFailure(err error, status int, host string) *model.Diagnostic {
	if status >= 400 {
		hint := "网站或中间服务返回错误，请稍后重试。"
		switch status {
		case 401:
			hint = "网站要求登录；可使用辅助交互模式在受控浏览器中登录后观察。"
		case 403:
			hint = "服务器拒绝访问，可能与权限、地区或风控有关；可使用辅助交互模式核对。"
		case 404:
			hint = "服务器已响应，但此页面不存在，请检查路径。"
		case 429:
			hint = "请求过于频繁，请稍后重试并降低访问频率。"
		}
		return Explain(Fail(fmt.Sprintf("http_%d", status), "http", fmt.Sprintf("目标网站返回 HTTP %d", status), hint, host, err))
	}
	text := ""
	if err != nil {
		text = err.Error()
	}
	code, stage, message, hint := "navigation_failed", "navigation", "页面未能完成加载", "请运行网络诊断，或使用辅助交互模式检查实际页面。"
	switch {
	case strings.Contains(text, "ERR_TOO_MANY_REDIRECTS"):
		code, stage, message, hint = "redirect_loop", "navigation", "网站发生重定向循环", "请核对最后地址；稍后重试或检查网站的跳转配置。"
	case strings.Contains(text, "ERR_CERT_"):
		code, stage, message, hint = "tls_certificate", "tls", "网站证书验证失败", "请检查系统时间及网站证书；程序仍保留证书校验。"
	case strings.Contains(text, "ERR_SSL_"):
		code, stage, message, hint = "tls_handshake", "tls", "HTTPS 握手或协议协商失败", "检查目标是否支持 HTTPS，以及代理路径是否正常。"
	case strings.Contains(text, "ERR_NAME_NOT_RESOLVED"):
		code, stage, message, hint = "dns_failed", "dns", "浏览器未能解析目标域名", "请运行网络诊断检查 DNS。"
	case strings.Contains(text, "ERR_TUNNEL_") || strings.Contains(text, "ERR_PROXY_"):
		code, stage, message, hint = "proxy_connection", "proxy", "代理连接未能建立", "检查本机代理监听地址和当前代理连接。"
	case errors.Is(err, context.DeadlineExceeded) || strings.Contains(text, "ERR_TIMED_OUT"):
		code, stage, message, hint = "navigation_timeout", "navigation", "页面加载超过本次单页时间限制", "可增加单页等待时间，或使用辅助交互模式核对。"
	case strings.Contains(text, "ERR_CONNECTION_CLOSED") || strings.Contains(text, "ERR_CONNECTION_RESET"):
		code, stage, message, hint = "connection_closed", "connection", "连接被关闭或重置，未取得完整页面", "这不能证明域名拼写错误；请检查目标服务及代理路径。"
	case strings.Contains(text, "ERR_CONNECTION_REFUSED"):
		code, stage, message, hint = "connection_refused", "connection", "目标连接被拒绝", "检查网站端口与所选网络路径。"
	}
	return Explain(Fail(code, stage, message, hint, host, err))
}
