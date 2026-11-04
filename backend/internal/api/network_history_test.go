package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

func TestHistoryWritesRequireTokenAndKeepActive(t *testing.T) {
	s, _ := testAPI(t)
	for _, task := range []model.ScanTask{{ID: "done", Status: "completed", TargetURL: "https://example.com/", StartedAt: time.Now()}, {ID: "active", Status: "running", TargetURL: "https://active.example/", StartedAt: time.Now()}} {
		if err := s.Store.Save(task, nil, nil, nil); err != nil {
			t.Fatal(err)
		}
	}
	resp := request(t, s, "DELETE", "/api/scans", `{"all_finished":true}`, false)
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal(resp.StatusCode)
	}
	resp = request(t, s, "DELETE", "/api/scans", `{"ids":["active","done"]}`, true)
	resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatal(resp.StatusCode)
	}
	resp = request(t, s, "DELETE", "/api/scans", `{"all_finished":true}`, true)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	if _, err := s.Store.Task("active"); err != nil {
		t.Fatal("active history lost", err)
	}
}

func TestInputErrorDetailsAndInternalDiagnosis(t *testing.T) {
	s, _ := testAPI(t)
	resp := request(t, s, "POST", "/api/scans", `{"url":"https://example..com"}`, true)
	defer resp.Body.Close()
	var out envelope
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.Error == nil || out.Error.Code != "invalid_url" || out.Error.Diagnostic == nil {
		t.Fatal(out, err)
	}
	resp = request(t, s, "POST", "/api/network/diagnose", `{"url":"http://127.0.0.1/"}`, true)
	defer resp.Body.Close()
	var body struct {
		Data model.NetworkDiagnosis `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.Data.Connected || body.Data.Connection == nil || body.Data.Connection.Code != "target_non_public" {
		t.Fatal(body, err)
	}
}
