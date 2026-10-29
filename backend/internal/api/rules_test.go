package api

import (
	"encoding/json"
	"io"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
)

func TestMergedExportRejectsStaleSelectedVersion(t *testing.T) {
	s, _ := testAPI(t)
	task := model.ScanTask{ID: "snapshot", Status: "completed", StartedAt: time.Now()}
	if err := s.Store.Save(task, []model.NetworkRequest{}, []model.DomainRecord{{Hostname: "example.com", Kind: "domain"}}, nil); err != nil {
		t.Fatal(err)
	}
	c := model.RuleCategory{ID: "v2fly:app", Name: "app", Source: "v2fly", Version: "new", ContentHash: "hash", Loaded: true, Rules: []model.RuleEntry{{Type: model.Domain, Value: "example.com"}}}
	if err := s.Store.SaveSource(model.RuleSource{ID: "v2fly", Version: "new"}, []model.RuleCategory{c}, true); err != nil {
		t.Fatal(err)
	}
	var err error
	s.Rules, err = rules.NewManager(s.Store)
	if err != nil {
		t.Fatal(err)
	}
	for _, snapshot := range []string{"old:hash", "new:hash"} {
		body, _ := json.Marshal(model.ExportJob{TaskID: task.ID, Mode: "merged", CategoryIDs: []string{c.ID}, CategoryVersions: map[string]string{c.ID: snapshot}, Format: "clash", Policy: "existing"})
		r := request(t, s, "POST", "/api/export", string(body), true)
		data, _ := io.ReadAll(r.Body)
		r.Body.Close()
		want := 200
		if snapshot == "old:hash" {
			want = 409
		}
		if r.StatusCode != want {
			t.Fatalf("snapshot %s: status=%d body=%s", snapshot, r.StatusCode, data)
		}
	}
}

func TestRuleContentSearchAndUpdatePreference(t *testing.T) {
	s, _ := testAPI(t)
	raw := "# preserved YAML\npayload:\n  - DOMAIN-SUFFIX,facebook.com\n  - IP-CIDR,1.2.3.0/24\n"
	category := model.RuleCategory{ID: "blackmatrix7:Facebook", Name: "Facebook", Source: "blackmatrix7", Version: "abc", Raw: raw, Format: "yaml", Loaded: true}
	if err := s.Store.SaveSource(model.RuleSource{ID: "blackmatrix7", Version: "abc"}, []model.RuleCategory{category}, true); err != nil {
		t.Fatal(err)
	}
	var err error
	s.Rules, err = rules.NewManager(s.Store)
	if err != nil {
		t.Fatal(err)
	}
	r := request(t, s, "GET", "/api/rules/categories?q=facebook.com", "", false)
	data, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 || !strings.Contains(string(data), "Facebook") || strings.Contains(string(data), "preserved YAML") {
		t.Fatal("search result missing or leaks full payload", string(data))
	}
	r = request(t, s, "GET", "/api/rules/content?id="+url.QueryEscape(category.ID), "", false)
	var result struct{ Data model.RuleCategory }
	err = json.NewDecoder(r.Body).Decode(&result)
	r.Body.Close()
	if err != nil || result.Data.Raw != raw {
		t.Fatal("raw bytes changed", err, result)
	}
	r = request(t, s, "PUT", "/api/rules/auto-update", `{"source":"blackmatrix7","enabled":true}`, false)
	r.Body.Close()
	if r.StatusCode != 403 {
		t.Fatal("unprotected update preference")
	}
	r = request(t, s, "PUT", "/api/rules/auto-update", `{"source":"blackmatrix7","enabled":true}`, true)
	r.Body.Close()
	if r.StatusCode != 200 || !s.Rules.Sources()[0].AutoUpdate {
		t.Fatal("preference not saved")
	}
	r = request(t, s, "GET", "/api/rules/content?id=missing", "", false)
	r.Body.Close()
	if r.StatusCode != 404 {
		t.Fatal("missing category not reported")
	}
}
