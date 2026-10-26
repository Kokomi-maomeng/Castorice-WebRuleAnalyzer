package api

import (
	"encoding/json"
	"io"
	"net/url"
	"strings"
	"testing"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
)

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
