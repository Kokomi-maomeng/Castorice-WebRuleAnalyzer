package rules

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"go.yaml.in/yaml/v3"
)

const MaxFileBytes = 2 << 20
const MaxIncludeDepth = 24
const MaxCategoryRules = 100000
const MaxParseWork = 1000000
const MaxCategoryWarnings = 10000

func Normalize(entry model.RuleEntry) (model.RuleEntry, error) {
	entry.Value = strings.ToLower(strings.TrimSpace(entry.Value))
	switch entry.Type {
	case model.Domain, model.Suffix:
		host, kind, err := domain.NormalizeHost(entry.Value)
		if err != nil || kind != "domain" || !strings.Contains(host, ".") {
			return entry, errors.New("规则必须是有效域名，不能是 IP 或单标签主机")
		}
		entry.Value = host
	case model.Keyword:
		if entry.Value == "" || len(entry.Value) > 253 || strings.ContainsAny(entry.Value, ",\r\n\t /:#@\\\"'") {
			return entry, errors.New("无效的域名关键词")
		}
	default:
		return entry, errors.New("不支持的规则类型")
	}
	return entry, nil
}

func Unique(entries []model.RuleEntry) []model.RuleEntry {
	result := []model.RuleEntry{}
	index := map[string]int{}
	origins := map[int]map[model.RuleOrigin]bool{}
	attributes := map[int]map[string]bool{}
	for _, r := range entries {
		if i, ok := index[r.Key()]; ok {
			if origins[i] == nil {
				origins[i] = map[model.RuleOrigin]bool{}
				for _, o := range result[i].Origins {
					origins[i][o] = true
				}
				result[i].Origins = append([]model.RuleOrigin{}, result[i].Origins...)
				attributes[i] = map[string]bool{}
				for _, a := range result[i].Attributes {
					attributes[i][a] = true
				}
				result[i].Attributes = append([]string{}, result[i].Attributes...)
			}
			for _, o := range r.Origins {
				if !origins[i][o] {
					origins[i][o] = true
					result[i].Origins = append(result[i].Origins, o)
				}
			}
			for _, a := range r.Attributes {
				if !attributes[i][a] {
					attributes[i][a] = true
					result[i].Attributes = append(result[i].Attributes, a)
				}
			}
		} else {
			index[r.Key()] = len(result)
			result = append(result, r)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Key() < result[j].Key() })
	return result
}
func contains(values []string, v string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}

func ParseClash(content []byte, origin model.RuleOrigin) ([]model.RuleEntry, []string, error) {
	if len(content) > MaxFileBytes {
		return nil, nil, errors.New("规则文件过大")
	}
	var lines []string
	if strings.HasSuffix(origin.File, ".yaml") || strings.HasSuffix(origin.File, ".yml") {
		var payload struct {
			Payload []string `yaml:"payload"`
		}
		if err := yaml.Unmarshal(content, &payload); err != nil {
			return nil, nil, fmt.Errorf("无效的 classical YAML: %w", err)
		}
		if payload.Payload == nil {
			return nil, nil, errors.New("规则文件缺少 payload 数组")
		}
		lines = payload.Payload
	} else {
		scanner := bufio.NewScanner(strings.NewReader(string(content)))
		scanner.Buffer(make([]byte, 4096), MaxFileBytes)
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		if err := scanner.Err(); err != nil {
			return nil, nil, err
		}
	}
	entries := []model.RuleEntry{}
	warnings := []string{}
	for i, line := range lines {
		line = strings.TrimSpace(strings.SplitN(line, "#", 2)[0])
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) != 2 {
			warnings = append(warnings, fmt.Sprintf("第 %d 项：复杂或无效规则未转换", i+1))
			continue
		}
		entry, err := Normalize(model.RuleEntry{Type: model.RuleType(strings.TrimSpace(parts[0])), Value: parts[1], Origins: []model.RuleOrigin{origin}})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("第 %d 项：%s", i+1, err))
			continue
		}
		entries = append(entries, entry)
	}
	if len(lines) == 0 {
		return nil, warnings, errors.New("文件不包含可导出的域名规则")
	}
	return Unique(entries), warnings, nil
}

type inclusion struct {
	name    string
	filters []string
}
type dlcFile struct {
	entries  []model.RuleEntry
	includes []inclusion
	warnings []string
}
type DLCParser struct {
	files           map[string]*dlcFile
	source, version string
}

