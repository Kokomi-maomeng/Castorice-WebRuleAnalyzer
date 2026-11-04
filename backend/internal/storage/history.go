package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

type HistoryPage struct {
	Items         []model.ScanTask `json:"items"`
	Total         int              `json:"total"`
	FinishedCount int              `json:"finished_count"`
}
type HistoryDeletion struct {
	Deleted int      `json:"deleted"`
	IDs     []string `json:"ids"`
}

var ErrActiveHistory = errors.New("正在运行或保存结果的任务不能删除，请先停止并等待完成")

func (s *Store) History(q string, limit, offset int) (HistoryPage, error) {
	if limit < 1 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return HistoryPage{}, err
	}
	defer tx.Rollback()
	result := HistoryPage{Items: []model.ScanTask{}}
	search := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(strings.TrimSpace(q)) + "%"
	where := ` WHERE json_extract(payload,'$.target_url') LIKE ? ESCAPE '\'`
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM scans`+where, search).Scan(&result.Total); err != nil {
		return result, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM scans WHERE status NOT IN ('starting','running','stopping')`).Scan(&result.FinishedCount); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT payload FROM scans`+where+` ORDER BY started DESC LIMIT ? OFFSET ?`, search, limit, offset)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var raw []byte
		var task model.ScanTask
		if err = rows.Scan(&raw); err == nil {
			err = json.Unmarshal(raw, &task)
		}
		if err != nil {
			rows.Close()
			return result, err
		}
		result.Items = append(result.Items, task)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func (s *Store) DeleteHistory(ids []string, allFinished bool, activeID string) (HistoryDeletion, error) {
	result := HistoryDeletion{IDs: []string{}}
	if allFinished && len(ids) > 0 || !allFinished && (len(ids) == 0 || len(ids) > 500) {
		return result, errors.New("请选择待删除任务，或单独选择清空全部已结束历史")
	}
	args := []any{}
	where := ""
	if allFinished {
		where = `status NOT IN ('starting','running','stopping') AND id<>?`
		args = append(args, activeID)
	} else {
		marks := make([]string, len(ids))
		for i, id := range ids {
			marks[i] = "?"
			args = append(args, id)
		}
		where = "id IN (" + strings.Join(marks, ",") + ")"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,status FROM scans WHERE `+where, args...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var id, status string
		if err = rows.Scan(&id, &status); err != nil {
			break
		}
		if id == activeID || status == "starting" || status == "running" || status == "stopping" {
			err = ErrActiveHistory
			break
		}
		result.IDs = append(result.IDs, id)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return HistoryDeletion{}, err
	}
	// Foreign keys remove requests, domains and events in the same transaction.
	if _, err = tx.ExecContext(ctx, `DELETE FROM scans WHERE `+where, args...); err != nil {
		return result, err
	}
	if err = tx.Commit(); err != nil {
		return result, err
	}
	result.Deleted = len(result.IDs)
	return result, nil
}
