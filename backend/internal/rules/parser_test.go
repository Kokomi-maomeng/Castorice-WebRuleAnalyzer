package rules

import (
	"strings"
	"testing"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

func TestClashTypesAndUnsupported(t *testing.T) {
	content := []byte("payload:\n  - DOMAIN,EXAMPLE.com.\n  - DOMAIN,example.com\n  - DOMAIN-SUFFIX,example.org\n  - DOMAIN-KEYWORD,service\n  - IP-CIDR,1.1.1.0/24\n  - DOMAIN,1.1.1.1\n  - AND,((DOMAIN,example.net))\n")
	entries, warnings, err := ParseClash(content, model.RuleOrigin{Source: "test", Category: "app", Version: "abc", File: "app.yaml"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || len(warnings) != 3 {
		t.Fatalf("entries=%d warnings=%v", len(entries), warnings)
	}
	seen := map[model.RuleType]bool{}
	for _, r := range entries {
		seen[r.Type] = true
		if r.Origins[0].Version != "abc" {
			t.Fatal("lost provenance")
		}
	}
	for _, typ := range []model.RuleType{model.Domain, model.Suffix, model.Keyword} {
		if !seen[typ] {
			t.Fatal("lost type", typ)
		}
	}
	if _, _, err = ParseClash([]byte("<html>error</html>"), model.RuleOrigin{File: "app.yaml"}); err == nil {
		t.Fatal("invalid document accepted")
	}
}
func TestDLCIncludesFiltersAffiliations(t *testing.T) {
	files := map[string][]byte{"app": []byte("include:shared @special @-ads\nfull:entry.example.com\nkeyword:appname\nregexp:^unsafe.*\n"), "shared": []byte("domain:example.org @special\nfull:ads.example.org @special @ads\nfull:other.example.net\nfull:affiliate.example.com &virtual\n")}
	parser, err := NewDLCParser(files, "test", "123")
	if err != nil {
		t.Fatal(err)
	}
	entries, warnings, err := parser.Parse("app")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || len(warnings) != 1 {
		t.Fatalf("got %v / %v", entries, warnings)
	}
	values := map[string]bool{}
	for _, entry := range entries {
		values[entry.Key()] = true
	}
	for _, key := range []string{"DOMAIN,entry.example.com", "DOMAIN-SUFFIX,example.org", "DOMAIN-KEYWORD,appname"} {
		if !values[key] {
			t.Fatal("missing", key)
		}
	}
	virtual, _, err := parser.Parse("virtual")
	if err != nil || len(virtual) != 1 || virtual[0].Value != "affiliate.example.com" {
		t.Fatal("affiliation not respected", virtual, err)
	}
}
func TestDLCRecursionLimitsAndMissing(t *testing.T) {
	for _, files := range []map[string][]byte{{"a": []byte("include:b"), "b": []byte("include:a")}, {"a": []byte("include:missing")}} {
		parser, _ := NewDLCParser(files, "test", "1")
		if _, _, err := parser.Parse("a"); err == nil {
			t.Fatal("cycle or missing include accepted")
		}
	}
	files := map[string][]byte{}
	for n := 0; n < MaxIncludeDepth+2; n++ {
		name := strings.Repeat("a", n+1)
		files[name] = []byte("include:" + name + "a")
	}
	parser, _ := NewDLCParser(files, "test", "1")
	if _, _, err := parser.Parse("a"); err == nil {
		t.Fatal("depth bound not enforced")
	}
}
func TestSuffixBoundary(t *testing.T) {
	r := model.RuleEntry{Type: model.Suffix, Value: "example.com"}
	if !Matches(r, "example.com") || !Matches(r, "a.example.com") || Matches(r, "notexample.com") {
		t.Fatal("suffix domain boundary")
	}
}

func TestIncludeFilterRetainsAttributeVariants(t *testing.T) {
	p, err := NewDLCParser(map[string][]byte{"parent": []byte("include:child @-ads"), "child": []byte("full:example.com @ads\nfull:example.com\n")}, "test", "1")
	if err != nil {
		t.Fatal(err)
	}
	entries, _, err := p.Parse("parent")
	if err != nil || len(entries) != 1 {
		t.Fatalf("attribute variants collapsed before filtering: %+v %v", entries, err)
	}
}

func TestIncludeDedupPreservesEveryOrigin(t *testing.T) {
	p, err := NewDLCParser(map[string][]byte{
		"parent": []byte("include:first\ninclude:second\n"),
		"first":  []byte("full:example.com @service\n"),
		"second": []byte("full:example.com @service\n"),
	}, "test", "1")
	if err != nil {
		t.Fatal(err)
	}
	entries, _, err := p.Parse("parent")
	if err != nil || len(entries) != 1 {
		t.Fatalf("dedup failed: %+v %v", entries, err)
	}
	origins := map[string]bool{}
	for _, origin := range entries[0].Origins {
		origins[origin.File] = true
	}
	if !origins["data/first"] || !origins["data/second"] {
		t.Fatalf("lost include provenance: %+v", entries[0].Origins)
	}
}
