package scanner

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/crawler"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	cdpbrowser "github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

type Engine struct {
	Policy     security.Policy
	SessionDir string
}

const sessionMarker = ".castorice-session"
const sessionOwner = "Castorice-WebRuleAnalyzer\n"

func ValidateOptions(o model.ScanOptions) error {
	if o.DNSMode != "" && o.DNSMode != "auto" && o.DNSMode != "system" {
		return errors.New("未知 DNS 解析模式")
	}
	if o.Mode != "quick" && o.Mode != "explore" && o.Mode != "interactive" {
		return errors.New("未知扫描模式")
	}
	if o.MaxSeconds < 1 || o.MaxSeconds > 3600 || o.MaxDepth < 0 || o.MaxDepth > 8 || o.MaxPages < 1 || o.MaxPages > 200 || o.NavigationSeconds < 1 || o.NavigationSeconds > 120 || o.QuietMillis < 100 || o.QuietMillis > 30000 || o.IntervalMillis < 0 || o.IntervalMillis > 30000 || o.ObserveSeconds < 1 || o.ObserveSeconds > 300 {
		return errors.New("扫描参数超出允许范围")
	}
	return nil
}

func (e Engine) policyFor(o model.ScanOptions) (security.Policy, func()) {
	p := e.Policy
	if p.Resolver == nil && o.DNSMode != "system" {
		resolver := security.NewAutoResolver()
		p.Resolver = resolver
		return p, resolver.Close
	}
	return p, func() {}
}

