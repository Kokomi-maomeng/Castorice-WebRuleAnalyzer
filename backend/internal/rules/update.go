package rules

import (
	"context"
	"errors"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

// SetAutoUpdate persists the preference before waking the service-owned worker.
func (m *Manager) SetAutoUpdate(id string, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	source, ok := m.sources[id]
	if !ok {
		return errors.New("未知规则源")
	}
	source.AutoUpdate = enabled
	if enabled {
		source.CheckedAt = nil
	}
	if err := m.store.SaveSource(source, nil, false); err != nil {
		return err
	}
	m.sources[id] = source
	select {
	case m.wake <- struct{}{}:
	default:
	}
	return nil
}

// Run is tied to the application's lifetime, never a detached scheduled task.
// Enabling initializes immediately; thereafter checks run daily, retrying errors
// at most hourly. Each failed atomic update preserves the previous snapshot.
func (m *Manager) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		for _, source := range m.Sources() {
			if ctx.Err() != nil {
				return
			}
			if !source.AutoUpdate {
				continue
			}
			if source.CheckedAt != nil && (source.Error != "" && time.Since(*source.CheckedAt) < time.Hour || source.Version != "" && source.LoadedCount == source.CategoryCount && source.Error == "" && time.Since(*source.CheckedAt) < 24*time.Hour) {
				continue
			}
			attempt, cancel := context.WithTimeout(ctx, 10*time.Minute)
			_ = m.Sync(attempt, source.ID)
			cancel()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-m.wake:
		}
	}
}

func (m *Manager) Check(ctx context.Context, id string) (model.RuleSource, error) {
	if !m.operation.TryLock() {
		return model.RuleSource{}, errors.New("规则库正在更新或加载")
	}
	defer m.operation.Unlock()
	m.mu.RLock()
	source, ok := m.sources[id]
	m.mu.RUnlock()
	if !ok {
		return source, errors.New("未知规则源")
	}
	repo := "v2fly/domain-list-community"
	if id == "blackmatrix7" {
		repo = "blackmatrix7/ios_rule_script"
	}
	version, err := m.commit(ctx, repo)
	now := time.Now().UTC()
	source.CheckedAt = &now
	if err != nil {
		source.Error = err.Error()
	} else {
		source.RemoteVersion = version
		source.Error = ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	source.AutoUpdate = m.sources[id].AutoUpdate
	if e := m.store.SaveSource(source, nil, false); e != nil {
		return source, e
	}
	m.sources[id] = source
	return source, err
}
