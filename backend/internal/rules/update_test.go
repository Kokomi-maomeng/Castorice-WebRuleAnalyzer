package rules_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

func TestV2flyConversionFailureKeepsLastSnapshot(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "data", "rules.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	old := model.RuleCategory{ID: "v2fly:app", Source: "v2fly", Name: "app", Version: "previous", Loaded: true,
		Raw: "app.example.com\n", Rules: []model.RuleEntry{{Type: model.Suffix, Value: "app.example.com"}}}
	source := model.RuleSource{ID: "v2fly", Version: old.Version, Status: "ready", CategoryCount: 1, LoadedCount: 1}
	if err = store.SaveSource(source, []model.RuleCategory{old}, true); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	zipped := gzip.NewWriter(&archive)
	tarball := tar.NewWriter(zipped)
	for name, text := range map[string]string{"app": "replacement.example.net\n", "broken": "include:missing-file\n"} {
		if err = tarball.WriteHeader(&tar.Header{Name: "snapshot/data/" + name, Mode: 0600, Size: int64(len(text))}); err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(tarball, text); err != nil {
			t.Fatal(err)
		}
	}
	if err = tarball.Close(); err != nil {
		t.Fatal(err)
	}
	if err = zipped.Close(); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: transportFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "api.github.com" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`[{"sha":"newer"}]`))}, nil
		}
		if req.URL.Host == "codeload.github.com" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(archive.Bytes()))}, nil
		}
		return nil, errors.New("unexpected host")
	})}
	manager, err := rules.NewManager(store, rules.WithHTTPClient(client))
	if err != nil {
		t.Fatal(err)
	}
	if err = manager.Sync(context.Background(), "v2fly"); err == nil || !strings.Contains(err.Error(), "broken") {
		t.Fatalf("expected the failed category to be reported: %v", err)
	}
	reloaded, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	kept, ok := reloaded.Category(old.ID)
	if !ok || kept.Version != old.Version || kept.Raw != old.Raw || reloaded.Sources()[1].Status != "cached" {
		t.Fatalf("previous snapshot lost: %+v", kept)
	}
}

type upstream struct {
	mu           sync.Mutex
	version      string
	offline      bool
	rawDownloads int
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPreferencesDuringAnotherSourceUpdate(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "data", "rules.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	u := &upstream{version: "snapshot1"}
	started, resume := make(chan struct{}), make(chan struct{})
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "/commits") {
			close(started)
			<-resume
		}
		return u.RoundTrip(r)
	})}
	m, err := rules.NewManager(store, rules.WithHTTPClient(client))
	if err != nil {
		t.Fatal(err)
	}
	if err = m.SetAutoUpdate("blackmatrix7", true); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- m.Sync(context.Background(), "blackmatrix7") }()
	<-started
	first := m.SetAutoUpdate("v2fly", true)
	second := m.SetAutoUpdate("blackmatrix7", false)
	close(resume)
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	if first != nil || second != nil {
		t.Fatal("preferences blocked by download", first, second)
	}
	for _, s := range m.Sources() {
		if s.ID == "blackmatrix7" && s.AutoUpdate || s.ID == "v2fly" && !s.AutoUpdate {
			t.Fatal("download overwrote preference", s)
		}
	}
	reloaded, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range reloaded.Sources() {
		if s.ID == "blackmatrix7" && s.AutoUpdate || s.ID == "v2fly" && !s.AutoUpdate {
			t.Fatal("preference not persisted", s)
		}
	}
}

