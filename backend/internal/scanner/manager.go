package scanner

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/matcher"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

var ErrBusy = errors.New("已有扫描正在运行，请先停止或等待完成")
var ErrRecordingInactive = errors.New("只能在自行交互期间暂停或继续记录")

type Manager struct {
	mu     sync.Mutex
	store  *storage.Store
	rules  *rules.Manager
	engine Engine
	active *runtimeTask
	root   context.Context
	cancel context.CancelFunc
}

func NewManager(store *storage.Store, rules *rules.Manager, engine Engine) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{store: store, rules: rules, engine: engine, root: ctx, cancel: cancel}
}
func (m *Manager) Close() {
	m.cancel()
	m.mu.Lock()
	r := m.active
	m.mu.Unlock()
	if r != nil {
		select {
		case <-r.done:
		case <-time.After(15 * time.Second):
		}
	}
}

func (m *Manager) Start(ctx context.Context, raw string, options model.ScanOptions) (model.ScanTask, error) {
	return m.start(ctx, raw, options, false)
}

func (m *Manager) StartSite(ctx context.Context, raw string, options model.ScanOptions) (model.ScanTask, error) {
	return m.start(ctx, raw, options, true)
}

func (m *Manager) PrepareTarget(raw string) (domain.ScanTarget, error) {
	target, err := domain.PrepareScanTarget(raw)
	if err != nil {
		return target, security.Fail("invalid_url", "input", err.Error(), "", "", nil)
	}
	u, _ := url.Parse(target.URL)
	port := u.Port()
	if port == "" {
		port = "443"
		if u.Scheme == "http" {
			port = "80"
		}
	}
	testKey := net.JoinHostPort(target.Host, port)
	policy := m.engine.Policy
	ip, ipErr := netip.ParseAddr(target.Host)
	if (ipErr == nil && ip.IsLoopback() && policy.TestAllow[testKey]) ||
		(strings.HasSuffix(target.Host, ".test") && policy.TestMappings[testKey].IsLoopback()) {
		return target, nil
	}
	if security.InternalHost(target.Host) {
		return target, security.Fail("target_internal", "input", "请输入可从公网访问的域名。当前输入是本机或内网名称", "", "", nil)
	}
	if ipErr == nil && !policy.AllowsAddress(ip) {
		return target, security.Fail("target_non_public", "input", "这个 IP 地址不在公网，请填写公网地址", "", "", nil)
	}
	if err := domain.CheckScanSuffix(target.Host); err != nil {
		return target, security.Fail("invalid_domain_suffix", "input", err.Error(), "", "", nil)
	}
	return target, nil
}