func (e Engine) run(ctx context.Context, r *runtimeTask, target string) (string, error) {
	o := r.snapshot().Options
	policy, closeResolver := e.policyFor(o)
	defer closeResolver()
	if resolver, ok := policy.Resolver.(*security.AutoResolver); ok {
		resolver.OnFallback = func(host string) {
			r.log("INFO", "dns", "系统 DNS 返回 Fake-IP，使用固定端点 HTTPS DNS 重新校验: "+host)
		}
	}
	browserPath, err := browser.Find(o.BrowserPath)
	if err != nil {
		return "browser_start_failed", err
	}
	if err = os.MkdirAll(e.SessionDir, 0700); err != nil {
		return "profile_error", err
	}
	profile, err := os.MkdirTemp(e.SessionDir, "scan-")
	if err != nil {
		return "profile_error", err
	}
	defer func() {
		if removeProfile(profile) != nil {
			r.log("WARN", "cleanup", "临时 Profile 未完全删除，请在设置中清理残留会话。")
		}
	}()
	if err = os.WriteFile(filepath.Join(profile, sessionMarker), []byte(sessionOwner), 0600); err != nil {
		return "profile_error", err
	}
	proxy, err := security.StartProxy(ctx, policy, func(message string) { r.log("WARN", "network_guard", message) })
	if err != nil {
		return "proxy_error", err
	}
	defer proxy.Close()
	opts := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	opts = append(opts, chromedp.ExecPath(browserPath), chromedp.UserDataDir(profile), chromedp.Flag("headless", !o.Visible && o.Mode != "interactive"), chromedp.ProxyServer("http://"+proxy.Address), chromedp.Flag("proxy-bypass-list", "<-loopback>"), chromedp.Flag("disable-quic", true), chromedp.Flag("disable-extensions", true), chromedp.Flag("disable-background-networking", true), chromedp.Flag("disable-sync", true), chromedp.Flag("disable-popup-blocking", false), chromedp.Flag("force-webrtc-ip-handling-policy", "disable_non_proxied_udp"), chromedp.Flag("host-resolver-rules", "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"), chromedp.Flag("window-size", "1360,900"))
	opts = append(opts, chromedp.Flag("crash-dumps-dir", filepath.Join(e.SessionDir, "crashes")), chromedp.Flag("disable-crash-reporter", true))
	scopeOptions, closeScope := browserProcessScope(profile)
	opts = append(opts, scopeOptions...)
	allocCtx, cancelAllocator := chromedp.NewExecAllocator(ctx, opts...)
	defer func() { cancelAllocator(); closeScope() }()
	tabCtx, cancelTab := chromedp.NewContext(allocCtx, chromedp.WithErrorf(func(_ string, _ ...any) { /* Protocol diagnostics may contain unredacted URLs; task errors are logged separately. */
	}))
	defer cancelTab()
	chromedp.ListenTarget(tabCtx, r.onEvent)
	chromedp.ListenTarget(tabCtx, func(ev any) {
		if nav, ok := ev.(*page.EventNavigatedWithinDocument); ok {
			r.log("DEBUG", "spa", "SPA 路由变化: "+security.RedactURL(nav.URL))
		}
		if nav, ok := ev.(*page.EventFrameNavigated); ok && nav.Frame.ParentID == "" && o.Mode == "interactive" {
			u, err := url.Parse(nav.Frame.URL)
			if err == nil && (u.Scheme == "http" || u.Scheme == "https") {
				r.mu.Lock()
				safe := security.RedactURL(u.String())
				r.task.CurrentPage = safe
				found := false
				for _, p := range r.task.Pages {
					if p.URL == safe {
						found = true
					}
				}
				if !found {
					if len(r.task.Pages) >= o.MaxPages {
						r.limit = true
					} else {
						r.task.Pages = append(r.task.Pages, model.PageRecord{URL: safe, Depth: 0, Status: "visited"})
					}
				}
				r.revision++
				r.mu.Unlock()
			}
		}
	})
	r.log("INFO", "browser", "启动独立浏览器；临时 Profile；逐连接地址保护；不采集 Cookie、认证头或正文")
	if err = chromedp.Run(tabCtx, network.Enable(), cdpbrowser.SetDownloadBehavior(cdpbrowser.SetDownloadBehaviorBehaviorDeny)); err != nil {
		return "browser_start_failed", fmt.Errorf("浏览器启动失败: %s", security.RedactText(err.Error()))
	}
	r.mu.Lock()
	r.task.Status = "running"
	r.task.Browser = filepath.Base(browserPath)
	r.revision++
	r.mu.Unlock()
	lost := chromedp.FromContext(tabCtx).Browser.LostConnection
	startURL, err := domain.NormalizeURL(target)
	if err != nil {
		return "invalid_url", err
	}
	origin := domain.Origin(startURL)
	type queued struct {
		raw   string
		depth int
	}
	queue := []queued{{target, 0}}
	seen := map[string]bool{target: true}
	visited := 0
	navigationFailures := 0
	for len(queue) > 0 {
		if err = ctx.Err(); err != nil {
			return "interrupted", err
		}
		select {
		case <-lost:
			return "browser_exited", errors.New("受控浏览器已退出")
		default:
		}
		item := queue[0]
		queue = queue[1:]
		if visited >= o.MaxPages {
			r.page(item.raw, item.depth, "pending", "达到最大页面数量")
			for _, pending := range queue {
				r.page(pending.raw, pending.depth, "pending", "达到最大页面数量")
			}
			return "page_limit", nil
		}
		u, err := domain.NormalizeURL(item.raw)
		if err != nil {
			continue
		}
		if err = policy.Validate(ctx, u); err != nil {
			r.page(item.raw, item.depth, "blocked", err.Error())
			if visited == 0 {
				return "unsafe_target", err
			}
			continue
		}
		r.page(item.raw, item.depth, "visiting", "")
		r.log("INFO", "navigation", "访问 "+security.RedactURL(item.raw))
		navCtx, cancel := context.WithTimeout(tabCtx, time.Duration(o.NavigationSeconds)*time.Second)
		response, navErr := chromedp.RunResponse(navCtx, chromedp.Navigate(item.raw))
		cancel()
		if navErr == nil && response != nil && response.Status >= 400 {
			navErr = fmt.Errorf("目标页面返回 HTTP %d", response.Status)
		}
		visited++
		if navErr != nil {
			navigationFailures++
			r.page(item.raw, item.depth, "failed", security.RedactText(navErr.Error()))
			r.log("WARN", "navigation", "页面导航未完成: "+security.RedactText(navErr.Error()))
			if ctx.Err() != nil {
				return "interrupted", ctx.Err()
			}
			select {
			case <-lost:
				return "browser_exited", errors.New("受控浏览器意外退出")
			default:
			}
		} else {
			r.page(item.raw, item.depth, "visited", "")
			r.log("INFO", "page_loaded", "页面已加载，继续监听异步请求")
		}
		if o.Mode == "interactive" {
			r.log("INFO", "interactive", "辅助采集已开始；请在受控浏览器当前标签页操作，完成后点击停止。新标签页/独立 Worker 的覆盖有限。")
			ticker := time.NewTicker(200 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return "interrupted", ctx.Err()
				case <-lost:
					return "browser_exited", errors.New("受控浏览器已退出")
				case <-ticker.C:
					r.mu.Lock()
					limited := r.limit
					r.mu.Unlock()
					if limited {
						return "resource_limit", nil
					}
				}
			}
		}
		if navErr != nil {
			if o.Mode == "quick" {
				return "navigation_failed", fmt.Errorf("目标页面未能完成导航: %s；已观察请求仍可查看和导出", security.RedactText(navErr.Error()))
			}
			continue
		}
		_ = chromedp.Run(tabCtx, chromedp.Evaluate(`window.scrollTo({top:Math.min(document.body.scrollHeight,12000),behavior:'instant'})`, nil))
		if err = waitObservation(tabCtx, r, time.Duration(o.ObserveSeconds)*time.Second, time.Duration(o.QuietMillis)*time.Millisecond, lost); err != nil {
			if ctx.Err() == nil {
				return "browser_exited", err
			}
			return "interrupted", err
		}
		if o.Mode == "quick" {
			r.mu.Lock()
			limited := r.limit
			r.mu.Unlock()
			if limited {
				return "request_limit", nil
			}
			return "completed", nil
		}
		r.mu.Lock()
		limited := r.limit
		r.mu.Unlock()
		if limited {
			return "request_limit", nil
		}
		var rawLinks []string
		var current string
		if err = chromedp.Run(tabCtx, chromedp.Location(&current), chromedp.Evaluate(`Array.from(document.querySelectorAll('a[href]')).slice(0,1000).map(a=>a.href)`, &rawLinks)); err != nil {
			r.log("WARN", "explore", "本页链接发现失败，继续处理队列")
		} else {
			base, _ := url.Parse(current)
			if base == nil {
				return "navigation_failed", errors.New("无法读取最终页面地址")
			}
			if err = policy.Validate(ctx, base); err != nil {
				return "unsafe_target", err
			}
			r.mu.Lock()
			r.task.CurrentPage = security.RedactPageURL(current)
			r.revision++
			r.mu.Unlock()
			if domain.Origin(base) != origin {
				canonical, allowed := crawler.CanonicalOrigin(startURL, base)
				if !allowed {
					r.log("WARN", "explore", "跳转到不同站点，仅观察当前页；可使用最终页面地址重新分析。")
					return "origin_changed", nil
				}
				origin = canonical
				seen[current] = true
				r.log("INFO", "explore", "已采用通过地址校验的规范来源继续同源探索: "+security.RedactPageURL(current))
			}
			for _, raw := range rawLinks {
				if len(seen) >= 2000 {
					break
				}
				link, reason := crawler.SafeLink(base, raw, origin)
				if reason != "" {
					if len(r.snapshot().Pages) < 1000 {
						r.page(raw, item.depth+1, "skipped", reason)
					}
					continue
				}
				if seen[link] {
					continue
				}
				seen[link] = true
				if item.depth >= o.MaxDepth {
					r.page(link, item.depth+1, "pending", "达到最大探索深度")
					continue
				}
				queue = append(queue, queued{link, item.depth + 1})
				r.page(link, item.depth+1, "queued", "")
			}
		}
		r.log("INFO", "explore", fmt.Sprintf("已访问 %d 页，待访问 %d 页", visited, len(queue)))
		if err = pause(ctx, time.Duration(o.IntervalMillis)*time.Millisecond); err != nil {
			return "interrupted", err
		}
	}
	if visited > 0 && navigationFailures == visited {
		return "navigation_failed", errors.New("本次所有页面均未能完成导航")
	}
	return "completed", nil
}

