package scanner

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProfileCleanupHandlesLateChildWrites(t *testing.T) {
	profile := filepath.Join(t.TempDir(), "scan-owned")
	if err := os.Mkdir(profile, 0700); err != nil {
		t.Fatal(err)
	}
	prepared := filepath.Join(filepath.Dir(profile), "late-writer")
	if err := os.Mkdir(prepared, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(prepared, "late-write"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		for {
			if _, err := os.Stat(profile); os.IsNotExist(err) {
				break
			}
			time.Sleep(time.Millisecond)
		}
		time.Sleep(50 * time.Millisecond)
		done <- os.Rename(prepared, profile)
	}()
	if err := removeProfile(profile); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(profile); !os.IsNotExist(err) {
		t.Fatal("profile was recreated after cleanup", err)
	}
}
