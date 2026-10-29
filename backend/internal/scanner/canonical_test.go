package scanner

import (
	"context"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/security"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExploreCanonicalRedirect(t *testing.T) {
	if os.Getenv("CASTORICE_BROWSER_TEST") != "1" {
		t.Skip("real browser opt in")
	}
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, port, _ := strings.Cut(r.Host, ":")
		if strings.HasPrefix(r.Host, "scan.test:") {
			http.Redirect(w, r, "http://www.scan.test:"+port+"/", 302)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/" {
			w.Write([]byte(`<html><body><a href="/second">second</a></body></html>`))
		} else {
			w.Write([]byte(`<html><body>Second page</body></html>`))
		}
	}))
	defer site.Close()
	u, _ := url.Parse(site.URL)
	st, err := storage.Open(filepath.Join(t.TempDir(), "audit.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	rm, err := rules.NewManager(st)
	if err != nil {
		t.Fatal(err)
	}
	mappings := map[string]netip.Addr{}
	for _, h := range []string{"scan.test", "www.scan.test"} {
		mappings[h+":"+u.Port()] = netip.MustParseAddr("127.0.0.1")
	}
	m := NewManager(st, rm, Engine{Policy: security.Policy{TestMappings: mappings}, SessionDir: filepath.Join(t.TempDir(), "sessions")})
	defer m.Close()
	o := model.DefaultOptions()
	o.Mode = "explore"
	o.MaxSeconds = 30
	o.ObserveSeconds = 1
	o.QuietMillis = 100
	o.IntervalMillis = 0
	task, err := m.Start(context.Background(), "http://scan.test:"+u.Port(), o)
	if err != nil {
		t.Fatal(err)
	}
	done := waitTask(t, m, task.ID)
	visited := 0
	canonicalSkipped := false
	for _, p := range done.Pages {
		if p.Status == "visited" {
			visited++
		}
		if strings.Contains(p.URL, "www.scan.test") && strings.HasSuffix(p.URL, "/second") && p.Status == "skipped" {
			canonicalSkipped = true
		}
	}
	t.Logf("AUDIT canonical redirect: status=%s visited=%d canonical_link_skipped=%v pages=%+v", done.Status, visited, canonicalSkipped, done.Pages)
	if canonicalSkipped || visited != 2 || done.EndReason != "completed" {
		t.Fatal("canonical redirect did not continue", done)
	}
}
