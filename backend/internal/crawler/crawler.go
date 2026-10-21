package crawler

import (
	"net/url"
	"path"
	"regexp"
	"strings"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
)

var unsafePath = regexp.MustCompile(`(?i)(^|[/_.-])(logout|signout|delete|remove|purchase|checkout|payment|pay|send|unsubscribe|reset|confirm|activate|cart|add-to-cart|download)([/_.-]|$)`)

// Navigation never clicks arbitrary controls. Reject query-bearing links and
// known action routes as a conservative first-release policy.
func SafeLink(base *url.URL, raw, origin string) (string, string) {
	candidate, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "链接无效"
	}
	u := base.ResolveReference(candidate)
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", "非 HTTP(S) 链接"
	}
	if u.User != nil || u.RawQuery != "" || unsafePath.MatchString(u.Path) || unsafePath.MatchString(strings.TrimPrefix(u.Fragment, "!")) || strings.Contains(u.Fragment, "?") {
		return "", "查询参数、凭据或可能产生副作用的路径，未自动访问"
	}
	fragment := u.Fragment
	if fragment != "" && !strings.HasPrefix(fragment, "/") && !strings.HasPrefix(fragment, "!/") {
		return "", "普通页内锚点"
	}
	normalized, err := domain.NormalizeURL(u.String())
	if err != nil {
		return "", "链接无效"
	}
	if domain.Origin(normalized) != origin {
		return "", "第三方页面，未主动导航"
	}
	for _, ext := range []string{".pdf", ".zip", ".exe", ".msi", ".dmg", ".png", ".jpg", ".webp", ".svg", ".mp4", ".mp3", ".woff", ".woff2", ".css", ".js"} {
		if strings.EqualFold(path.Ext(normalized.Path), ext) {
			return "", "资源或下载链接"
		}
	}
	normalized.Fragment = fragment
	return normalized.String(), ""
}
