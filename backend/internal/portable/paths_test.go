package portable

import (
	"os"
	"path/filepath"
	"testing"
)

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