// Parse all source records before resolving includes, so affiliations (&target)
// work even when the destination has no physical file in the repository.
func NewDLCParser(files map[string][]byte, source, version string) (*DLCParser, error) {
	p := &DLCParser{files: map[string]*dlcFile{}, source: source, version: version}
	ensure := func(name string) *dlcFile {
		f := p.files[name]
		if f == nil {
			f = &dlcFile{}
			p.files[name] = f
		}
		return f
	}
	names := []string{}
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		content := files[name]
		if len(content) > MaxFileBytes {
			return nil, errors.New("DLC 文件过大")
		}
		f := ensure(name)
		scanner := bufio.NewScanner(strings.NewReader(string(content)))
		scanner.Buffer(make([]byte, 4096), MaxFileBytes)
		lineNo := 0
		for scanner.Scan() {
			lineNo++
			line := strings.TrimSpace(strings.SplitN(scanner.Text(), "#", 2)[0])
			if line == "" {
				continue
			}
			fields := strings.Fields(line)
			token := fields[0]
			attrs := []string{}
			affiliations := []string{}
			bad := false
			for _, field := range fields[1:] {
				if strings.HasPrefix(field, "@") {
					attrs = append(attrs, strings.TrimPrefix(field, "@"))
				} else if strings.HasPrefix(field, "&") {
					affiliations = append(affiliations, strings.TrimPrefix(field, "&"))
				} else {
					bad = true
				}
			}
			if bad {
				f.warnings = append(f.warnings, fmt.Sprintf("%s:%d 未知修饰符，跳过", name, lineNo))
				continue
			}
			if strings.HasPrefix(token, "include:") {
				target := strings.TrimPrefix(token, "include:")
				if !validName(target) || len(affiliations) > 0 {
					f.warnings = append(f.warnings, "无效 include 或 include affiliation")
					continue
				}
				f.includes = append(f.includes, inclusion{target, attrs})
				continue
			}
			typ, value := model.Suffix, token
			if k, v, ok := strings.Cut(token, ":"); ok {
				value = v
				switch k {
				case "full":
					typ = model.Domain
				case "domain":
					typ = model.Suffix
				case "keyword":
					typ = model.Keyword
				default:
					f.warnings = append(f.warnings, fmt.Sprintf("%s:%d %s 不支持，未转换", name, lineNo, k))
					continue
				}
			}
			entry, err := Normalize(model.RuleEntry{Type: typ, Value: value, Attributes: attrs, Origins: []model.RuleOrigin{{Source: source, Category: name, Version: version, File: "data/" + name, License: "MIT"}}})
			if err != nil {
				f.warnings = append(f.warnings, fmt.Sprintf("%s:%d %s", name, lineNo, err))
				continue
			}
			f.entries = append(f.entries, entry)
			for _, target := range affiliations {
				if validName(target) {
					ensure(target).entries = append(ensure(target).entries, entry)
				} else {
					f.warnings = append(f.warnings, "无效 affiliation，已忽略")
				}
			}
		}
		if err := scanner.Err(); err != nil {
			return nil, err
		}
	}
	return p, nil
}

