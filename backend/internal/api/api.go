package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/config"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/exporter"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/webui"
)

type Server struct {
	Store      *storage.Store
	Scans      *scanner.Manager
	Rules      *rules.Manager
	BaseURL    string
	DevOrigin  string
	Token      string
	SaveExport func(string, string) (string, error)
}
type envelope struct {
	Data  any       `json:"data,omitempty"`
	Error *apiError `json:"error,omitempty"`
}
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func New(store *storage.Store, scans *scanner.Manager, rules *rules.Manager, base, dev string) (*Server, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return &Server{Store: store, Scans: scans, Rules: rules, BaseURL: base, DevOrigin: dev, Token: hex.EncodeToString(b)}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "version": model.Version, "name": "Castorice-WebRuleAnalyzer", "visible_browser": browser.VisibleSupported()})
	})
	mux.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"token": s.Token}) })
	mux.HandleFunc("GET /api/browsers", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, browser.Detect()) })
	mux.HandleFunc("POST /api/scans", s.createScan)
	mux.HandleFunc("GET /api/scans/active", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, s.Scans.Active())
	})
	mux.HandleFunc("GET /api/scans", func(w http.ResponseWriter, r *http.Request) {
		tasks, err := s.Scans.List()
		if handleError(w, err) {
			return
		}
		respond(w, 200, tasks)
	})
	mux.HandleFunc("GET /api/scans/{id}", func(w http.ResponseWriter, r *http.Request) {
		task, err := s.Scans.Task(r.PathValue("id"))
		if handleError(w, err) {
			return
		}
		respond(w, 200, task)
	})
	mux.HandleFunc("POST /api/scans/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		if handleError(w, s.Scans.Stop(r.PathValue("id"))) {
			return
		}
		respond(w, 200, map[string]bool{"stopping": true})
	})
	mux.HandleFunc("GET /api/scans/{id}/domains", func(w http.ResponseWriter, r *http.Request) {
		domains, err := s.Scans.Domains(r.PathValue("id"))
		if handleError(w, err) {
			return
		}
		respond(w, 200, domains)
	})
	mux.HandleFunc("GET /api/scans/{id}/requests", s.requests)
	mux.HandleFunc("GET /api/scans/{id}/events", s.events)
	mux.HandleFunc("GET /api/scans/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		events, err := s.Scans.Events(r.PathValue("id"), after)
		if handleError(w, err) {
			return
		}
		respond(w, 200, events)
	})
	mux.HandleFunc("GET /api/rules/sources", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.Rules.Sources()) })
	mux.HandleFunc("GET /api/rules/categories", func(w http.ResponseWriter, r *http.Request) {
		all := s.Rules.Categories(false)
		out := []model.RuleCategory{}
		q := strings.ToLower(r.URL.Query().Get("q"))
		for _, c := range all {
			if q != "" && !strings.Contains(strings.ToLower(c.Name+" "+c.Source+" "+c.Raw), q) {
				continue
			}
			c.Rules = nil
			c.Raw = ""
			out = append(out, c)
		}
		if q != "" {
			rank := func(c model.RuleCategory) int {
				n := strings.ToLower(c.Name)
				if n == q {
					return 0
				}
				if strings.HasPrefix(n, q) {
					return 1
				}
				if strings.Contains(n, q) {
					return 2
				}
				return 3
			}
			sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
		}
		respond(w, 200, out)
	})
	mux.HandleFunc("POST /api/rules/sync", s.syncRules)
	mux.HandleFunc("PUT /api/rules/auto-update", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Source  string `json:"source"`
			Enabled bool   `json:"enabled"`
		}
		if !decode(w, r, &body) {
			return
		}
		if handleError(w, s.Rules.SetAutoUpdate(body.Source, body.Enabled)) {
			return
		}
		respond(w, 200, s.Rules.Sources())
	})
	mux.HandleFunc("POST /api/rules/check", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Source string `json:"source"`
		}
		if !decode(w, r, &body) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		source, err := s.Rules.Check(ctx, body.Source)
		if handleError(w, err) {
			return
		}
		respond(w, 200, source)
	})
	mux.HandleFunc("GET /api/rules/content", func(w http.ResponseWriter, r *http.Request) {
		c, ok := s.Rules.Category(r.URL.Query().Get("id"))
		if !ok {
			fail(w, 404, "not_found", "分类不存在")
			return
		}
		if c.Raw == "" {
			fail(w, 409, "content_missing", "请先更新或加载此分类以缓存原文")
			return
		}
		c.Rules = nil
		respond(w, 200, c)
	})
	mux.HandleFunc("POST /api/rules/load", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if !decode(w, r, &body) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		c, err := s.Rules.Load(ctx, body.ID)
		if handleError(w, err) {
			return
		}
		c.Rules = nil
		c.Raw = ""
		respond(w, 200, c)
	})
	mux.HandleFunc("POST /api/rules/match", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			TaskID string `json:"task_id"`
		}
		if !decode(w, r, &body) {
			return
		}
		task, err := s.Scans.Rematch(body.TaskID)
		if handleError(w, err) {
			return
		}
		respond(w, 200, task)
	})
	mux.HandleFunc("DELETE /api/rules/cache", func(w http.ResponseWriter, r *http.Request) {
		if handleError(w, s.Rules.Clear()) {
			return
		}
		respond(w, 200, map[string]bool{"cleared": true})
	})
	mux.HandleFunc("DELETE /api/browser/sessions", func(w http.ResponseWriter, r *http.Request) {
		if handleError(w, s.Scans.ClearSessions()) {
			return
		}
		respond(w, 200, map[string]bool{"cleared": true})
	})
	mux.HandleFunc("POST /api/export", s.export)
	mux.HandleFunc("POST /api/desktop/export", func(w http.ResponseWriter, r *http.Request) {
		if s.SaveExport == nil {
			fail(w, 404, "not_desktop", "此接口仅在桌面模式启用")
			return
		}
		var body struct {
			Filename string `json:"filename"`
			Content  string `json:"content"`
		}
		if !decodeLimit(w, r, &body, 17<<20) {
			return
		}
		path, err := s.SaveExport(body.Filename, body.Content)
		if handleError(w, err) {
			return
		}
		respond(w, 200, map[string]string{"path": path})
	})
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		settings, err := s.Store.Settings()
		if handleError(w, err) {
			return
		}
		respond(w, 200, settings)
	})
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var settings model.Settings
		if !decode(w, r, &settings) {
			return
		}
		if handleError(w, config.Validate(settings)) {
			return
		}
		if handleError(w, s.Store.SaveSettings(settings)) {
			return
		}
		respond(w, 200, settings)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "not_found", "接口不存在") })
	mux.Handle("/", webui.Handler())
	return s.guard(mux)
}

