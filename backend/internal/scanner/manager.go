package scanner

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
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
	if err := ValidateOptions(options); err != nil {
		return model.ScanTask{}, err
	}
	if (options.Visible || options.Mode == "interactive") && !browser.VisibleSupported() {
		return model.ScanTask{}, errors.New("当前服务没有图形会话，请使用快速扫描或自动探索并关闭可见浏览器")
	}
	u, err := domain.NormalizeURL(raw)
	if err != nil {
		return model.ScanTask{}, err
	}
	policy, closeResolver := m.engine.policyFor(options)
	defer closeResolver()
	if err = policy.Validate(ctx, u); err != nil {
		return model.ScanTask{}, err
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
	task := model.ScanTask{ID: hex.EncodeToString(idBytes), TargetURL: security.RedactPageURL(u.String()), Status: "starting", Options: options, StartedAt: time.Now().UTC(), Pages: []model.PageRecord{}, Matches: []model.RuleMatch{}}
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
	go m.execute(scanCtx, runtime, u.String(), u.Hostname())
	return task, nil
}

func (m *Manager) execute(ctx context.Context, r *runtimeTask, target, host string) {
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
	reason, err := m.engine.run(ctx, r, target)
	close(stopCheckpoint)
	<-checkpointDone
	r.mu.Lock()
	stopped := r.task.Status == "stopping"
	r.mu.Unlock()
	status := "completed"
	if stopped {
		status = "cancelled"
		reason = "user_stopped"
		err = nil
	} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
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
	r.mu.Lock()
	if r.flushError != nil {
		status = "failed"
		reason = "database_error"
		err = fmt.Errorf("结果写入数据库失败: %w", r.flushError)
	}
	r.mu.Unlock()
	r.log("INFO", "extract", "完成域名规范化与去重，开始匹配本地规则缓存")
	// Downloads never extend a stopped task. Automatic matching only uses the
	// existing cache; explicit source updates/load actions live in the rules UI.
	categories := m.rules.Categories(true)
	matches, recommended, note := matcher.Match(host, r.domainList(), categories)
	now := time.Now().UTC()
	r.mu.Lock()
	r.task.Status = status
	r.task.EndReason = reason
	r.task.EndedAt = &now
	r.task.Matches = matches
	r.task.RecommendedCategory = recommended
	r.task.MatchNote = note
	if err != nil {
		r.task.Error = security.RedactText(err.Error())
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
		out, n := r.requestsPage(f.Host, f.Method, f.Type, f.Status, f.Limit, f.Offset)
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
	r.task.Status = "stopping"
	r.revision++
	r.mu.Unlock()
	r.log("INFO", "stopping", "用户请求停止，正在取消导航并释放浏览器")
	r.cancel()
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
func (m *Manager) Rematch(id string) (model.ScanTask, error) {
	task, err := m.Task(id)
	if err != nil {
		return task, err
	}
	if task.Active() {
		return task, errors.New("请等待扫描完成后重新匹配")
	}
	domains, err := m.Domains(id)
	if err != nil {
		return task, err
	}
	u, _ := url.Parse(task.TargetURL)
	matches, recommended, note := matcher.Match(u.Hostname(), domains, m.rules.Categories(true))
	task.Matches = matches
	task.RecommendedCategory = recommended
	task.MatchNote = note
	err = m.store.Save(task, nil, nil, nil)
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
