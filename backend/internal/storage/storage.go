package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	_ "modernc.org/sqlite"
)

type Store struct{ DB *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{DB: db}
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,started TEXT NOT NULL,status TEXT NOT NULL,payload BLOB NOT NULL);
 CREATE INDEX IF NOT EXISTS scans_started ON scans(started DESC);
 CREATE TABLE IF NOT EXISTS requests(task_id TEXT NOT NULL,id TEXT NOT NULL,time TEXT NOT NULL,host TEXT NOT NULL,method TEXT NOT NULL,type TEXT NOT NULL,status INTEGER NOT NULL,state TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(task_id,id),FOREIGN KEY(task_id) REFERENCES scans(id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS requests_host ON requests(task_id,host,time DESC);
 CREATE INDEX IF NOT EXISTS requests_time ON requests(task_id,time DESC);
 CREATE TABLE IF NOT EXISTS domains(task_id TEXT NOT NULL,host TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(task_id,host),FOREIGN KEY(task_id) REFERENCES scans(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS events(task_id TEXT NOT NULL,id INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(task_id,id),FOREIGN KEY(task_id) REFERENCES scans(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,payload BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS rule_sources(id TEXT PRIMARY KEY,payload BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS rule_categories(id TEXT PRIMARY KEY,source TEXT NOT NULL,payload BLOB NOT NULL);
 CREATE INDEX IF NOT EXISTS categories_source ON rule_categories(source);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	// A browser cannot survive a crashed server as an active task in history.
	tasks, err := s.ListScans(500)
	if err != nil {
		db.Close()
		return nil, err
	}
	for _, task := range tasks {
		if task.Active() {
			now := time.Now().UTC()
			task.Status = "failed"
			task.EndReason = "service_interrupted"
			task.Error = "上次服务退出，任务已中断"
			task.EndedAt = &now
			if err = s.Save(task, nil, nil, nil); err != nil {
				db.Close()
				return nil, err
			}
		}
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }
func data(v any) []byte       { b, _ := json.Marshal(v); return b }

// Save batches changed requests/domains and events in one transaction. Each
// browser event only changes in-memory records; it never waits for SQLite I/O.
func (s *Store) Save(task model.ScanTask, requests []model.NetworkRequest, domains []model.DomainRecord, events []model.Event) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO scans VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload`, task.ID, task.StartedAt.Format(time.RFC3339Nano), task.Status, data(task)); err != nil {
		return err
	}
	reqStmt, err := tx.PrepareContext(ctx, `INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,id) DO UPDATE SET status=excluded.status,state=excluded.state,payload=excluded.payload`)
	if err != nil {
		return err
	}
	defer reqStmt.Close()
	for _, r := range requests {
		if _, err = reqStmt.ExecContext(ctx, r.TaskID, r.ID, r.Time.Format(time.RFC3339Nano), r.Hostname, r.Method, r.ResourceType, r.StatusCode, r.State, data(r)); err != nil {
			return err
		}
	}
	domStmt, err := tx.PrepareContext(ctx, `INSERT INTO domains VALUES(?,?,?) ON CONFLICT(task_id,host) DO UPDATE SET payload=excluded.payload`)
	if err != nil {
		return err
	}
	defer domStmt.Close()
	for _, d := range domains {
		if _, err = domStmt.ExecContext(ctx, task.ID, d.Hostname, data(d)); err != nil {
			return err
		}
	}
	evStmt, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO events VALUES(?,?,?)`)
	if err != nil {
		return err
	}
	defer evStmt.Close()
	for _, e := range events {
		if _, err = evStmt.ExecContext(ctx, task.ID, e.ID, data(e)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) Task(id string) (model.ScanTask, error) {
	var t model.ScanTask
	var b []byte
	err := s.DB.QueryRow(`SELECT payload FROM scans WHERE id=?`, id).Scan(&b)
	if err == nil {
		err = json.Unmarshal(b, &t)
	}
	return t, err
}
func (s *Store) ListScans(limit int) ([]model.ScanTask, error) {
	rows, err := s.DB.Query(`SELECT payload FROM scans ORDER BY started DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.ScanTask{}
	for rows.Next() {
		var b []byte
		var t model.ScanTask
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) Domains(id string) ([]model.DomainRecord, error) {
	return queryJSON[model.DomainRecord](s.DB, `SELECT payload FROM domains WHERE task_id=? ORDER BY host`, id)
}
func (s *Store) Events(id string, after int64) ([]model.Event, error) {
	if after <= 0 {
		return queryJSON[model.Event](s.DB, `SELECT payload FROM (SELECT id,payload FROM events WHERE task_id=? ORDER BY id DESC LIMIT 2000) ORDER BY id`, id)
	}
	return queryJSON[model.Event](s.DB, `SELECT payload FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 2000`, id, after)
}

type RequestFilter struct {
	Host, Method, Type, Status string
	Limit, Offset              int
}

func (s *Store) Requests(id string, f RequestFilter) ([]model.NetworkRequest, int, error) {
	where := ` WHERE task_id=?`
	args := []any{id}
	if f.Host != "" {
		where += ` AND instr(host,?)>0`
		args = append(args, strings.ToLower(f.Host))
	}
	if f.Method != "" {
		where += ` AND method=?`
		args = append(args, f.Method)
	}
	if f.Type != "" {
		where += ` AND type=?`
		args = append(args, f.Type)
	}
	if f.Status == "failed" {
		where += ` AND state='failed'`
	} else if f.Status != "" {
		where += ` AND CAST(status AS TEXT) LIKE ?`
		args = append(args, f.Status+"%")
	}
	var total int
	if err := s.DB.QueryRow(`SELECT count(*) FROM requests`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if f.Limit < 1 || f.Limit > 200 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	args = append(args, f.Limit, f.Offset)
	out, err := queryJSON[model.NetworkRequest](s.DB, `SELECT payload FROM requests`+where+` ORDER BY time DESC,id DESC LIMIT ? OFFSET ?`, args...)
	return out, total, err
}

func queryJSON[T any](db *sql.DB, query string, args ...any) ([]T, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var b []byte
		var item T
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &item); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) Settings() (model.Settings, error) {
	result := model.DefaultSettings()
	var b []byte
	err := s.DB.QueryRow(`SELECT payload FROM kv WHERE key='settings'`).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err == nil {
		err = json.Unmarshal(b, &result)
	}
	return result, err
}
func (s *Store) SaveSettings(settings model.Settings) error {
	_, err := s.DB.Exec(`INSERT INTO kv VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload`, data(settings))
	return err
}
func (s *Store) RuleSources() ([]model.RuleSource, error) {
	return queryJSON[model.RuleSource](s.DB, `SELECT payload FROM rule_sources ORDER BY id`)
}
func (s *Store) Categories() ([]model.RuleCategory, error) {
	return queryJSON[model.RuleCategory](s.DB, `SELECT payload FROM rule_categories ORDER BY id`)
}
func (s *Store) SaveSource(source model.RuleSource, categories []model.RuleCategory, replace bool) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if replace {
		if _, err = tx.Exec(`DELETE FROM rule_categories WHERE source=?`, source.ID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO rule_sources VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`, source.ID, data(source)); err != nil {
		return err
	}
	statement, err := tx.Prepare(`INSERT INTO rule_categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`)
	if err != nil {
		return err
	}
	defer statement.Close()
	for _, c := range categories {
		if _, err = statement.Exec(c.ID, c.Source, data(c)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) ClearRules() error {
	_, err := s.DB.Exec(`DELETE FROM rule_categories; DELETE FROM rule_sources;`)
	return err
}