// Kept separate to avoid network-idle hangs on polling/streaming/WebSockets. The
// observation window is a hard per-page ceiling, even if requests never stop.
func waitObservation(ctx context.Context, r *runtimeTask, window, quiet time.Duration, lost <-chan struct{}) error {
	started := time.Now()
	timer := time.NewTimer(window)
	defer timer.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	minimum := min(window, 2*time.Second)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-lost:
			return errors.New("受控浏览器意外退出")
		case <-timer.C:
			return nil
		case <-ticker.C:
			r.mu.Lock()
			last, limit := r.lastRequest, r.limit
			r.mu.Unlock()
			if limit || time.Since(started) >= minimum && time.Since(last) >= quiet {
				return nil
			}
		}
	}
}
func pause(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
func (r *runtimeTask) page(raw string, depth int, status, reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	safe := security.RedactPageURL(raw)
	for i, p := range r.task.Pages {
		if p.URL == safe {
			if p.Status == "visited" || p.Status == "failed" {
				return
			}
			r.task.Pages[i].Status = status
			r.task.Pages[i].Reason = reason
			if status == "visiting" {
				r.task.CurrentPage = safe
			}
			r.revision++
			return
		}
	}
	if len(r.task.Pages) < 1000 {
		r.task.Pages = append(r.task.Pages, model.PageRecord{URL: safe, Depth: depth, Status: status, Reason: reason})
		if status == "visiting" {
			r.task.CurrentPage = safe
		}
		r.revision++
	}
}
