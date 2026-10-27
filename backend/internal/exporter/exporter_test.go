package exporter

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"go.yaml.in/yaml/v3"
)

func domainRecords(values ...string) []model.DomainRecord {
	out := []model.DomainRecord{}
	for _, s := range values {
		out = append(out, model.DomainRecord{Hostname: s, Kind: "domain"})
	}
	return out
}
func job() model.ExportJob {
	return model.ExportJob{TaskID: "test", Mode: "observed", Format: "clash", Policy: "中文策略", Filename: "中文 规则.yaml"}
}
func cat(entries ...model.RuleEntry) model.RuleCategory {
	for i := range entries {
		entries[i].Origins = []model.RuleOrigin{{Source: "test", Category: "app", Version: "abc", License: "MIT"}}
	}
	return model.RuleCategory{ID: "test:app", Name: "app", Loaded: true, Rules: entries, RuleCount: len(entries)}
}
func TestObservedDefaultAndFormats(t *testing.T) {
	for _, format := range []string{"clash", "provider", "singbox"} {
		t.Run(format, func(t *testing.T) {
			j := job()
			j.Format = format
			result, err := Build(j, domainRecords("gemini.google.com", "accounts.google.com"), nil)
			if err != nil {
				t.Fatal(err)
			}
			if result.FinalRules != 2 || result.AddedRules != 0 || result.Filename != "中文 规则"+map[string]string{"clash": ".yaml", "provider": ".yaml", "singbox": ".json"}[format] {
				t.Fatalf("unexpected %+v", result)
			}
			if strings.Contains(result.Content, "DOMAIN-SUFFIX") {
				t.Fatal("default broadened hostname")
			}
			if format == "singbox" {
				var parsed struct {
					Version int `json:"version"`
					Rules   []struct {
						Domains []string `json:"domain"`
					} `json:"rules"`
				}
				if json.Unmarshal([]byte(result.Content), &parsed) != nil || parsed.Version != 3 || len(parsed.Rules[0].Domains) != 2 {
					t.Fatal("invalid source set")
				}
			} else {
				var parsed map[string][]string
				if yaml.Unmarshal([]byte(result.Content), &parsed) != nil {
					t.Fatal("invalid YAML")
				}
				key := "rules"
				if format == "provider" {
					key = "payload"
				}
				if len(parsed[key]) != 2 {
					t.Fatal("wrong header")
				}
				for _, rule := range parsed[key] {
					if format == "provider" && strings.Contains(rule, "中文策略") {
						t.Fatal("provider has policy")
					}
					if format == "clash" && !strings.HasSuffix(rule, ",中文策略") {
						t.Fatal("policy lost")
					}
				}
			}
		})
	}
	j := job()
	j.ListOnly = true
	out, err := Build(j, domainRecords("example.com"), nil)
	if err != nil {
		t.Fatal(err)
	}
	var list []string
	if yaml.Unmarshal([]byte(out.Content), &list) != nil || len(list) != 1 {
		t.Fatal("list only not YAML list")
	}
}
func TestMergeAndCoverage(t *testing.T) {
	j := job()
	j.Mode = "merged"
	c := cat(model.RuleEntry{Type: model.Domain, Value: "a.example.com"}, model.RuleEntry{Type: model.Suffix, Value: "example.com"}, model.RuleEntry{Type: model.Domain, Value: "new.example.net"}, model.RuleEntry{Type: model.Keyword, Value: "app"})
	out, err := Build(j, domainRecords("a.example.com", "unique.example.org"), []model.RuleCategory{c})
	if err != nil {
		t.Fatal(err)
	}
	if out.ObservedDomains != 2 || out.FinalRules != 4 || out.AddedRules != 3 || out.DuplicateOrCovered != 2 {
		t.Fatalf("wrong actual stats: %+v", out)
	}
	if strings.Contains(out.Content, "DOMAIN,a.example.com,") {
		t.Fatal("covered exact duplicated")
	}
	if !strings.Contains(out.Content, "DOMAIN,unique.example.org,") {
		t.Fatal("A-only removed")
	}
	if !strings.Contains(out.Content, "DOMAIN,new.example.net,") {
		t.Fatal("B-only missing")
	}
	j.Excluded = []string{"DOMAIN-SUFFIX,example.com"}
	out, err = Build(j, domainRecords("a.example.com", "unique.example.org"), []model.RuleCategory{c})
	if err != nil || !strings.Contains(out.Content, "DOMAIN,a.example.com,") {
		t.Fatal("excluding parent did not restore child", err)
	}
	if _, err = Build(j, domainRecords("example.com"), nil); err == nil {
		t.Fatal("no category silently merged")
	}
}
func TestMergeEqualEmptyAndTypes(t *testing.T) {
	j := job()
	j.Mode = "merged"
	out, err := Build(j, domainRecords("example.com"), []model.RuleCategory{cat(model.RuleEntry{Type: model.Domain, Value: "example.com"})})
	if err != nil || out.FinalRules != 1 || out.AddedRules != 0 || out.DuplicateOrCovered != 1 {
		t.Fatal(out, err)
	}
	out, err = Build(j, domainRecords("example.com"), []model.RuleCategory{cat()})
	if err != nil || out.FinalRules != 1 {
		t.Fatal("empty category broke observations", err)
	}
	out, err = Build(j, domainRecords("example.com"), []model.RuleCategory{cat(model.RuleEntry{Type: model.Suffix, Value: "example.com"})})
	if err != nil || out.FinalRules != 1 || !strings.Contains(out.Content, "DOMAIN-SUFFIX") {
		t.Fatal("type semantics lost", err)
	}
	j.Domains = []string{}
	if _, err = Build(j, domainRecords("example.com"), []model.RuleCategory{cat()}); err == nil {
		t.Fatal("empty user selection ignored")
	}
}
func TestValidationAndFilename(t *testing.T) {
	for _, name := range []string{"", "x,y", "x\ny"} {
		if ValidatePolicy(name) == nil {
			t.Fatal("bad policy accepted")
		}
	}
	for _, raw := range []string{"../secret.yaml", "..\\secret.json", "CON", "中文:规则?"} {
		name := Filename(raw, ".yaml")
		if strings.ContainsAny(name, "/\\:?*") {
			t.Fatal("unsafe filename", name)
		}
	}
	j := job()
	if _, err := Build(j, []model.DomainRecord{{Hostname: "8.8.8.8", Kind: "ipv4"}}, nil); err == nil {
		t.Fatal("IP exported as domain")
	}
}

