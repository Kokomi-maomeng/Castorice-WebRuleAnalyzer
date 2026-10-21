package scanner

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
)

const MaxRequests = 20000
const MaxEvents = 2000

type runtimeTask struct {
	mu            sync.Mutex
	task          model.ScanTask
	requests      map[string]model.NetworkRequest
	domains       map[string]model.DomainRecord
	active        map[network.RequestID]string
	starts        map[string]float64
	dirtyRequests map[string]bool
	dirtyDomains  map[string]bool
	events        []model.Event
	pendingEvents []model.Event
	sequence      int64
	revision      int64
	lastRequest   time.Time
	limit         bool
	cancel        func()
	done          chan struct{}
	flushMu       sync.Mutex
	flushError    error
}

func newRuntime(task model.ScanTask) *runtimeTask {
	return &runtimeTask{task: task, requests: map[string]model.NetworkRequest{}, domains: map[string]model.DomainRecord{}, active: map[network.RequestID]string{}, starts: map[string]float64{}, dirtyRequests: map[string]bool{}, dirtyDomains: map[string]bool{}, events: []model.Event{}, pendingEvents: []model.Event{}, lastRequest: time.Now(), done: make(chan struct{})}
}

func (r *runtimeTask) log(level, kind, message string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logLocked(level, kind, message)
}
func (r *runtimeTask) logLocked(level, kind, message string) {
	r.sequence++
	event := model.Event{ID: r.sequence, TaskID: r.task.ID, Time: time.Now().UTC(), Level: level, Kind: kind, Message: security.RedactText(message)}
	r.events = append(r.events, event)
	r.pendingEvents = append(r.pendingEvents, event)
	if len(r.events) > MaxEvents {
		r.events = append([]model.Event{}, r.events[len(r.events)-MaxEvents:]...)
	}
	r.revision++
}
func (r *runtimeTask) snapshot() model.ScanTask {
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneTask(r.task)
}
func cloneTask(t model.ScanTask) model.ScanTask {
	t.Pages = append([]model.PageRecord{}, t.Pages...)
	t.Matches = append([]model.RuleMatch{}, t.Matches...)
	return t
}
func (r *runtimeTask) domainList() []model.DomainRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []model.DomainRecord{}
	for _, d := range r.domains {
		d.RequestIDs = append([]string{}, d.RequestIDs...)
		d.ResourceTypes = append([]string{}, d.ResourceTypes...)
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hostname < out[j].Hostname })
	return out
}

func initiator(i *network.Initiator) string {
	if i == nil {
		return ""
	}
	text := string(i.Type)
	if i.URL != "" {
		text += " · " + security.RedactURL(i.URL)
	}
	return text
}
func monotonic(t *cdp.MonotonicTime) float64 {
	if t == nil {
		return 0
	}
	return t.Time().Sub(*cdp.MonotonicTimeEpoch).Seconds()
}
func wallTime(t *cdp.TimeSinceEpoch) time.Time {
	if t == nil {
		return time.Time{}
	}
	return t.Time().UTC()
}

func (r *runtimeTask) add(id network.RequestID, raw, method, resource, source, init string, wall time.Time, mono float64) {
	u, err := url.Parse(raw)
	if err != nil || !(u.Scheme == "http" || u.Scheme == "https" || u.Scheme == "ws" || u.Scheme == "wss") {
		return
	}
	host, kind, err := domain.NormalizeHost(u.Hostname())
	if err != nil {
		return
	}
	if len(r.requests) >= MaxRequests {
		r.limit = true
		return
	}
	key := fmt.Sprintf("%s:%d", id, len(r.requests)+1)
	d, exists := r.domains[host]
	if !exists {
		d = model.DomainRecord{Hostname: host, Kind: kind, Registrable: domain.Registrable(host), FirstSeen: wall, ResourceTypes: []string{}, RequestIDs: []string{}, Source: "browser-observed"}
		if kind == "domain" {
			r.task.DomainCount++
		} else {
			r.task.IPCount++
		}
		r.logLocked("INFO", "domain", "首次观察到 "+host)
	}
	d.RequestCount++
	d.RequestIDs = append(d.RequestIDs, key)
	seen := false
	for _, v := range d.ResourceTypes {
		if v == resource {
			seen = true
		}
	}
	if !seen {
		d.ResourceTypes = append(d.ResourceTypes, resource)
	}
	r.domains[host] = d
	r.dirtyDomains[host] = true
	req := model.NetworkRequest{ID: key, CDPID: string(id), TaskID: r.task.ID, Time: wall, Method: method, URL: security.RedactURL(raw), Hostname: host, HostKind: kind, Scheme: u.Scheme, ResourceType: resource, SourcePage: security.RedactPageURL(source), Initiator: init, State: "pending", FirstDomain: !exists}
	r.requests[key] = req
	r.active[id] = key
	r.starts[key] = mono
	r.dirtyRequests[key] = true
	r.task.RequestCount = len(r.requests)
	r.lastRequest = time.Now()
	r.revision++
}

