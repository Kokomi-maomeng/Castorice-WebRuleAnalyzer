package scanner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClearSessionsRequiresOwnership(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"scan-owned", "scan-other", "other"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "scan-owned", sessionMarker), []byte(sessionOwner), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "other", sessionMarker), []byte(sessionOwner), 0600); err != nil {
		t.Fatal(err)
	}
	m := &Manager{engine: Engine{SessionDir: root}}
	if err := m.ClearSessions(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "scan-owned")); !os.IsNotExist(err) {
		t.Fatalf("owned session remains: %v", err)
	}
	for _, name := range []string{"scan-other", "other"} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatalf("unrelated directory removed: %s: %v", name, err)
		}
	}
}