func TestNestedSuffixCoverageAndBoundary(t *testing.T) {
	j := job()
	j.Mode = "merged"
	c := cat(model.RuleEntry{Type: model.Suffix, Value: "example.com"}, model.RuleEntry{Type: model.Suffix, Value: "a.example.com"}, model.RuleEntry{Type: model.Domain, Value: "a.example.com"}, model.RuleEntry{Type: model.Domain, Value: "x.a.example.com"}, model.RuleEntry{Type: model.Domain, Value: "notexample.com"})
	for _, exclusions := range [][]string{nil, {"DOMAIN-SUFFIX,example.com"}, {"DOMAIN-SUFFIX,example.com", "DOMAIN-SUFFIX,a.example.com"}} {
		j.Excluded = exclusions
		out, err := Build(j, nil, []model.RuleCategory{c})
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range out.Entries {
			if entry.Type != model.Domain {
				continue
			}
			want := ""
			if entry.Value != "notexample.com" {
				if len(exclusions) == 0 {
					want = "DOMAIN-SUFFIX,example.com"
				} else if len(exclusions) == 1 {
					want = "DOMAIN-SUFFIX,a.example.com"
				}
			}
			if entry.CoveredBy != want {
				t.Fatalf("%s: want %q, got %q", entry.Value, want, entry.CoveredBy)
			}
		}
	}
}

func TestLargeExportRetainsAllEntries(t *testing.T) {
	entries := make([]model.RuleEntry, 30000)
	for i := range entries {
		entries[i] = model.RuleEntry{Type: model.Suffix, Value: fmt.Sprintf("d%d.example.com", i)}
	}
	j := job()
	j.Mode = "merged"
	out, err := Build(j, domainRecords("sub.d42.example.com"), []model.RuleCategory{cat(entries...)})
	if err != nil || out.FinalRules != len(entries) || len(out.Entries) != len(entries)+1 {
		t.Fatalf("large export truncated: %d, %d, %v", out.FinalRules, len(out.Entries), err)
	}
	if !strings.Contains(out.Content, "d29999.example.com") {
		t.Fatal("last entry missing")
	}
}
