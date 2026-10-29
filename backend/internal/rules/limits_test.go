package rules

import (
	"context"
	"fmt"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
	"path/filepath"
	"strings"
	"testing"
)

func TestDLCBoundsAndCancellation(t *testing.T) {
	var raw strings.Builder
	for i := 0; i <= MaxCategoryRules; i++ {
		fmt.Fprintf(&raw, "a%d.test\n", i)
	}
	p, err := NewDLCParser(map[string][]byte{"direct": []byte(raw.String())}, "test", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = p.Parse("direct"); err == nil {
		t.Fatal("direct rule limit bypassed")
	}
	p.files["direct"].entries = p.files["direct"].entries[:MaxCategoryRules]
	if entries, _, err := p.Parse("direct"); err != nil || len(entries) != MaxCategoryRules {
		t.Fatal("exact rule limit rejected", len(entries), err)
	}
	files := map[string][]byte{"node0": []byte("# empty leaf\n")}
	for i := 1; i <= MaxIncludeDepth; i++ {
		files[fmt.Sprintf("node%d", i)] = []byte(strings.Repeat(fmt.Sprintf("include:node%d\n", i-1), 2))
	}
	p, err = NewDLCParser(files, "test", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = p.Parse(fmt.Sprintf("node%d", MaxIncludeDepth)); err != nil {
		t.Fatal("bounded repeated includes", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err = p.ParseContext(ctx, "node0"); err != context.Canceled {
		t.Fatal("cancellation ignored", err)
	}
	state := &parseState{ctx: context.Background(), work: MaxParseWork}
	if state.consume(1) == nil {
		t.Fatal("work budget ignored")
	}
	// A shallow memo must not let a shared subtree bypass depth on a longer path.
	files["root"] = []byte("include:node1\ninclude:node24\n")
	p, err = NewDLCParser(files, "test", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = p.Parse("root"); err == nil {
		t.Fatal("memo bypassed include depth")
	}
}
func TestClearPreservesSourcePreferencesAcrossRestart(t *testing.T) {
	s, err := storage.Open(filepath.Join(t.TempDir(), "rules.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	m, err := NewManager(s)
	if err != nil {
		t.Fatal(err)
	}
	if err = m.SetAutoUpdate("v2fly", true); err != nil {
		t.Fatal(err)
	}
	if err = m.Clear(); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewManager(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, src := range reloaded.Sources() {
		if src.AutoUpdate != (src.ID == "v2fly") {
			t.Fatalf("preference lost: %+v", src)
		}
	}
}