func (m *Manager) start(ctx context.Context, raw string, options model.ScanOptions, rootOnly bool) (model.ScanTask, error) {
	if err := ValidateOptions(options); err != nil {
		return model.ScanTask{}, security.Fail("invalid_options", "input", err.Error(), "请检查本次扫描参数及网络设置。", "", err)
	}
	if (options.Visible || options.Mode == "interactive") && !browser.VisibleSupported() {
		return model.ScanTask{}, errors.New("当前服务没有图形会话，请选择快速或深度模式并关闭可见浏览器")
	}
	if rootOnly {
		target, err := m.PrepareTarget(raw)
		if err != nil {
			return model.ScanTask{}, err
		}
		raw = target.URL
	}
	u, err := domain.NormalizeURL(raw)
	if err != nil {
		return model.ScanTask{}, security.Fail("invalid_url", "input", err.Error(), "请输入有效的 HTTP(S) 网站地址。", "", err)
	}
	if strings.Contains(strings.ToUpper(u.String()), "%5BREDACTED%5D") || strings.Contains(strings.ToUpper(u.String()), "[REDACTED]") {
		return model.ScanTask{}, security.Fail("redacted_url", "input", "这是脱敏后的历史地址", "请重新输入原网址后开始采集。", "", nil)
	}
	policy, closeResolver := m.engine.policyFor(options)
	defer closeResolver()
	if err = policy.Validate(ctx, u); err != nil {
		return model.ScanTask{}, err
	}
	browserPath, err := m.resolveBrowser(options.BrowserPath)
	if err != nil {
		return model.ScanTask{}, security.Fail("browser_start_failed", "browser", err.Error(), "请回到设置选择已检测浏览器，或安装 Chrome、Edge、Chromium 后重试。", "", err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.root.Err() != nil {
		return model.ScanTask{}, errors.New("服务正在退出")
	}
	if m.active != nil {
		return model.ScanTask{}, ErrBusy
	}
	idBytes := make([]byte, 12)
	if _, err = rand.Read(idBytes); err != nil {
		return model.ScanTask{}, err
	}
	target := security.RedactPageURL(u.String())
	task := model.ScanTask{ID: hex.EncodeToString(idBytes), TargetURL: target, TargetRedacted: target != u.String(), Status: "starting", Options: options, StartedAt: time.Now().UTC(), Pages: []model.PageRecord{}, Matches: []model.RuleMatch{}}
	if rootOnly {
		task.TargetURL, task.TargetScheme, task.TargetPort = u.Hostname(), u.Scheme, u.Port()
		task.TargetRedacted = false
	}
	task.TestMode = len(m.engine.Policy.TestAllow) > 0 || len(m.engine.Policy.TestMappings) > 0
	if options.Mode == "interactive" {
		task.Options.Visible = true
	}
	if err = m.store.Save(task, nil, nil, nil); err != nil {
		return model.ScanTask{}, err
	}
	runtime := newRuntime(task)
	m.active = runtime
	scanCtx, cancel := context.WithTimeout(m.root, time.Duration(options.MaxSeconds)*time.Second)
	runtime.cancel = cancel
	go m.execute(scanCtx, runtime, u.String(), u.Hostname(), browserPath)
	return task, nil
}

func (m *Manager) BrowserManaged() bool { return m.engine.BrowserPath != "" }

func (m *Manager) BrowserAvailable() bool {
	_, err := m.resolveBrowser("")
	return err == nil
}

func (m *Manager) ValidateBrowserSelection(selection string) error {
	if selection == "" {
		return nil
	}
	_, err := m.resolveBrowser(selection)
	return err
}

func (m *Manager) resolveBrowser(selection string) (string, error) {
	if !m.BrowserManaged() {
		return browser.Find(selection)
	}
	if selection != "" {
		return "", errors.New("采集浏览器由服务管理员配置，请在设置中使用自动检测")
	}
	return browser.ManagedPath(m.engine.BrowserPath)
}

func (m *Manager) execute(ctx context.Context, r *runtimeTask, target, host, browserPath string) {
	defer close(r.done)
	defer r.cancel()
	r.log("INFO", "created", "扫描任务已创建；实际观察域名与外部补充规则分别保存")
	checkpointDone := make(chan struct{})
	stopCheckpoint := make(chan struct{})
	go func() {
		defer close(checkpointDone)
		ticker := time.NewTicker(750 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopCheckpoint:
				return
			case <-ticker.C:
				if err := m.flush(r); err != nil {
					r.mu.Lock()
					r.flushError = err
					r.mu.Unlock()
					r.cancel()
					return
				}
			}
		}
	}()
	reason, err := m.engine.run(ctx, r, target, browserPath)
	scanErr := ctx.Err()
	close(stopCheckpoint)
	<-checkpointDone
	r.log("INFO", "extract", "完成域名规范化与去重，开始匹配本地规则缓存")
	// Downloads never extend a stopped task. Automatic matching only uses the
	// existing cache; explicit source updates/load actions live in the rules UI.
	categories := m.rules.Categories(true)
	matches, recommended, note, total := matcher.Match(host, r.domainList(), categories)
	now := time.Now().UTC()
	r.mu.Lock()
	status := "completed"
	if r.task.Status == "stopping" {
		status = "cancelled"
		reason = "user_stopped"
		err = nil
	} else if reason == browserClosed {
		status = "cancelled"
	} else if errors.Is(scanErr, context.DeadlineExceeded) {
		status = "timed_out"
		reason = "time_limit"
		err = nil
	} else if m.root.Err() != nil {
		status = "cancelled"
		reason = "service_shutdown"
		err = nil
	} else if err != nil {
		status = "failed"
	}
	if r.flushError != nil {
		status = "failed"
		reason = "database_error"
		err = fmt.Errorf("结果写入数据库失败: %w", r.flushError)
	}
	r.finishInteractiveDocument(nil, true)
	r.task.Status = status
	r.task.RecordingPaused = false
	if status == "timed_out" {
		r.task.Diagnostic = security.Explain(security.Fail("time_limit", "scan", "达到最大扫描时间，结果尚不完整", "可增加扫描时间或切换到自行交互继续观察。", host, nil))
	}
	if status == "cancelled" {
		r.task.Diagnostic = nil
	}
	if status == "completed" {
		for _, page := range r.task.Pages {
			if page.Status == "failed" || page.Status == "blocked" {
				r.task.Status = "partial"
				break
			}
		}
	}
	r.task.EndReason = reason
	r.task.EndedAt = &now
	r.task.Matches = matches
	r.task.RecommendedCategory = recommended
	r.task.MatchNote = note
	r.task.MatchedCategoryCount = total
	r.task.MatchesTruncated = total > len(matches)
	cacheAvailable := len(categories) > 0
	r.task.RuleCacheAvailable = &cacheAvailable
	if err != nil {
		r.task.Error = security.RedactText(err.Error())
		if r.task.Diagnostic == nil {
			r.task.Diagnostic = security.Explain(err)
		}
	}
	for i, p := range r.task.Pages {
		if p.Status == "queued" || p.Status == "visiting" {
			r.task.Pages[i].Status = "pending"
			r.task.Pages[i].Reason = "扫描已结束：" + reason
		}
	}
	for key, request := range r.requests {
		if request.State == "pending" || request.State == "responding" || request.State == "open" {
			request.State = "interrupted"
			request.Failure = "扫描结束时尚未完成，未推测成功与耗时"
			r.requests[key] = request
			r.dirtyRequests[key] = true
		}
	}
	r.revision++
	r.mu.Unlock()
	level := "INFO"
	if status == "failed" {
		level = "ERROR"
	}
	r.log(level, "ended", "扫描结束: "+reason)
	if err = m.flush(r); err != nil {
		r.mu.Lock()
		r.task.Status = "failed"
		r.task.Error = "最终结果保存失败: " + err.Error()
		r.task.EndReason = "database_error"
		r.mu.Unlock()
		_ = m.flush(r)
	}
	m.mu.Lock()
	if m.active == r {
		m.active = nil
	}
	m.mu.Unlock()
}

func (m *Manager) flush(r *runtimeTask) error {
	r.flushMu.Lock()
	defer r.flushMu.Unlock()
	r.mu.Lock()
	r.task.Summary = r.summaryLocked()
	task := cloneTask(r.task)
	reqs := []model.NetworkRequest{}
	doms := []model.DomainRecord{}
	for key := range r.dirtyRequests {
		reqs = append(reqs, r.requests[key])
	}
	for key := range r.dirtyDomains {
		d := r.domains[key]
		d.RequestIDs = append([]string{}, d.RequestIDs...)
		d.ResourceTypes = append([]string{}, d.ResourceTypes...)
		doms = append(doms, d)
	}
	events := append([]model.Event{}, r.pendingEvents...)
	r.dirtyRequests = map[string]bool{}
	r.dirtyDomains = map[string]bool{}
	r.pendingEvents = nil
	r.mu.Unlock()
	if err := m.store.Save(task, reqs, doms, events); err != nil {
		r.mu.Lock()
		for _, req := range reqs {
			r.dirtyRequests[req.ID] = true
		}
		for _, d := range doms {
			r.dirtyDomains[d.Hostname] = true
		}
		r.pendingEvents = append(events, r.pendingEvents...)
		r.mu.Unlock()
		return err
	}
	return nil
}

func (m *Manager) activeTask(id string) *runtimeTask {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil && m.active.task.ID == id {
		return m.active
	}
	return nil
}
func (m *Manager) Task(id string) (model.ScanTask, error) {
	if r := m.activeTask(id); r != nil {
		return r.snapshot(), nil
	}
	return m.store.Task(id)
}
func (m *Manager) List() ([]model.ScanTask, error) {
	tasks, err := m.store.ListScans(100)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	r := m.active
	m.mu.Unlock()
	if r != nil {
		t := r.snapshot()
		found := false
		for i, old := range tasks {
			if old.ID == t.ID {
				tasks[i] = t
				found = true
			}
		}
		if !found {
			tasks = append([]model.ScanTask{t}, tasks...)
		}
	}
	return tasks, nil
}
func (m *Manager) Domains(id string) ([]model.DomainRecord, error) {
	if r := m.activeTask(id); r != nil {
		return r.domainList(), nil
	}
	return m.store.Domains(id)
}
func (m *Manager) Requests(id string, f storage.RequestFilter) ([]model.NetworkRequest, int, error) {
	if f.Limit < 1 || f.Limit > 200 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	if r := m.activeTask(id); r != nil {
		out, n := r.requestsPage(f)
		return out, n, nil
	}
	return m.store.Requests(id, f)
}
func (m *Manager) Events(id string, after int64) ([]model.Event, error) {
	if r := m.activeTask(id); r != nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		out := []model.Event{}
		for _, e := range r.events {
			if e.ID > after {
				out = append(out, e)
			}
		}
		return out, nil
	}
	return m.store.Events(id, after)
}
func (m *Manager) Stop(id string) error {
	r := m.activeTask(id)
	if r == nil {
		if _, err := m.store.Task(id); err != nil {
			return err
		}
		return nil
	}
	r.mu.Lock()
	if !r.task.Active() || r.task.Status == "stopping" {
		r.mu.Unlock()
		return nil
	}
	r.task.Status = "stopping"
	r.logLocked("INFO", "stopping", "用户请求停止，正在取消导航并释放浏览器")
	r.mu.Unlock()
	r.cancel()
	return nil
}

