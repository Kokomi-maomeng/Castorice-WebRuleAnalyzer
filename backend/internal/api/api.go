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
	Store     *storage.Store
	Scans     *scanner.Manager
	Rules     *rules.Manager
	BaseURL   string
	DevOrigin string
	Token     string
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
	return &Server{store, scans, rules, base, dev, hex.EncodeToString(b)}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "version": model.Version, "name": "Castorice-WebRuleAnalyzer"})
	})
	mux.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"token": s.Token}) })
	mux.HandleFunc("GET /api/browsers", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, browser.Detect()) })
	mux.HandleFunc("POST /api/scans", s.createScan)
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
			if q != "" && !strings.Contains(strings.ToLower(c.Name), q) {
				continue
			}
			c.Rules = nil
			out = append(out, c)
		}
		respond(w, 200, out)
	})
	mux.HandleFunc("POST /api/rules/sync", s.syncRules)
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
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if handleError(w, s.Rules.Sync(ctx, body.Source)) {
		return
	}
	respond(w, 200, s.Rules.Sources())
}
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	var job model.ExportJob
	if !decode(w, r, &job) {
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
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
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
