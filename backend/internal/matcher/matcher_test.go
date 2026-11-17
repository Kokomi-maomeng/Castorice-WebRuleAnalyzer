package matcher

import (
	"fmt"
	"strings"
	"testing"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

func category(name string, broad bool, entries ...model.RuleEntry) model.RuleCategory {
	return model.RuleCategory{ID: "test:" + name, Name: name, Source: "test", Version: "abc", Loaded: true, Broad: broad, Rules: entries, RuleCount: len(entries)}
}
func suffix(s string) model.RuleEntry { return model.RuleEntry{Type: model.Suffix, Value: s} }
func observed(values ...string) []model.DomainRecord {
	out := []model.DomainRecord{}
	for _, s := range values {
		out = append(out, model.DomainRecord{Hostname: s, Kind: "domain"})
	}
	return out
}
func TestAppNotGenericParent(t *testing.T) {
	categories := []model.RuleCategory{category("Workbench", false, suffix("workbench.example.com"), suffix("assets.example.org")), category("Parent", true, suffix("example.com"), suffix("static.example.org"), suffix("api.example.org"))}
	matches, recommendation, _, _ := Match("workbench.example.com", observed("workbench.example.com", "accounts.example.com", "fonts.static.example.org", "api.example.com"), categories)
	if recommendation != "test:Workbench" || len(matches) != 2 || matches[0].Confidence != "high" {
		t.Fatalf("wrong recommendation: %s %+v", recommendation, matches)
	}
	_, recommendation, _, _ = Match("workbench.example.com", observed("workbench.example.com", "accounts.example.com", "fonts.static.example.org"), categories[1:])
	if recommendation != "" {
		t.Fatal("generic Parent auto selected")
	}
}
func TestSharedUnknownAndAmbiguous(t *testing.T) {
	cats := []model.RuleCategory{category("one", false, suffix("accounts.example.com")), category("two", false, suffix("accounts.example.com"))}
	_, recommended, _, _ := Match("unrelated.example.com", observed("accounts.example.com", "fonts.static.example.org"), cats)
	if recommended != "" {
		t.Fatal("shared auth identifies app")
	}
	matches, recommended, _, _ := Match("new.example.com", observed("new.example.com"), cats)
	if recommended != "" || len(matches) != 0 {
		t.Fatal("unknown app matched")
	}
	// Distinct categories both claim an explicit target label: ambiguity must be
	// resolved by the user, even when each category looks strong independently.
	cats = []model.RuleCategory{category("alpha", false, suffix("alpha.beta.example.com")), category("beta", false, suffix("alpha.beta.example.com"))}
	matches, recommended, _, _ = Match("alpha.beta.example.com", observed("alpha.beta.example.com"), cats)
	if recommended != "" || matches[0].Suitable {
		t.Fatal("close candidates auto selected")
	}
	cats = []model.RuleCategory{category("advert", false, model.RuleEntry{Type: model.Keyword, Value: "example"})}
	_, recommended, _, _ = Match("alpha.example.com", observed("alpha.example.com"), cats)
	if recommended != "" {
		t.Fatal("keyword inferred identity")
	}
}

func TestSharedRulesDoNotIdentifyUnrelatedTarget(t *testing.T) {
	cats := []model.RuleCategory{
		category("Workbench", false, suffix("workbench.example.com")),
		category("Editor", false, suffix("www.example.com")),
		category("Notebook", false, suffix("www.example.com")),
		category("Parent", true, suffix("example.com")),
	}
	matches, recommendation, _, _ := Match("workbench.example.net", observed("workbench.example.net", "www.example.com", "analytics.example.org"), cats)
	if recommendation != "" {
		t.Fatal("unrelated Workbench application recommended")
	}
	for _, hit := range matches {
		if hit.Relation != "dependency" || hit.Suitable || len(hit.Evidence) == 0 {
			t.Fatalf("shared hit misrepresented: %+v", hit)
		}
	}
	_, recommendation, _, _ = Match("workbench.example.com", observed("workbench.example.com", "www.example.com"), cats)
	if recommendation != "test:Workbench" {
		t.Fatal("actual Parent Workbench not identified", recommendation)
	}
}

func TestSuffixBoundaryKeywordAndLargeApp(t *testing.T) {
	cats := []model.RuleCategory{category("Facebook", false, suffix("facebook.com")), category("Keyword", false, model.RuleEntry{Type: model.Keyword, Value: "facebook"})}
	matches, recommended, _, _ := Match("facebook.com.evil.example", observed("facebook.com.evil.example"), cats)
	if recommended != "" || len(matches) != 1 || matches[0].Relation == "target" {
		t.Fatal("suffix boundary or keyword used as identity", matches)
	}
	matches, recommended, _, _ = Match("www.facebook.com", observed("www.facebook.com"), cats)
	if recommended != "test:Facebook" || matches[0].Evidence[0].Value != "facebook.com" {
		t.Fatal("specific suffix not identified", matches)
	}
}

func TestMatchTruncationIsExplicit(t *testing.T) {
	cats := []model.RuleCategory{}
	for i := 0; i < 70; i++ {
		cats = append(cats, model.RuleCategory{ID: fmt.Sprint(i), Name: "shared", Loaded: true, Rules: []model.RuleEntry{{Type: model.Domain, Value: "example.com"}}})
	}
	hits, _, note, total := Match("example.com", []model.DomainRecord{{Hostname: "example.com", Kind: "domain"}}, cats)
	if total != 70 || len(hits) != 60 || !strings.Contains(note, "70") {
		t.Fatal("hidden truncation", len(hits), total, note)
	}
}