func (m *Manager) SetRecordingPaused(id string, paused bool) error {
	r := m.activeTask(id)
	if r == nil {
		if _, err := m.store.Task(id); err != nil {
			return err
		}
		return ErrRecordingInactive
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.task.Options.Mode != "interactive" || r.task.Status != "running" || r.recordingFinished {
		return ErrRecordingInactive
	}
	if r.task.RecordingPaused != paused {
		r.task.RecordingPaused = paused
		if paused {
			r.logLocked("INFO", "recording_paused", "已暂停记录，受控浏览器与登录状态保留，总时长继续计时")
		} else {
			r.logLocked("INFO", "recording_resumed", "已在同一浏览器会话继续记录")
		}
	}
	return nil
}

func (m *Manager) Revision(id string) int64 {
	if r := m.activeTask(id); r != nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.revision
	}
	return -1
}

// Active returns the live task independently of the history item being viewed.
func (m *Manager) Active() *model.ScanTask {
	m.mu.Lock()
	r := m.active
	m.mu.Unlock()
	if r == nil {
		return nil
	}
	task := r.snapshot()
	return &task
}
func (m *Manager) Rematch(id string) (model.ScanTask, error) {
	task, err := m.Task(id)
	if err != nil {
		return task, err
	}
	if task.Active() || m.activeTask(id) != nil {
		return task, errors.New("请等待扫描完成后重新匹配")
	}
	domains, err := m.Domains(id)
	if err != nil {
		return task, err
	}
	host := task.TargetURL
	if task.TargetScheme == "" {
		u, err := url.Parse(task.TargetURL)
		if err != nil {
			return task, err
		}
		host = u.Hostname()
	}
	categories := m.rules.Categories(true)
	matches, recommended, note, total := matcher.Match(host, domains, categories)
	task.Matches = matches
	task.RecommendedCategory = recommended
	task.MatchNote = note
	task.MatchedCategoryCount = total
	task.MatchesTruncated = total > len(matches)
	cacheAvailable := len(categories) > 0
	task.RuleCacheAvailable = &cacheAvailable
	err = m.store.UpdateMatch(task)
	return task, err
}
func (m *Manager) ClearSessions() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil {
		return ErrBusy
	}
	return CleanSessions(m.engine.SessionDir)
}

// CleanSessions is also used by the desktop supervisor after its entire job
// has stopped. Unmarked directories and symbolic links are never followed.
func CleanSessions(sessionDir string) error {
	// Resolve and verify ownership before removing anything. Never accept paths
	// from the API, and only remove scan-* direct children of our session folder.
	root, err := filepath.Abs(sessionDir)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "scan-") {
			continue
		}
		target := filepath.Join(root, entry.Name())
		if filepath.Dir(target) != root {
			return errors.New("会话路径校验失败")
		}
		marker, markerErr := os.ReadFile(filepath.Join(target, sessionMarker))
		if markerErr != nil || string(marker) != sessionOwner {
			continue
		}
		if err = os.RemoveAll(target); err != nil {
			return err
		}
	}
	return nil
}
