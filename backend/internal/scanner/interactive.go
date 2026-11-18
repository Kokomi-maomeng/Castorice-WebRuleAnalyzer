package scanner

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

func runInteractive(ctx context.Context, r *runtimeTask, proxy *security.GuardProxy, target string, lost <-chan struct{}) (string, error) {
	r.mu.Lock()
	r.pageFailureFor = proxy.FailureFor
	r.mu.Unlock()
	r.log("INFO", "interactive", "请在受控浏览器当前标签页操作，完成后点击停止。新标签页与独立 Worker 的覆盖有限。")
	navCtx, cancel := context.WithTimeout(ctx, time.Duration(r.snapshot().Options.NavigationSeconds)*time.Second)
	_, err := chromedp.RunResponse(navCtx, chromedp.Navigate(target))
	cancel()
	if err != nil && ctx.Err() == nil {
		r.mu.Lock()
		if r.pageURL == "" {
			r.pageURL = navigationURL(target)
		}
		r.finishInteractiveDocument(err, false)
		r.mu.Unlock()
	}

	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		r.mu.Lock()
		pageLimit, requestLimit := r.pageLimit, r.limit
		r.mu.Unlock()
		if pageLimit {
			r.refreshInteractiveTitle(ctx)
			r.log("INFO", "page_limit", "已达到辅助交互的页面数量上限")
			return "page_limit", nil
		}
		if requestLimit {
			return "request_limit", nil
		}
		select {
		case <-ctx.Done():
			return "interrupted", ctx.Err()
		case <-lost:
			return "browser_exited", errors.New("受控浏览器已退出")
		case <-ticker.C:
			r.refreshInteractiveTitle(ctx)
		}
	}
}

func navigationURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	return security.RedactPageURL(raw)
}

// The caller owns r.mu. The main document request follows its redirect hops
// and only commits a coverage result on a terminal network event.
func (r *runtimeTask) onInteractiveEvent(ev any) {
	switch e := ev.(type) {
	case *network.EventRequestWillBeSent:
		if e.Type != network.ResourceTypeDocument || e.FrameID != r.mainFrame {
			return
		}
		safe := navigationURL(e.Request.URL + e.Request.URLFragment)
		if safe == "" {
			return
		}
		if r.pageRequest != e.RequestID {
			r.finishInteractiveDocument(errors.New("已开始另一页面导航"), true)
		}
		r.pageRequest, r.pageLoader, r.pageURL = e.RequestID, e.LoaderID, safe
		r.pageRoute, r.pageResult = "", ""
		r.task.CurrentPage, r.task.MainStatus, r.task.PageTitle = safe, 0, ""
		r.task.Diagnostic = nil
		r.pageVersion++
		r.revision++
	case *network.EventResponseReceived:
		if r.pageURL != "" && e.RequestID == r.pageRequest && e.Response != nil {
			r.task.MainStatus = int(e.Response.Status)
			r.revision++
		}
	case *network.EventLoadingFinished:
		if r.pageURL != "" && e.RequestID == r.pageRequest {
			r.finishInteractiveDocument(nil, false)
		}
	case *network.EventLoadingFailed:
		if r.pageURL != "" && e.RequestID == r.pageRequest {
			r.finishInteractiveDocument(errors.New(e.ErrorText), e.Canceled)
		}
	case *page.EventFrameNavigated:
		if r.pageURL != "" && e.Frame.ID == r.mainFrame && e.Frame.LoaderID == r.pageLoader {
			if safe := navigationURL(e.Frame.URL + e.Frame.URLFragment); safe != "" {
				r.pageURL = safe
				if r.pageRoute == "" {
					r.task.CurrentPage = safe
				}
				r.revision++
			}
		}
	case *page.EventNavigatedWithinDocument:
		if e.FrameID != r.mainFrame || r.pageRequest == "" {
			return
		}
		if safe := navigationURL(e.URL); safe != "" {
			r.task.CurrentPage, r.task.PageTitle, r.pageRoute = safe, "", safe
			r.pageVersion++
			if r.pageResult == "visited" {
				r.saveInteractivePage(model.PageRecord{URL: safe, Status: "visited"})
			}
			r.logLocked("DEBUG", "spa", "同文档导航: "+safe)
		}
	}
}

func (r *runtimeTask) finishInteractiveDocument(err error, interrupted bool) {
	if r.pageURL == "" {
		return
	}
	record := model.PageRecord{URL: r.pageURL, Status: "visited"}
	r.pageURL = ""
	status := r.task.MainStatus
	switch {
	case interrupted:
		record.Status = "interrupted"
		record.Reason = "页面导航已中断"
	case err != nil || status < 200 || status >= 400:
		record.Status = "failed"
		if err == nil {
			err = errors.New("未收到成功响应")
		}
		u, _ := url.Parse(record.URL)
		record.Diagnostic = security.NavigationFailure(err, status, u.Hostname())
		if r.pageFailureFor != nil {
			if d := r.pageFailureFor(u.Hostname()); d != nil {
				record.Diagnostic = d
				if d.Stage == "safety" {
					record.Status = "blocked"
				}
			}
		}
		record.Reason = record.Diagnostic.Message
		r.task.Diagnostic = record.Diagnostic
	}
	r.pageResult = record.Status
	r.saveInteractivePage(record)
	if r.pageRoute != "" && r.pageResult == "visited" && record.URL != r.pageRoute {
		r.saveInteractivePage(model.PageRecord{URL: r.pageRoute, Status: "visited"})
	}
}

func (r *runtimeTask) saveInteractivePage(record model.PageRecord) {
	for i, old := range r.task.Pages {
		if record.URL == old.URL {
			r.task.Pages[i] = record
			r.revision++
			return
		}
	}
	if len(r.task.Pages) >= r.task.Options.MaxPages {
		r.pageLimit = true
		return
	}
	r.task.Pages = append(r.task.Pages, record)
	r.pageLimit = len(r.task.Pages) >= r.task.Options.MaxPages
	r.revision++
}

func (r *runtimeTask) refreshInteractiveTitle(ctx context.Context) {
	r.mu.Lock()
	version := r.pageVersion
	r.mu.Unlock()
	var meta struct{ Title, URL string }
	titleCtx, cancel := context.WithTimeout(ctx, 600*time.Millisecond)
	defer cancel()
	if err := chromedp.Run(titleCtx, chromedp.Evaluate(`({Title: document.title, URL: location.href})`, &meta)); err != nil {
		return
	}
	safe := navigationURL(meta.URL)
	title := []rune(security.RedactText(meta.Title))
	if len(title) > 240 {
		title = title[:240]
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if safe != "" && version == r.pageVersion && safe == r.task.CurrentPage && r.task.PageTitle != string(title) {
		r.task.PageTitle = string(title)
		r.revision++
	}
}
