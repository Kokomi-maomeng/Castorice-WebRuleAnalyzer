package api

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestDesktopExportRejectsAmbiguousJSON(t *testing.T) {
	s, _ := testAPI(t)
	calls := 0
	s.SaveExport = func(name, content string) (string, error) { calls++; return "exports/" + name, nil }
	for _, body := range []string{`{"filename":"x.yaml","content":"ok"} {"content":"ignored"}`, `{"filename":"x.yaml","content":"ok","unknown":true}`} {
		r := request(t, s, http.MethodPost, "/api/desktop/export", body, true)
		r.Body.Close()
		if r.StatusCode != 400 {
			t.Fatal(r.StatusCode)
		}
	}
	if calls != 0 {
		t.Fatal("invalid body reached disk")
	}
	r := request(t, s, http.MethodPost, "/api/desktop/export", `{"filename":"x.yaml","content":"ok"}`, true)
	r.Body.Close()
	if r.StatusCode != 200 || calls != 1 {
		t.Fatal("valid export rejected")
	}
	r = request(t, s, http.MethodGet, "/api/scans/active", "", false)
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	if !strings.Contains(string(b), `"data":null`) {
		t.Fatal("missing explicit idle state", string(b))
	}
}
