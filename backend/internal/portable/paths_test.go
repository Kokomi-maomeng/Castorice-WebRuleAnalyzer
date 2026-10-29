package portable

import (
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/exportname"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGeneratedUnicodeExportAndAttributionSave(t *testing.T) {
	p, err := Open(filepath.Join(t.TempDir(), "软件.exe"))
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{strings.Repeat("中", 60), strings.Repeat("界", 200)} {
		name := exportname.Filename(raw, ".yaml")
		for _, n := range []string{name, name, name + ".sources.txt", name + ".sources.txt"} {
			if _, err = p.SaveExport(n, "test"); err != nil {
				t.Fatalf("generated name rejected (%d bytes): %v", len(n), err)
			}
		}
	}
}

func TestPortableExportsAndTemp(t *testing.T) {
	root := t.TempDir()
	p, err := Open(filepath.Join(root, "中文软件.exe"))
	if err != nil {
		t.Fatal(err)
	}
	a, err := p.SaveExport("规则.yaml", "rules: []\n")
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.SaveExport("规则.yaml", "payload: []\n")
	if err != nil || a == b {
		t.Fatal("export overwritten", err)
	}
	for _, name := range []string{"../escape.yaml", "C:\\escape.yaml", "x.exe", "x.yaml.", "x/evil.json", "../data/log.txt"} {
		if _, e := p.SaveExport(name, "x"); e == nil {
			t.Fatal("unsafe filename accepted", name)
		}
	}
	if err = os.WriteFile(filepath.Join(p.Temp, "owned.tmp"), []byte("temp"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = p.ClearTemp(); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(p.Temp); len(entries) != 0 {
		t.Fatal("temporary data remains")
	}
	if _, err = os.Stat(a); err != nil {
		t.Fatal("export removed", err)
	}
}
