package rules_test

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/exporter"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/matcher"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, context.DeadlineExceeded
}

func TestLiveRuleSourcesAndOfflineCache(t *testing.T) {
	if os.Getenv("CASTORICE_RULES_LIVE") != "1" {
		t.Skip("设置 CASTORICE_RULES_LIVE=1 下载并验证真实 GitHub 规则源")
	}
	store, err := storage.Open(filepath.Join(t.TempDir(), "rules.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"blackmatrix7", "v2fly"} {
		t.Run(id, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
			defer cancel()
			if err := manager.Sync(ctx, id); err != nil {
				t.Fatal(err)
			}
			count, loaded, rules := 0, 0, 0
			for _, c := range manager.Categories(false) {
				if c.Source == id {
					count++
					if c.Loaded {
						loaded++
						rules += c.RuleCount
					}
				}
			}
			if count < 10 || loaded < 5 || rules < 20 {
				t.Fatal("incomplete actual source", count, loaded, rules)
			}
			for _, s := range manager.Sources() {
				if s.ID == id {
					t.Logf("%s commit=%s categories=%d loaded=%d supported_rule_entries=%d license_bytes=%d", id, s.Version, count, loaded, rules, len(s.LicenseText))
					if s.Version == "" || len(s.LicenseText) < 100 {
						t.Fatal("missing provenance/license")
					}
				}
			}
		})
	}
	gemini, ok := manager.Category("blackmatrix7:Gemini")
	if !ok || !gemini.Loaded {
		t.Fatal("real Gemini category missing")
	}
	// This is explicitly constructed observation metadata, paired with the real
	// downloaded rule data; it is not represented as a browser capture.
	observation := []model.DomainRecord{{Hostname: "gemini.google.com", Kind: "domain"}, {Hostname: "accounts.google.com", Kind: "domain"}, {Hostname: "fonts.gstatic.com", Kind: "domain"}, {Hostname: "generativelanguage.googleapis.com", Kind: "domain"}}
	matches, recommendation, _ := matcher.Match("gemini.google.com", observation, manager.Categories(true))
	if recommendation != "blackmatrix7:Gemini" && recommendation != "v2fly:google-gemini" {
		t.Fatalf("real categories misidentified Gemini: %s %+v", recommendation, matches)
	}
	merged, err := exporter.Build(model.ExportJob{TaskID: "constructed-observation", Mode: "merged", Format: "clash", Policy: "dibao"}, observation, []model.RuleCategory{gemini})
	if err != nil || merged.FinalRules <= len(observation) || merged.AddedRules == 0 {
		t.Fatal("real rules not merged", merged, err)
	}
	t.Logf("real-source Gemini recommendation=%s merge observed_domains=%d added_rules=%d duplicate_or_covered=%d final_rules=%d", recommendation, merged.ObservedDomains, merged.AddedRules, merged.DuplicateOrCovered, merged.FinalRules)
	if _, _, err = rules.ParseClash([]byte("payload: []"), model.RuleOrigin{File: "test.yaml"}); err == nil {
		t.Fatal("empty source accepted")
	}
	manager, err = rules.NewManager(store, rules.WithHTTPClient(&http.Client{Transport: failingTransport{}}))
	if err != nil {
		t.Fatal(err)
	}
	if err = manager.Sync(context.Background(), "blackmatrix7"); err == nil {
		t.Fatal("offline update reported success")
	}
	cached, ok := manager.Category(gemini.ID)
	if !ok || len(cached.Rules) != len(gemini.Rules) {
		t.Fatal("offline update destroyed cache")
	}
	reloaded, err := rules.NewManager(store)
	if err != nil {
		t.Fatal(err)
	}
	if c, ok := reloaded.Category(gemini.ID); !ok || !c.Loaded || len(c.Rules) == 0 {
		t.Fatal("cache did not survive manager reload")
	}
}