func (u *upstream) RoundTrip(r *http.Request) (*http.Response, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.offline {
		return nil, errors.New("fixture offline")
	}
	body := ""
	switch {
	case strings.Contains(r.URL.Path, "/commits"):
		body = `[{"sha":"` + u.version + `"}]`
	case strings.Contains(r.URL.Path, "/git/trees/clash-tree"):
		body = `{"tree":[{"path":"Facebook/Facebook.yaml","type":"blob","sha":"facebook-` + u.version + `"},{"path":"Workbench/Workbench.yaml","type":"blob","sha":"workbench-stable"}]}`
	case strings.Contains(r.URL.Path, "/git/trees/rule-tree"):
		body = `{"tree":[{"path":"Clash","type":"tree","sha":"clash-tree"}]}`
	case strings.Contains(r.URL.Path, "/git/trees/"):
		body = `{"tree":[{"path":"rule","type":"tree","sha":"rule-tree"}]}`
	case strings.HasSuffix(r.URL.Path, "/LICENSE"):
		body = "GNU GENERAL PUBLIC LICENSE\nVersion 2"
	case strings.HasSuffix(r.URL.Path, "/Facebook.yaml"):
		u.rawDownloads++
		body = "# original " + u.version + "\npayload:\n  - DOMAIN-SUFFIX,facebook.com\n  - IP-CIDR,1.2.3.0/24\n"
	case strings.HasSuffix(r.URL.Path, "/Workbench.yaml"):
		u.rawDownloads++
		body = "payload:\n  - DOMAIN-SUFFIX,workbench.example.com\n"
	default:
		return nil, errors.New("unexpected fixture URL: " + r.URL.String())
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
}

func TestAutoUpdateRawAndAtomicOfflineRecovery(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "data", "rules.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	transport := &upstream{version: "snapshot1"}
	client := &http.Client{Transport: transport}
	manager, err := rules.NewManager(store, rules.WithHTTPClient(client))
	if err != nil {
		t.Fatal(err)
	}
	if err = manager.SetAutoUpdate("blackmatrix7", true); err != nil {
		t.Fatal(err)
	}
	manager, err = rules.NewManager(store, rules.WithHTTPClient(client))
	if err != nil {
		t.Fatal(err)
	}
	if !manager.Sources()[0].AutoUpdate {
		t.Fatal("preference not persisted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { manager.Run(ctx); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for manager.Sources()[0].Status != "ready" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	source := manager.Sources()[0]
	if source.Status != "ready" || source.LoadedCount != 2 || source.CheckedAt == nil {
		t.Fatalf("auto initialization failed: %+v", source)
	}
	facebook, ok := manager.Category("blackmatrix7:Facebook")
	if !ok || !strings.Contains(facebook.Raw, "IP-CIDR,1.2.3.0/24") || facebook.RuleCount != 1 || facebook.Broad {
		t.Fatal("raw content lost or app classified as broad", facebook)
	}
	transport.mu.Lock()
	transport.version = "snapshot2"
	transport.mu.Unlock()
	checked, err := manager.Check(context.Background(), source.ID)
	if err != nil || checked.RemoteVersion != "snapshot2" || checked.Version != "snapshot1" {
		t.Fatal("update check changed active snapshot", checked, err)
	}
	if err = manager.Sync(context.Background(), source.ID); err != nil {
		t.Fatal(err)
	}
	transport.mu.Lock()
	downloads := transport.rawDownloads
	transport.offline = true
	transport.mu.Unlock()
	if downloads != 3 {
		t.Fatal("unchanged content was unnecessarily downloaded", downloads)
	}
	workbench, _ := manager.Category("blackmatrix7:Workbench")
	if workbench.Rules[0].Origins[0].Version != "snapshot2" {
		t.Fatal("reused blob has old provenance")
	}
	if err = manager.Sync(context.Background(), source.ID); err == nil {
		t.Fatal("offline update succeeded")
	}
	cached, _ := manager.Category(facebook.ID)
	if !strings.Contains(cached.Raw, "snapshot2") || manager.Sources()[0].Status != "cached" {
		t.Fatal("failed update destroyed latest snapshot")
	}
	if err = manager.SetAutoUpdate(source.ID, false); err != nil {
		t.Fatal(err)
	}
	reloaded, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Sources()[0].AutoUpdate {
		t.Fatal("disable not persisted")
	}
	if err = reloaded.SetAutoUpdate("unknown", true); err == nil {
		t.Fatal("unknown source accepted")
	}
}

func TestLargeAppIsNotGeneric(t *testing.T) {
	if rules.Broad("Facebook") || !rules.Broad("Google") {
		t.Fatal("classification relies on file size")
	}
}

func TestLegacyV2flyCacheGetsExactOriginalWithoutChangingRules(t *testing.T) {
	store, err := storage.Open(filepath.Join(t.TempDir(), "data", "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	category := model.RuleCategory{ID: "v2fly:facebook", Source: "v2fly", Name: "facebook", Version: "old-commit", Path: "data/facebook", Loaded: true, RuleCount: 1, Rules: []model.RuleEntry{{Type: model.Suffix, Value: "facebook.com"}}}
	if err = store.SaveSource(model.RuleSource{ID: "v2fly", Version: "old-commit", CategoryCount: 1, LoadedCount: 1}, []model.RuleCategory{category}, true); err != nil {
		t.Fatal(err)
	}
	raw := "# original\nfacebook.com\n"
	client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v2fly/domain-list-community/old-commit/data/facebook" {
			return nil, errors.New("wrong snapshot")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
	})}
	m, err := rules.NewManager(store, rules.WithHTTPClient(client))
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := m.Load(context.Background(), category.ID)
	if err != nil || loaded.Raw != raw || !loaded.Loaded || loaded.Version != "old-commit" || loaded.RuleCount != 1 {
		t.Fatal("legacy cache migration changed snapshot", loaded, err)
	}
	if m.Sources()[1].LoadedCount != 1 {
		t.Fatal("legacy loaded count doubled")
	}
}
