package app

import (
	"bytes"
	"encoding/json"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/portable"
	"net/http"
	"os"
	"path/filepath"
	"testing"
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
