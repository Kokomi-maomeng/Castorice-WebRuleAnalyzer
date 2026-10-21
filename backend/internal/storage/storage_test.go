package storage

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

func TestBatchHistoryFilteringAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	task := model.ScanTask{ID: "scan1", TargetURL: "https://example.com", StartedAt: time.Now().UTC(), Status: "running", Options: model.DefaultOptions()}
	requests := []model.NetworkRequest{{TaskID: task.ID, ID: "r1", Time: time.Now().UTC(), Hostname: "example.com", Method: "GET", ResourceType: "Document", StatusCode: 200, State: "finished"}, {TaskID: task.ID, ID: "r2", Time: time.Now().UTC(), Hostname: "api.example.com", Method: "POST", ResourceType: "Fetch", State: "failed"}}
	domains := []model.DomainRecord{{Hostname: "example.com", Kind: "domain", RequestCount: 1, RequestIDs: []string{"r1"}}, {Hostname: "api.example.com", Kind: "domain", RequestCount: 1, RequestIDs: []string{"r2"}}}
	events := []model.Event{{TaskID: task.ID, ID: 1, Message: "actual event"}}
	if err = store.Save(task, requests, domains, events); err != nil {
		t.Fatal(err)
	}
	requests[1].StatusCode = 503
	if err = store.Save(task, requests[1:], nil, events); err != nil {
		t.Fatal(err)
	}
	got, total, err := store.Requests(task.ID, RequestFilter{Method: "POST", Host: "api.", Status: "5", Limit: 1})
	if err != nil || total != 1 || len(got) != 1 || got[0].StatusCode != 503 {
		t.Fatal(got, total, err)
	}
	got, total, err = store.Requests(task.ID, RequestFilter{Offset: 1, Limit: 1})
	if err != nil || total != 2 || len(got) != 1 {
		t.Fatal("pagination", got, total, err)
	}
	logs, err := store.Events(task.ID, 0)
	if err != nil || len(logs) != 1 {
		t.Fatal("idempotent event batch", logs, err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	saved, err := store.Task(task.ID)
	if err != nil || saved.Status != "failed" || saved.EndReason != "service_interrupted" {
		t.Fatal("interrupted history not recovered", saved, err)
	}
	settings := model.DefaultSettings()
	settings.Theme = "dark"
	settings.Policy = "测试策略"
	if err = store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Settings()
	if err != nil || loaded.Policy != settings.Policy || loaded.Theme != "dark" {
		t.Fatal("settings persistence", loaded, err)
	}
}
