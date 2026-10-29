package exportname

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPortableFilenameContract(t *testing.T) {
	for _, raw := range []string{strings.Repeat("中", 60), strings.Repeat("界a", 200), "CON", "NUL.backup", "../a\x00/b"} {
		name := Filename(raw, ".yaml")
		if !Valid(name) || !Valid(name+".sources.txt") || !utf8.ValidString(name) {
			t.Fatalf("invalid generated name: %q", name)
		}
	}
	for _, name := range []string{"CON.yaml", "nul.any.json", "../x.txt", "x\x00.txt", "x.yaml.", " x.yaml"} {
		if Valid(name) {
			t.Fatalf("unsafe name accepted: %q", name)
		}
	}
}
