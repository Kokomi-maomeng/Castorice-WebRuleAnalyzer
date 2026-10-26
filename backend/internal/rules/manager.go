package rules

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/storage"
)

type Manager struct {
	mu         sync.RWMutex
	operation  sync.Mutex
	store      *storage.Store
	client     *http.Client
	sources    map[string]model.RuleSource
	categories map[string]model.RuleCategory
	wake       chan struct{}
}

func defaults() []model.RuleSource {
	return []model.RuleSource{
		{ID: "blackmatrix7", Name: "blackmatrix7 / ios_rule_script", Repository: "https://github.com/blackmatrix7/ios_rule_script", License: "GPL-2.0（另见上游声明）", Status: "not_initialized"},
		{ID: "v2fly", Name: "v2fly / domain-list-community", Repository: "https://github.com/v2fly/domain-list-community", License: "MIT", Status: "not_initialized"},
	}
}

type Option func(*Manager)

func WithHTTPClient(client *http.Client) Option {
	return func(m *Manager) {
		if client != nil {
			m.client = client
		}
	}
}

func NewManager(store *storage.Store, options ...Option) (*Manager, error) {
	m := &Manager{store: store, client: &http.Client{Timeout: 90 * time.Second}, sources: map[string]model.RuleSource{}, categories: map[string]model.RuleCategory{}, wake: make(chan struct{}, 1)}
	for _, option := range options {
		option(m)
	}
	for _, s := range defaults() {
		m.sources[s.ID] = s
	}
	saved, err := store.RuleSources()
	if err != nil {
		return nil, err
	}
	for _, s := range saved {
		if s.Status == "syncing" {
			if s.Version == "" {
				s.Status = "not_initialized"
			} else {
				s.Status = "cached"
			}
			s.Error = "上次更新中断，保留已有缓存"
			s.CheckedAt = nil
		}
		m.sources[s.ID] = s
	}
	categories, err := store.Categories()
	if err != nil {
		return nil, err
	}
	for _, c := range categories {
		c.Broad = Broad(c.Name, c.RuleCount)
		valid := true
		for _, r := range c.Rules {
			if _, err := Normalize(r); err != nil {
				valid = false
				break
			}
		}
		if valid {
			m.categories[c.ID] = c
		} else {
			s := m.sources[c.Source]
			s.Status = "cache_invalid"
			s.Error = "分类缓存损坏，请重新同步"
			m.sources[s.ID] = s
		}
	}
	return m, nil
}