func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("API panic", "type", fmt.Sprintf("%T", recovered))
				fail(w, 500, "internal_error", "服务处理失败，请查看日志")
			}
		}()
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		base, _ := url.Parse(s.BaseURL)
		if !strings.EqualFold(r.Host, base.Host) {
			fail(w, 403, "host_denied", "本地 API Host 不匹配")
			return
		}
		origin := r.Header.Get("Origin")
		allowed := origin == "" || origin == s.BaseURL || s.DevOrigin != "" && origin == s.DevOrigin
		// Opening the GUI from another tab/launcher is a legitimate top-level
		// navigation. Keep cross-site API reads/writes denied; only the static
		// document navigation may omit the same-origin requirement.
		topDocument := r.Method == http.MethodGet && r.Header.Get("Sec-Fetch-Mode") == "navigate" && !strings.HasPrefix(r.URL.Path, "/api/")
		if !allowed && !topDocument || r.Header.Get("Sec-Fetch-Site") == "cross-site" && !(s.DevOrigin != "" && origin == s.DevOrigin) && !topDocument {
			fail(w, 403, "origin_denied", "不允许来自其他站点的请求")
			return
		}
		if origin == s.DevOrigin && s.DevOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Castorice-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			token := r.Header.Get("X-Castorice-Token")
			if subtle.ConstantTimeCompare([]byte(token), []byte(s.Token)) != 1 {
				fail(w, 403, "token_required", "操作令牌失效，请刷新页面后重试")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) createScan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL     string             `json:"url"`
		Options *model.ScanOptions `json:"options"`
	}
	if !decode(w, r, &body) {
		return
	}
	settings, err := s.Store.Settings()
	if handleError(w, err) {
		return
	}
	options := settings.Scan
	if body.Options != nil {
		options = *body.Options
	}
	task, err := s.Scans.Start(r.Context(), body.URL, options)
	if handleError(w, err) {
		return
	}
	respond(w, 201, task)
}
func (s *Server) requests(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	requests, total, err := s.Scans.Requests(r.PathValue("id"), storage.RequestFilter{Host: q.Get("host"), Method: q.Get("method"), Type: q.Get("type"), Status: q.Get("status"), Limit: limit, Offset: offset})
	if handleError(w, err) {
		return
	}
	respond(w, 200, map[string]any{"items": requests, "total": total})
}
func (s *Server) syncRules(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source string `json:"source"`
	}
	if !decode(w, r, &body) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	if handleError(w, s.Rules.Sync(ctx, body.Source)) {
		return
	}
	respond(w, 200, s.Rules.Sources())
}
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	var job model.ExportJob
	// Large category selections can contain many excluded rule keys.
	if !decodeLimit(w, r, &job, 16<<20) {
		return
	}
	if _, err := s.Scans.Task(job.TaskID); handleError(w, err) {
		return
	}
	domains, err := s.Scans.Domains(job.TaskID)
	if handleError(w, err) {
		return
	}
	categories := []model.RuleCategory{}
	if job.Mode == "merged" {
		seen := map[string]bool{}
		for _, id := range job.CategoryIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			c, ok := s.Rules.Category(id)
			if !ok || !c.Loaded {
				fail(w, 400, "category_unavailable", "分类尚未加载，请先在规则库中加载该分类")
				return
			}
			categories = append(categories, c)
			if expected, supplied := job.CategoryVersions[id]; supplied && expected != c.Version+":"+c.ContentHash {
				fail(w, 409, "rules_changed", "规则已更新，请等待预览重新计算后再导出")
				return
			}
		}
	}
	result, err := exporter.Build(job, domains, categories)
	if handleError(w, err) {
		return
	}
	respond(w, 200, result)
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.Scans.Task(id); handleError(w, err) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "stream_unavailable", "实时事件不可用")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	last := int64(-2)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	write := func() bool {
		revision := s.Scans.Revision(id)
		if revision == last {
			return true
		}
		task, err := s.Scans.Task(id)
		if err != nil {
			return false
		}
		b, _ := json.Marshal(task)
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err = fmt.Fprintf(w, "id: %d\nevent: update\ndata: %s\n\n", revision, b); err != nil {
			return false
		}
		flusher.Flush()
		last = revision
		return true
	}
	if !write() {
		return
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if !write() {
				return
			}
		case <-heartbeat.C:
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	return decodeLimit(w, r, out, 2<<20)
}
func decodeLimit(w http.ResponseWriter, r *http.Request, out any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		fail(w, 400, "invalid_json", "请求数据无效或超出大小限制")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(w, 400, "invalid_json", "请求只能包含一个 JSON 对象")
		return false
	}
	return true
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Data: data})
}
func fail(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Error: &apiError{code, message}})
}
func handleError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "not_found", "扫描任务不存在")
	} else if errors.Is(err, scanner.ErrBusy) {
		fail(w, 409, "scan_busy", err.Error())
	} else {
		fail(w, 400, "operation_failed", security.RedactText(err.Error()))
	}
	return true
}
