package scanner

import (
	"context"
	"errors"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/browser"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/testsite"
)

func fixtureManager(t *testing.T) (*Manager, string, string) {
	t.Helper()
	if os.Getenv("CASTORICE_BROWSER_TEST") != "1" {
		t.Skip("设置 CASTORICE_BROWSER_TEST=1 执行真实浏览器集成测试")
	}
	if _, err := browser.Find(""); err != nil {
		t.Fatal(err)
	}
	site := httptest.NewServer(testsite.Handler(true))
	t.Cleanup(site.Close)
	u, _ := url.Parse(site.URL)
	root := t.TempDir()
	store, err := storage.Open(filepath.Join(root, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	ruleManager, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	mappings := map[string]netip.Addr{}
	for _, host := range []string{"scan.test", "assets.scan.test", "api.scan.test"} {
		mappings[host+":"+u.Port()] = netip.MustParseAddr("127.0.0.1")
	}
	sessions := filepath.Join(root, "sessions")
	manager := NewManager(store, ruleManager, Engine{Policy: security.Policy{TestMappings: mappings}, SessionDir: sessions})
	t.Cleanup(manager.Close)
	return manager, "http://scan.test:" + u.Port(), sessions
}
func options() model.ScanOptions {
	o := model.DefaultOptions()
	o.MaxSeconds = 40
	o.ObserveSeconds = 2
	o.QuietMillis = 300
	o.IntervalMillis = 0
	o.NavigationSeconds = 5
	return o
}
func waitTask(t *testing.T, m *Manager, id string) model.ScanTask {
	t.Helper()
	deadline := time.Now().Add(55 * time.Second)
	for time.Now().Before(deadline) {
		task, err := m.Task(id)
		if err != nil {
			t.Fatal(err)
		}
		if !task.Active() { // wait for the final transaction and slot release, too
			m.mu.Lock()
			r := m.active
			m.mu.Unlock()
			if r == nil {
				return task
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("任务未结束")
	return model.ScanTask{}
}
func assertClean(t *testing.T, sessions string) {
	t.Helper()
	entries, err := os.ReadDir(sessions)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("Profile 未清理: %v", entries)
	}
}

func TestBrowserCaptureExploreAndHistory(t *testing.T) {
	m, base, sessions := fixtureManager(t)
	o := options()
	o.Mode = "explore"
	o.MaxPages = 6
	task, err := m.Start(context.Background(), base, o)
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTask(t, m, task.ID)
	if finished.Status != "completed" {
		t.Fatalf("task failed: %+v", finished)
	}
	domains, err := m.Domains(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(domains) != 3 || finished.DomainCount != 3 {
		t.Fatalf("expected three observed domains, got %+v", domains)
	}
	requests, total, err := m.Requests(task.ID, storage.RequestFilter{Limit: 200})
	if err != nil || total < 15 {
		t.Fatalf("requests=%d err=%v", total, err)
	}
	types := map[string]bool{}
	hasRedirect, hasFail, hasLate, hasWS, hasStatus := false, false, false, false, false
	ids := map[string]bool{}
	for _, r := range requests {
		if ids[r.ID] {
			t.Fatal("redirect ID duplicated")
		}
		ids[r.ID] = true
		types[r.ResourceType] = true
		hasRedirect = hasRedirect || r.StatusCode == 302
		hasFail = hasFail || r.State == "failed"
		hasLate = hasLate || strings.Contains(r.URL, "/api/late")
		hasWS = hasWS || r.ResourceType == "WebSocket" && r.StatusCode == 101
		hasStatus = hasStatus || r.StatusCode == 503
		if strings.Contains(r.URL, "fixture-secret") {
			t.Fatal("query token persisted")
		}
		if strings.Contains(r.URL, "/logout") || strings.Contains(r.URL, "/delete") {
			t.Fatal("unsafe link visited")
		}
	}
	for _, typ := range []string{"Document", "Script", "Stylesheet", "Image", "Font", "Fetch", "WebSocket"} {
		if !types[typ] {
			t.Errorf("missing resource %s", typ)
		}
	}
	if !hasRedirect || !hasFail || !hasLate || !hasWS || !hasStatus {
		t.Fatalf("redirect=%v failure=%v late=%v websocket101=%v 503=%v", hasRedirect, hasFail, hasLate, hasWS, hasStatus)
	}
	visited, unvisited := 0, 0
	hasSPA := false
	for _, page := range finished.Pages {
		hasSPA = hasSPA || strings.Contains(page.URL, "#/spa")
		if page.Status == "visited" {
			visited++
		} else {
			unvisited++
		}
	}
	if visited < 3 || unvisited == 0 {
		t.Fatal("coverage ledger missing", finished.Pages)
	}
	if !hasSPA {
		t.Fatal("SPA hash route absent from page ledger", finished.Pages)
	}
	saved, err := m.store.Task(task.ID)
	if err != nil || saved.RequestCount != finished.RequestCount {
		t.Fatal("history not persisted", err)
	}
	assertClean(t, sessions)
}

func TestBrowserCancelTimeoutConcurrencyAndRecovery(t *testing.T) {
	m, base, sessions := fixtureManager(t)
	t.Run("cancel-and-next", func(t *testing.T) {
		o := options()
		o.Mode = "interactive"
		o.Visible = false
		task, err := m.Start(context.Background(), base, o)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = m.Start(context.Background(), base, o); !errors.Is(err, ErrBusy) {
			t.Fatal("concurrent task allowed", err)
		}
		time.Sleep(1200 * time.Millisecond)
		if err = m.Stop(task.ID); err != nil {
			t.Fatal(err)
		}
		done := waitTask(t, m, task.ID)
		if done.Status != "cancelled" || done.EndReason != "user_stopped" {
			t.Fatal(done)
		}
		assertClean(t, sessions)
		next, err := m.Start(context.Background(), base, options())
		if err != nil {
			t.Fatal("slot not released", err)
		}
		if done = waitTask(t, m, next.ID); done.Status != "completed" {
			t.Fatal(done)
		}
		assertClean(t, sessions)
	})
	t.Run("timeout", func(t *testing.T) {
		o := options()
		o.MaxSeconds = 2
		task, err := m.Start(context.Background(), base+"/hang", o)
		if err != nil {
			t.Fatal(err)
		}
		done := waitTask(t, m, task.ID)
		if done.Status != "timed_out" || done.EndReason != "time_limit" {
			t.Fatal(done)
		}
		assertClean(t, sessions)
	})
	t.Run("navigation-error", func(t *testing.T) {
		o := options()
		o.NavigationSeconds = 1
		task, err := m.Start(context.Background(), base+"/hang", o)
		if err != nil {
			t.Fatal(err)
		}
		done := waitTask(t, m, task.ID)
		if done.Status != "failed" {
			t.Fatal(done)
		}
		assertClean(t, sessions)
	})
	t.Run("private-redirect", func(t *testing.T) {
		task, err := m.Start(context.Background(), base+"/redirect-private", options())
		if err != nil {
			t.Fatal(err)
		}
		done := waitTask(t, m, task.ID)
		if done.Status != "failed" {
			t.Fatal("private redirect not failed", done)
		}
		events, _ := m.Events(task.ID, 0)
		guarded := false
		for _, e := range events {
			if e.Kind == "network_guard" && strings.Contains(e.Message, "已阻止") {
				guarded = true
			}
		}
		if !guarded {
			t.Fatal("no guard event for private redirect")
		}
		assertClean(t, sessions)
	})
}

func TestBrowserUnexpectedExit(t *testing.T) {
	m, base, sessions := fixtureManager(t)
	o := options()
	o.ObserveSeconds = 30
	o.QuietMillis = 30000
	task, err := m.Start(context.Background(), base, o)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		current, _ := m.Task(task.ID)
		if current.Status == "running" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	// Kill only the process whose command line points into this test's unique
	// Profile directory. User browsers are outside this exact test directory.
	if runtime.GOOS == "windows" {
		escaped := strings.ReplaceAll(sessions, "'", "''")
		script := `$p = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains('` + escaped + `') -and $_.CommandLine.Contains('--remote-debugging-port=0') }; if (-not $p) { exit 2 }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
		if output, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).CombinedOutput(); err != nil {
			t.Fatalf("test process kill: %s %v", output, err)
		}
	} else {
		t.Skip("进程异常退出模拟脚本仅在 Windows 验证；取消/超时跨平台测试仍可执行")
	}
	done := waitTask(t, m, task.ID)
	if done.Status != "failed" {
		t.Fatal("unexpected exit should fail", done)
	}
	assertClean(t, sessions)
}

func TestBrowserExplorationLimits(t *testing.T) {
	m, base, sessions := fixtureManager(t)
	o := options()
	o.Mode = "explore"
	o.MaxPages = 2
	task, err := m.Start(context.Background(), base, o)
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTask(t, m, task.ID)
	if finished.Status != "completed" || finished.EndReason != "page_limit" {
		t.Fatal(finished)
	}
	pending := 0
	for _, p := range finished.Pages {
		if p.Status == "pending" {
			pending++
		}
	}
	if pending == 0 {
		t.Fatal("unvisited queue not recorded")
	}
	assertClean(t, sessions)
	o.MaxPages = 20
	o.MaxDepth = 0
	task, err = m.Start(context.Background(), base, o)
	if err != nil {
		t.Fatal(err)
	}
	finished = waitTask(t, m, task.ID)
	visited := 0
	pending = 0
	for _, p := range finished.Pages {
		if p.Status == "visited" {
			visited++
		}
		if p.Status == "pending" {
			pending++
		}
	}
	if visited != 1 || pending == 0 {
		t.Fatal("depth limit not respected", finished.Pages)
	}
	assertClean(t, sessions)
}