func (m *Manager) Sources() []model.RuleSource {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []model.RuleSource{}
	for _, s := range m.sources {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
func (m *Manager) Categories(loadedOnly bool) []model.RuleCategory {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []model.RuleCategory{}
	for _, c := range m.categories {
		if !loadedOnly || c.Loaded {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}
func (m *Manager) Category(id string) (model.RuleCategory, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c, ok := m.categories[id]
	return c, ok
}

func (m *Manager) fetch(ctx context.Context, address string, maxBytes int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Castorice-WebRuleAnalyzer/"+model.Version)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, errors.New("规则源网络连接失败，请检查网络后重试")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("上游 HTTP %d（GitHub 匿名 API 可能限流）", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > maxBytes {
		return nil, errors.New("上游文件超过大小限制")
	}
	return b, nil
}

type treeEntry struct {
	Path string `json:"path"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
}
type treeResponse struct {
	SHA       string      `json:"sha"`
	Truncated bool        `json:"truncated"`
	Tree      []treeEntry `json:"tree"`
}

func (m *Manager) tree(ctx context.Context, repo, ref string, recursive bool) (treeResponse, error) {
	var t treeResponse
	address := "https://api.github.com/repos/" + repo + "/git/trees/" + url.PathEscape(ref)
	if recursive {
		address += "?recursive=1"
	}
	b, err := m.fetch(ctx, address, 12<<20)
	if err == nil {
		err = json.Unmarshal(b, &t)
	}
	if err == nil && (t.Truncated || len(t.Tree) == 0) {
		err = errors.New("上游目录索引为空或被截断，请稍后重试")
	}
	return t, err
}

func (m *Manager) commit(ctx context.Context, repo string) (string, error) {
	b, err := m.fetch(ctx, "https://api.github.com/repos/"+repo+"/commits?per_page=1", 1<<20)
	if err != nil {
		return "", err
	}
	var list []struct {
		SHA string `json:"sha"`
	}
	if err = json.Unmarshal(b, &list); err != nil || len(list) == 0 {
		return "", errors.New("无法读取上游 Commit")
	}
	return list[0].SHA, nil
}

func Broad(name string, count int) bool {
	n := strings.ToLower(name)
	for _, term := range []string{"category-", "geolocation-", "google", "alphabet", "microsoft", "apple", "amazon", "cloudflare", "cdn", "ads", "advertising", "global", "proxy", "proxylite", "crypto", "cryptocurrency", "direct", "reject", "china", "cn", "private", "tld-", "gfw", "gfwlist", "download"} {
		if n == term || strings.HasPrefix(n, term) && strings.HasSuffix(term, "-") {
			return true
		}
	}
	return false
}

func (m *Manager) Sync(ctx context.Context, id string) error {
	if !m.operation.TryLock() {
		return errors.New("规则库正在更新或加载，请稍后重试")
	}
	defer m.operation.Unlock()
	m.mu.Lock()
	source, ok := m.sources[id]
	if ok {
		source.Status = "syncing"
		source.Error = ""
		now := time.Now().UTC()
		source.CheckedAt = &now
		m.sources[id] = source
	}
	m.mu.Unlock()
	if !ok {
		return errors.New("未知规则源")
	}
	var categories []model.RuleCategory
	var version string
	var err error
	if id == "blackmatrix7" {
		categories, version, err = m.syncBlackmatrix(ctx)
	} else {
		categories, version, err = m.syncV2fly(ctx)
	}
	if err == nil {
		repo := "v2fly/domain-list-community"
		if id == "blackmatrix7" {
			repo = "blackmatrix7/ios_rule_script"
		}
		var license []byte
		license, err = m.fetch(ctx, "https://raw.githubusercontent.com/"+repo+"/"+version+"/LICENSE", 128<<10)
		validLicense := id == "blackmatrix7" && strings.Contains(string(license), "GNU GENERAL PUBLIC LICENSE") && strings.Contains(string(license), "Version 2") || id == "v2fly" && strings.Contains(string(license), "MIT License") && strings.Contains(string(license), "Permission is hereby granted")
		if err == nil && !validLicense {
			err = errors.New("上游许可证类型发生变化或内容无效，请核对后更新适配器")
		}
		if err == nil {
			source.LicenseText = string(license)
			source.LicenseURL = "https://github.com/" + repo + "/blob/" + version + "/LICENSE"
		}
	}
	if err != nil {
		m.mu.Lock()
		source = m.sources[id]
		source.Error = err.Error()
		source.Status = "error"
		if source.Version != "" {
			source.Status = "cached"
		}
		m.sources[id] = source
		_ = m.store.SaveSource(source, nil, false)
		m.mu.Unlock()
		return err
	}
	now := time.Now().UTC()
	source.Version = version
	source.RemoteVersion = version
	source.UpdatedAt = &now
	source.Status = "ready"
	source.CategoryCount = len(categories)
	source.LoadedCount = 0
	source.Error = ""
	for _, c := range categories {
		if c.Loaded {
			source.LoadedCount++
		}
	}
	m.mu.Lock()
	source.AutoUpdate = m.sources[id].AutoUpdate
	if err = m.store.SaveSource(source, categories, true); err != nil {
		m.mu.Unlock()
		return m.fail(source, err)
	}
	for key, c := range m.categories {
		if c.Source == id {
			delete(m.categories, key)
		}
	}
	for _, c := range categories {
		m.categories[c.ID] = c
	}
	m.sources[id] = source
	m.mu.Unlock()
	return nil
}
func (m *Manager) fail(s model.RuleSource, err error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := m.sources[s.ID]
	old.Status = "error"
	old.Error = "规则缓存写入失败: " + err.Error()
	m.sources[s.ID] = old
	return err
}

func (m *Manager) syncBlackmatrix(ctx context.Context) ([]model.RuleCategory, string, error) {
	repo := "blackmatrix7/ios_rule_script"
	version, err := m.commit(ctx, repo)
	if err != nil {
		return nil, "", err
	}
	tree, err := m.tree(ctx, repo, version, false)
	if err != nil {
		return nil, "", err
	}
	// Discover the current subtree instead of treating a recursive whole-repo
	// response (which may be truncated) as a complete rules index.
	for _, segment := range []string{"rule", "Clash"} {
		sha := ""
		for _, entry := range tree.Tree {
			if entry.Path == segment && entry.Type == "tree" {
				sha = entry.SHA
				break
			}
		}
		if sha == "" {
			return nil, "", fmt.Errorf("上游目录结构改变：未找到 %s，未替换已有缓存", segment)
		}
		tree, err = m.tree(ctx, repo, sha, segment == "Clash")
		if err != nil {
			return nil, "", err
		}
	}
	out := []model.RuleCategory{}
	seen := map[string]bool{}
	for _, entry := range tree.Tree {
		name := strings.TrimSuffix(path.Base(entry.Path), ".yaml")
		if entry.Type != "blob" || !strings.HasSuffix(entry.Path, ".yaml") || path.Base(path.Dir(entry.Path)) != name || seen[name] {
			continue
		}
		seen[name] = true
		c := model.RuleCategory{ID: "blackmatrix7:" + name, Source: "blackmatrix7", Name: name, Path: "rule/Clash/" + entry.Path, Version: version, ContentHash: entry.SHA, Broad: Broad(name, 0), Warnings: []string{}}
		out = append(out, c)
	}
	if len(out) == 0 {
		return nil, "", errors.New("没有发现可用的 classical YAML 分类")
	}
	// Cache every indexed YAML, with bounded concurrency. Unchanged blobs are
	// reused, while all provenance is advanced to this atomic source snapshot.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan int)
	var wg sync.WaitGroup
	var resultMu sync.Mutex
	var firstError error
	var totalBytes int
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				c := out[i]
				old, exists := m.Category(c.ID)
				var loaded model.RuleCategory
				var e error
				if exists && old.Raw != "" && old.ContentHash == c.ContentHash {
					loaded = old
					loaded.Broad = Broad(loaded.Name, loaded.RuleCount)
					loaded.Version = version
					loaded.Rules = append([]model.RuleEntry(nil), old.Rules...)
					for ri := range loaded.Rules {
						loaded.Rules[ri].Origins = append([]model.RuleOrigin(nil), old.Rules[ri].Origins...)
						for oi := range loaded.Rules[ri].Origins {
							loaded.Rules[ri].Origins[oi].Version = version
						}
					}
				} else {
					loaded, e = m.downloadBlackmatrix(ctx, c)
				}
				resultMu.Lock()
				totalBytes += len(loaded.Raw)
				if totalBytes > 96<<20 && e == nil {
					e = errors.New("规则快照超过 96 MiB 限制")
				}
				if e != nil && firstError == nil {
					firstError = fmt.Errorf("下载分类 %s: %w", c.Name, e)
					cancel()
				}
				resultMu.Unlock()
				if e == nil {
					out[i] = loaded
				}
			}
		}()
	}
	for i := range out {
		if ctx.Err() != nil {
			break
		}
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	if firstError != nil {
		return nil, "", firstError
	}
	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}
	return out, version, nil
}

func (m *Manager) downloadBlackmatrix(ctx context.Context, c model.RuleCategory) (model.RuleCategory, error) {
	b, err := m.fetch(ctx, "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/"+c.Version+"/"+c.Path, MaxFileBytes)
	if err != nil {
		return c, err
	}
	entries, warnings, err := ParseClash(b, model.RuleOrigin{Source: c.Source, Category: c.Name, Version: c.Version, File: c.Path, License: "GPL-2.0"})
	if err != nil {
		return c, err
	}
	c.Loaded = true
	c.Raw = string(b)
	c.Format = "yaml"
	c.Rules = entries
	c.RuleCount = len(entries)
	c.Warnings = warnings
	c.Broad = Broad(c.Name, c.RuleCount)
	return c, nil
}

func (m *Manager) syncV2fly(ctx context.Context) ([]model.RuleCategory, string, error) {
	repo := "v2fly/domain-list-community"
	version, err := m.commit(ctx, repo)
	if err != nil {
		return nil, "", err
	}
	archive, err := m.fetch(ctx, "https://codeload.github.com/"+repo+"/tar.gz/"+version, 20<<20)
	if err != nil {
		return nil, "", err
	}
	zipped, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, "", errors.New("上游未返回有效 gzip 快照")
	}
	defer zipped.Close()
	reader := tar.NewReader(io.LimitReader(zipped, 64<<20))
	files := map[string][]byte{}
	for {
		header, e := reader.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, "", e
		}
		parts := strings.Split(header.Name, "/")
		if header.Typeflag != tar.TypeReg || len(parts) != 3 || parts[1] != "data" || !validName(parts[2]) {
			continue
		}
		if header.Size > MaxFileBytes || header.Size < 0 {
			return nil, "", errors.New("源码快照中存在过大的规则文件")
		}
		content, e := io.ReadAll(io.LimitReader(reader, MaxFileBytes+1))
		if e != nil {
			return nil, "", e
		}
		files[parts[2]] = content
		if len(files) > 6000 {
			return nil, "", errors.New("源码快照分类数超过限制")
		}
	}
	if len(files) == 0 {
		return nil, "", errors.New("未找到 data 目录，保留已有缓存")
	}
	parser, err := NewDLCParser(files, "v2fly", version)
	if err != nil {
		return nil, "", err
	}
	out := []model.RuleCategory{}
	for _, name := range parser.Names() {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		entries, warnings, e := parser.Parse(name)
		c := model.RuleCategory{ID: "v2fly:" + name, Name: name, Source: "v2fly", Version: version, Path: "data/" + name, Raw: string(files[name]), Format: "text", Loaded: e == nil, Rules: entries, RuleCount: len(entries), Broad: Broad(name, len(entries)), Warnings: warnings}
		if e != nil {
			c.Warnings = append(c.Warnings, e.Error())
		}
		out = append(out, c)
	}
	return out, version, nil
}

func (m *Manager) Load(ctx context.Context, id string) (model.RuleCategory, error) {
	if !m.operation.TryLock() {
		return model.RuleCategory{}, errors.New("规则库正在更新或加载")
	}
	defer m.operation.Unlock()
	c, ok := m.Category(id)
	if !ok {
		return c, errors.New("分类不存在，请先初始化规则库")
	}
	if c.Loaded && c.Raw != "" {
		return c, nil
	}
	var err error
	if c.Source == "v2fly" {
		// v1.1 caches contain parsed entries but no original text. Fetch the
		// exact historical file without changing its parsed rules or snapshot.
		var raw []byte
		raw, err = m.fetch(ctx, "https://raw.githubusercontent.com/v2fly/domain-list-community/"+c.Version+"/"+c.Path, MaxFileBytes)
		if err == nil {
			c.Raw = string(raw)
			c.Format = "text"
		}
	} else if c.Source == "blackmatrix7" {
		c, err = m.downloadBlackmatrix(ctx, c)
	} else {
		return c, errors.New("未知分类来源")
	}
	if err != nil {
		return c, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sources[c.Source]
	if old := m.categories[id]; !old.Loaded && c.Loaded {
		s.LoadedCount++
	}
	if err = m.store.SaveSource(s, []model.RuleCategory{c}, false); err != nil {
		return c, err
	}
	m.categories[id] = c
	m.sources[s.ID] = s
	return c, nil
}

// Target-specific names can load relevant Blackmatrix categories without
// downloading hundreds of unrelated files. A missing source is not a scan error.
func (m *Manager) LoadForTarget(ctx context.Context, host string) {
	names := strings.Split(host, ".")
	for _, c := range m.Categories(false) {
		if c.Loaded || c.Source != "blackmatrix7" {
			continue
		}
		wanted := false
		for _, part := range names {
			if len(part) > 2 && strings.EqualFold(part, c.Name) {
				wanted = true
			}
		}
		if wanted {
			_, _ = m.Load(ctx, c.ID)
		}
	}
}

func (m *Manager) Clear() error {
	if !m.operation.TryLock() {
		return errors.New("规则库正在操作，暂时不能清理")
	}
	defer m.operation.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.store.ClearRules(); err != nil {
		return err
	}
	m.categories = map[string]model.RuleCategory{}
	m.sources = map[string]model.RuleSource{}
	for _, s := range defaults() {
		m.sources[s.ID] = s
	}
	return nil
}