func validName(s string) bool {
	if s == "" || len(s) > 128 || strings.Contains(s, "..") {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.') {
			return false
		}
	}
	return true
}
func (p *DLCParser) Names() []string {
	out := []string{}
	for name := range p.files {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
func (p *DLCParser) Parse(name string) ([]model.RuleEntry, []string, error) {
	return p.ParseContext(context.Background(), name)
}

type resolvedFile struct {
	entries  []model.RuleEntry
	warnings []string
	depth    int
}
type parseState struct {
	ctx  context.Context
	work int
	memo map[string]resolvedFile
}

func (s *parseState) consume(n int) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	s.work += n
	if s.work > MaxParseWork {
		return errors.New("规则解析工作量超过限制")
	}
	return nil
}

func (p *DLCParser) ParseContext(ctx context.Context, name string) ([]model.RuleEntry, []string, error) {
	state := &parseState{ctx: ctx, memo: map[string]resolvedFile{}}
	entries, warnings, _, err := p.resolve(state, name, map[string]bool{}, 0)
	if err != nil {
		return nil, warnings, err
	}
	if err = state.consume(len(entries)); err != nil {
		return nil, warnings, err
	}
	return Unique(entries), warnings, err
}
func (p *DLCParser) resolve(state *parseState, name string, stack map[string]bool, depth int) ([]model.RuleEntry, []string, int, error) {
	if err := state.consume(1); err != nil {
		return nil, nil, 0, err
	}
	if depth > MaxIncludeDepth {
		return nil, nil, 0, errors.New("include 超过最大嵌套深度")
	}
	if stack[name] {
		return nil, nil, 0, fmt.Errorf("include 循环引用: %s", name)
	}
	if cached, ok := state.memo[name]; ok {
		if depth+cached.depth > MaxIncludeDepth {
			return nil, nil, 0, errors.New("include 超过最大嵌套深度")
		}
		return cached.entries, cached.warnings, cached.depth, nil
	}
	f := p.files[name]
	if f == nil {
		return nil, nil, 0, fmt.Errorf("include 文件不存在: %s", name)
	}
	if len(f.entries) > MaxCategoryRules {
		return nil, nil, 0, errors.New("分类规则数超过限制")
	}
	if len(f.warnings) > MaxCategoryWarnings {
		return nil, nil, 0, errors.New("分类转换提示超过限制")
	}
	if err := state.consume(len(f.entries) + len(f.warnings)); err != nil {
		return nil, nil, 0, err
	}
	stack[name] = true
	defer delete(stack, name)
	result := append([]model.RuleEntry{}, f.entries...)
	warnings := append([]string{}, f.warnings...)
	maxDepth := 0
	for _, inc := range f.includes {
		entries, notes, childDepth, err := p.resolve(state, inc.name, stack, depth+1)
		if err != nil {
			return nil, warnings, 0, err
		}
		maxDepth = max(maxDepth, childDepth+1)
		if err := state.consume(len(notes)); err != nil {
			return nil, warnings, 0, err
		}
		if len(warnings)+len(notes) > MaxCategoryWarnings {
			return nil, warnings, 0, errors.New("分类转换提示超过限制")
		}
		warnings = append(warnings, notes...)
		for _, entry := range entries {
			if err := state.consume(1); err != nil {
				return nil, warnings, 0, err
			}
			include := true
			for _, filter := range inc.filters {
				if err := state.consume(1 + len(entry.Attributes)); err != nil {
					return nil, warnings, 0, err
				}
				neg := strings.HasPrefix(filter, "-")
				attr := strings.TrimPrefix(filter, "-")
				has := contains(entry.Attributes, attr)
				if neg && has || !neg && !has {
					include = false
					break
				}
			}
			if include {
				if len(result) >= MaxCategoryRules {
					return nil, warnings, 0, errors.New("分类规则数超过限制")
				}
				result = append(result, entry)
			}
		}
		if len(result) > MaxCategoryRules {
			return nil, warnings, 0, errors.New("分类规则数超过限制")
		}
	}
	// Attribute variants must stay separate until every include filter has run.
	// Unioning @ads with an untagged duplicate before @-ads filtering would
	// incorrectly drop the otherwise valid untagged rule.
	seen := map[string]int{}
	originSets := map[int]map[model.RuleOrigin]bool{}
	variants := []model.RuleEntry{}
	for _, entry := range result {
		if err := state.consume(1 + len(entry.Attributes) + len(entry.Origins)); err != nil {
			return nil, warnings, 0, err
		}
		attrs := append([]string{}, entry.Attributes...)
		sort.Strings(attrs)
		key := entry.Key() + "|" + strings.Join(attrs, ",")
		if index, ok := seen[key]; ok {
			origins := variants[index].Origins
			if originSets[index] == nil {
				origins = append([]model.RuleOrigin{}, origins...)
				originSets[index] = map[model.RuleOrigin]bool{}
				for _, origin := range origins {
					originSets[index][origin] = true
				}
			}
			for _, origin := range entry.Origins {
				if !originSets[index][origin] {
					originSets[index][origin] = true
					origins = append(origins, origin)
				}
			}
			variants[index].Origins = origins
		} else {
			seen[key] = len(variants)
			variants = append(variants, entry)
		}
	}
	state.memo[name] = resolvedFile{entries: variants, warnings: warnings, depth: maxDepth}
	return variants, warnings, maxDepth, nil
}
