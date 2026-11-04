package storage

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

func TestDeleteHistoryBeyondVisiblePageAndCascade(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	settings := model.DefaultSettings()
	settings.Policy = "saved"
	if err = s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	for i := range 105 {
		task := model.ScanTask{ID: fmt.Sprint(i), Status: "completed", TargetURL: fmt.Sprintf("https://site%d.example/", i), StartedAt: time.Now().Add(time.Duration(i) * time.Second)}
		if err = s.Save(task, []model.NetworkRequest{{ID: "request", TaskID: task.ID, Hostname: "site.example"}}, []model.DomainRecord{{Hostname: "site.example"}}, []model.Event{{ID: 1, TaskID: task.ID}}); err != nil {
			t.Fatal(err)
		}
	}
	if err = s.Save(model.ScanTask{ID: "active", Status: "running", TargetURL: "https://active.example/", StartedAt: time.Now()}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	page, err := s.History("", 30, 90)
	if err != nil || page.Total != 106 || page.FinishedCount != 105 || len(page.Items) != 16 {
		t.Fatal(page, err)
	}
	if _, err = s.DeleteHistory([]string{"0", "active"}, false, "active"); !errors.Is(err, ErrActiveHistory) {
		t.Fatal("active deletion accepted", err)
	}
	if _, err = s.Task("0"); err != nil {
		t.Fatal("partial deletion occurred", err)
	}
	deleted, err := s.DeleteHistory(nil, true, "active")
	if err != nil || deleted.Deleted != 105 {
		t.Fatal(deleted, err)
	}
	for _, table := range []string{"requests", "domains", "events"} {
		var count int
		if err = s.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("orphaned data", table, count, err)
		}
	}
	if _, err = s.Task("active"); err != nil {
		t.Fatal("active task deleted", err)
	}
	loaded, err := s.Settings()
	if err != nil || loaded.Policy != "saved" {
		t.Fatal("settings lost", loaded, err)
	}
}