func (r *runtimeTask) update(id network.RequestID, fn func(*model.NetworkRequest)) {
	key, ok := r.active[id]
	if !ok {
		return
	}
	req := r.requests[key]
	fn(&req)
	r.requests[key] = req
	r.dirtyRequests[key] = true
	r.revision++
}
func (r *runtimeTask) finish(id network.RequestID, mono float64, state, failure string) {
	key := r.active[id]
	r.update(id, func(req *model.NetworkRequest) {
		if start := r.starts[key]; start > 0 && mono >= start {
			ms := (mono - start) * 1000
			req.DurationMS = &ms
		}
		req.State = state
		req.Failure = security.RedactText(failure)
	})
}

func (r *runtimeTask) onEvent(ev any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch e := ev.(type) {
	case *network.EventRequestWillBeSent:
		if e.RedirectResponse != nil {
			r.response(e.RequestID, e.RedirectResponse)
			r.finish(e.RequestID, monotonic(e.Timestamp), "redirected", "")
		}
		r.add(e.RequestID, e.Request.URL, e.Request.Method, string(e.Type), e.DocumentURL, initiator(e.Initiator), wallTime(e.WallTime), monotonic(e.Timestamp))
	case *network.EventResponseReceived:
		r.response(e.RequestID, e.Response)
	case *network.EventLoadingFinished:
		r.finish(e.RequestID, monotonic(e.Timestamp), "finished", "")
	case *network.EventLoadingFailed:
		r.finish(e.RequestID, monotonic(e.Timestamp), "failed", e.ErrorText)
	case *network.EventWebSocketCreated:
		r.add(e.RequestID, e.URL, "GET", "WebSocket", r.task.CurrentPage, initiator(e.Initiator), time.Now().UTC(), 0)
	case *network.EventWebSocketWillSendHandshakeRequest:
		key := r.active[e.RequestID]
		r.starts[key] = monotonic(e.Timestamp)
		r.update(e.RequestID, func(req *model.NetworkRequest) { req.Time = wallTime(e.WallTime) })
	case *network.EventWebSocketHandshakeResponseReceived:
		r.update(e.RequestID, func(req *model.NetworkRequest) {
			req.StatusCode = int(e.Response.Status)
			req.State = "open"
			req.Protocol = "websocket"
			if start := r.starts[req.ID]; start > 0 {
				ms := (monotonic(e.Timestamp) - start) * 1000
				req.DurationMS = &ms
			}
		})
	case *network.EventWebSocketClosed:
		r.update(e.RequestID, func(req *model.NetworkRequest) {
			if req.State != "failed" {
				req.State = "closed"
			}
		})
	case *network.EventWebSocketFrameError:
		r.finish(e.RequestID, monotonic(e.Timestamp), "failed", e.ErrorMessage)
	}
}
func (r *runtimeTask) response(id network.RequestID, response *network.Response) {
	if response == nil {
		return
	}
	r.update(id, func(req *model.NetworkRequest) {
		req.StatusCode = int(response.Status)
		req.Protocol = response.Protocol
		req.RemoteIP = response.RemoteIPAddress
		req.State = "responding"
	})
}

func (r *runtimeTask) requestsPage(host, method, resource, status string, limit, offset int) ([]model.NetworkRequest, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []model.NetworkRequest{}
	for _, req := range r.requests {
		if host != "" && !strings.Contains(req.Hostname, strings.ToLower(host)) || method != "" && req.Method != method || resource != "" && req.ResourceType != resource {
			continue
		}
		if status == "failed" {
			if req.State != "failed" {
				continue
			}
		} else if status != "" && !strings.HasPrefix(fmt.Sprint(req.StatusCode), status) {
			continue
		}
		out = append(out, req)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Time.Equal(out[j].Time) {
			return out[i].ID > out[j].ID
		}
		return out[i].Time.After(out[j].Time)
	})
	total := len(out)
	if offset > total {
		offset = total
	}
	end := min(total, offset+limit)
	return out[offset:end], total
}
