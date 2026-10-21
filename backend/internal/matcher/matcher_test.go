package matcher

import (
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
func TestGeminiNotGenericGoogle(t *testing.T) {
	categories := []model.RuleCategory{category("Gemini", false, suffix("gemini.google.com"), suffix("deepmind.google")), category("Google", true, suffix("google.com"), suffix("gstatic.com"), suffix("googleapis.com"))}
	matches, recommendation, _ := Match("gemini.google.com", observed("gemini.google.com", "accounts.google.com", "fonts.gstatic.com", "generativelanguage.googleapis.com"), categories)
	if recommendation != "test:Gemini" || len(matches) != 2 || matches[0].Confidence != "high" {
		t.Fatalf("wrong recommendation: %s %+v", recommendation, matches)
	}
	_, recommendation, _ = Match("gemini.google.com", observed("gemini.google.com", "accounts.google.com", "fonts.gstatic.com"), categories[1:])
	if recommendation != "" {
		t.Fatal("generic Google auto selected")
	}
}
func TestSharedUnknownAndAmbiguous(t *testing.T) {
	cats := []model.RuleCategory{category("one", false, suffix("accounts.google.com")), category("two", false, suffix("accounts.google.com"))}
	_, recommended, _ := Match("unrelated.example.com", observed("accounts.google.com", "fonts.gstatic.com"), cats)
	if recommended != "" {
		t.Fatal("shared auth identifies app")
	}
	matches, recommended, _ := Match("new.example.com", observed("new.example.com"), cats)
	if recommended != "" || len(matches) != 0 {
		t.Fatal("unknown app matched")
	}
	// Distinct categories both claim an explicit target label: ambiguity must be
	// resolved by the user, even when each category looks strong independently.
	cats = []model.RuleCategory{category("alpha", false, suffix("alpha.beta.example.com")), category("beta", false, suffix("alpha.beta.example.com"))}
	matches, recommended, _ = Match("alpha.beta.example.com", observed("alpha.beta.example.com"), cats)
	if recommended != "" || matches[0].Suitable {
		t.Fatal("close candidates auto selected")
	}
	cats = []model.RuleCategory{category("advert", false, model.RuleEntry{Type: model.Keyword, Value: "example"})}
	_, recommended, _ = Match("alpha.example.com", observed("alpha.example.com"), cats)
	if recommended != "" {
		t.Fatal("keyword inferred identity")
	}
}
