package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

func TestServiceShutdownReleasesListener(t *testing.T) {
	s, err := Start(Options{Address: "127.0.0.1:0", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	r, err := http.Get(s.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Data struct {
			Version string `json:"version"`
		}
	}
	err = json.NewDecoder(r.Body).Decode(&result)
	r.Body.Close()
	if err != nil || result.Data.Version != model.Version {
		t.Fatal(result, err)
	}
	s.Close()
	s.Close()
	if r, e := http.Get(s.URL + "/api/health"); e == nil {
		r.Body.Close()
		t.Fatal("listener survived shutdown")
	}
}

func TestSharedDataDirectoryRefusesSecondServiceBeforeRecovery(t *testing.T) {
	dir := t.TempDir()
	first, err := Start(Options{Address: "127.0.0.1:0", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	task := model.ScanTask{ID: "in-progress", Status: "running", StartedAt: time.Now()}
	if err = first.Store.Save(task, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"127.0.0.1:0", first.URL[len("http://"):]} {
		if second, err := Start(Options{Address: address, DataDir: filepath.Join(dir, ".")}); !errors.Is(err, storage.ErrDataInUse) {
			if second != nil {
				second.Close()
			}
			t.Fatalf("expected data lock: %v", err)
		}
	}
	if saved, err := first.Store.Task(task.ID); err != nil || saved.Status != "running" {
		t.Fatalf("first instance lost its active record: %s, %v", saved.Status, err)
	}
	first.Close()
	next, err := Start(Options{Address: "127.0.0.1:0", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	if saved, err := next.Store.Task(task.ID); err != nil || saved.EndReason != "service_interrupted" {
		t.Fatalf("restart did not restore history: %s, %v", saved.EndReason, err)
	}
}

func TestProtectedServiceRequiresAccessForPageAPIAndEvents(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "access-password")
	if err := ensureAccessPassword(file); err != nil {
		t.Fatal(err)
	}
	secret, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Start(Options{Address: "127.0.0.1:0", DataDir: dir, AccessPasswordFile: file})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, endpoint := range []string{"/", "/api/health", "/api/session", "/api/scans/history", "/api/scans/demo/events"} {
		response, err := http.Get(s.URL + endpoint)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized || response.Header.Get("WWW-Authenticate") == "" {
			t.Fatalf("%s did not require credentials", endpoint)
		}
	}
	req, err := http.NewRequest(http.MethodGet, s.URL+"/api/session", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.SetBasicAuth("castorice", string(bytes.TrimSpace(secret)))
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatal("valid credentials could not access the service")
	}
}

func TestContainerOriginMustBeExplicitAndExact(t *testing.T) {
	for _, origin := range []string{"", "https://user:secret@example.com", "https://example.com/path", "https://example.com?x=1"} {
		if s, err := Start(Options{Address: "0.0.0.0:0", DataDir: t.TempDir(), PublicURL: origin}); err == nil {
			s.Close()
			t.Fatal("unsafe origin accepted", origin)
		}
	}
	s, err := Start(Options{Address: "0.0.0.0:0", DataDir: t.TempDir(), PublicURL: "http://127.0.0.1:19110"})
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
}

func TestDesktopExportsAreConfinedAndAuthenticated(t *testing.T) {
	p, err := portable.Open(filepath.Join(t.TempDir(), "app.exe"))
	if err != nil {
		t.Fatal(err)
	}
	s, err := Start(Options{Address: "127.0.0.1:0", DataDir: p.Data, SaveExport: p.SaveExport})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err := http.Get(s.URL + "/api/session")
	if err != nil {
		t.Fatal(err)
	}
	var session struct {
		Data struct {
			Token string `json:"token"`
		}
	}
	err = json.NewDecoder(r.Body).Decode(&session)
	r.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		token, origin, name string
		want                int
	}{{"", "", "rules.yaml", 403}, {session.Data.Token, "https://external.example", "rules.yaml", 403}, {session.Data.Token, s.URL, "rules.yaml", 200}, {session.Data.Token, s.URL, "../escape.yaml", 400}} {
		body, _ := json.Marshal(map[string]string{"filename": tc.name, "content": "rules: []\n"})
		req, _ := http.NewRequest("POST", s.URL+"/api/desktop/export", bytes.NewReader(body))
		req.Header.Set("X-Castorice-Token", tc.token)
		req.Header.Set("Origin", tc.origin)
		response, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		response.Body.Close()
		if response.StatusCode != tc.want {
			t.Fatalf("%+v: status %d", tc, response.StatusCode)
		}
	}
	if _, err = os.Stat(filepath.Join(p.Exports, "rules.yaml")); err != nil {
		t.Fatal("export missing", err)
	}
	if _, err = os.Stat(filepath.Join(p.Root, "escape.yaml")); !os.IsNotExist(err) {
		t.Fatal("path escaped", err)
	}
}
