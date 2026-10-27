package api

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/scanner"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

func testAPI(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	store, err := storage.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	ruleManager, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	scanManager := scanner.NewManager(store, ruleManager, scanner.Engine{SessionDir: filepath.Join(t.TempDir(), "sessions")})
	t.Cleanup(scanManager.Close)
	s, err := New(store, scanManager, ruleManager, "http://127.0.0.1", "")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(s.Handler())
	s.BaseURL = "http://" + server.Listener.Addr().String()
	server.Start()
	t.Cleanup(server.Close)
	return s, server
}
func request(t *testing.T, s *Server, method, path, body string, token bool) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, s.BaseURL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token {
		req.Header.Set("X-Castorice-Token", s.Token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
func TestLocalAPISecurityAndValidation(t *testing.T) {
	s, _ := testAPI(t)
	resp := request(t, s, "GET", "/api/health", "", false)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	for _, token := range []bool{false, true} {
		resp := request(t, s, "PUT", "/api/settings", `{}`, token)
		resp.Body.Close()
		want := 403
		if token {
			want = 400
		}
		if resp.StatusCode != want {
			t.Fatal("settings validation/token", resp.StatusCode, want)
		}
	}
	req, _ := http.NewRequest("GET", s.BaseURL+"/api/session", nil)
	req.Header.Set("Origin", "https://evil.example")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("cross origin accepted")
	}
	req, _ = http.NewRequest("GET", s.BaseURL+"/api/health", nil)
	req.Host = "rebound.evil:19110"
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("rebound Host accepted")
	}
	req, _ = http.NewRequest("GET", s.BaseURL+"/api/session", nil)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("cross site without Origin accepted")
	}
	resp = request(t, s, "POST", "/api/scans", `{"url":"http://127.0.0.1:80"}`, true)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatal("private scan accepted")
	}
	resp = request(t, s, "POST", "/api/scans", `{"url":"example.com","unknown":1}`, true)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatal("unknown JSON key accepted")
	}
}
func TestAPIHistoryExportAndSSE(t *testing.T) {
	s, _ := testAPI(t)
	task := model.ScanTask{ID: "history", TargetURL: "https://example.com/", Status: "completed", Options: model.DefaultOptions(), StartedAt: time.Now().UTC(), DomainCount: 1, RequestCount: 1, Pages: []model.PageRecord{}, Matches: []model.RuleMatch{}}
	if err := s.Store.Save(task, nil, []model.DomainRecord{{Hostname: "example.com", Kind: "domain", RequestCount: 1}}, []model.Event{{ID: 1, TaskID: task.ID, Kind: "ended", Message: "fixture ended"}}); err != nil {
		t.Fatal(err)
	}
	resp := request(t, s, "POST", "/api/export", `{"task_id":"history","mode":"observed","format":"provider","policy":"dibao","filename":"中文"}`, true)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var out struct {
		Data model.ExportResult `json:"data"`
	}
	if json.Unmarshal(b, &out) != nil || resp.StatusCode != 200 || out.Data.FinalRules != 1 || strings.Contains(out.Data.Content, "dibao") {
		t.Fatal("provider export", resp.StatusCode, string(b))
	}
	resp = request(t, s, "POST", "/api/export", `{"task_id":"history","mode":"merged","format":"clash","policy":"dibao"}`, true)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatal("silent no-category merge")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", s.BaseURL+"/api/scans/history/events", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	reader := bufio.NewReader(resp.Body)
	found := false
	for i := 0; i < 6; i++ {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "data:") {
			found = strings.Contains(line, `"id":"history"`)
			break
		}
	}
	if !found {
		t.Fatal("SSE not task-scoped")
	}
}

func TestLargeExportExclusionsKeepStrictBoundedJSON(t *testing.T) {
	s, _ := testAPI(t)
	task := model.ScanTask{ID: "large-export", TargetURL: "https://example.com/", Status: "completed", Options: model.DefaultOptions(), StartedAt: time.Now().UTC()}
	if err := s.Store.Save(task, nil, []model.DomainRecord{{Hostname: "example.com", Kind: "domain"}}, nil); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 60000)
	for i := range keys {
		keys[i] = "DOMAIN-SUFFIX,excluded-name.example.net"
	}
	body, err := json.Marshal(model.ExportJob{TaskID: task.ID, Mode: "observed", Format: "provider", Excluded: keys})
	if err != nil || len(body) <= 2<<20 {
		t.Fatal("fixture does not exercise large request", err)
	}
	resp := request(t, s, "POST", "/api/export", string(body), true)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("large exclusion list rejected", resp.StatusCode)
	}
	resp = request(t, s, "POST", "/api/export", string(body)+`{}`, true)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatal("multiple objects accepted")
	}
}

func TestTopLevelGUIFromOtherSiteAllowedButAPIRemainsDenied(t *testing.T) {
	s, _ := testAPI(t)
	for _, path := range []string{"/", "/api/session"} {
		req, _ := http.NewRequest("GET", s.BaseURL+path, nil)
		req.Header.Set("Sec-Fetch-Mode", "navigate")
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if path == "/" && resp.StatusCode == 403 {
			t.Fatal("legitimate GUI navigation blocked")
		}
		if path != "/" && resp.StatusCode != 403 {
			t.Fatal("cross-site API navigation allowed")
		}
	}
}
