package exporter

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/rules"
	"go.yaml.in/yaml/v3"
)

func ValidatePolicy(policy string) error {
	if strings.TrimSpace(policy) == "" || len(policy) > 128 || strings.ContainsAny(policy, ",\r\n\x00") {
		return errors.New("策略组名称不能为空，且不能包含逗号或换行")
	}
	return nil
}

func Filename(raw, ext string) string {
	raw = strings.TrimSpace(filepath.Base(strings.ReplaceAll(raw, "\\", "/")))
	raw = strings.TrimSuffix(raw, filepath.Ext(raw))
	raw = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '-'
		}
		return r
	}, raw)
	raw = strings.Trim(raw, " .")
	if raw == "" || raw == "." || raw == ".." {
		raw = "castorice-rules"
	}
	if len([]rune(raw)) > 100 {
		raw = string([]rune(raw)[:100])
	}
	stem := strings.ToUpper(strings.Split(raw, ".")[0])
	if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) {
		raw = "rules-" + raw
	}
	return raw + ext
}

func Build(job model.ExportJob, observed []model.DomainRecord, categories []model.RuleCategory) (model.ExportResult, error) {
	result := model.ExportResult{Entries: []model.PreviewEntry{}, Warnings: []string{}}
	if job.Mode != "observed" && job.Mode != "merged" {
		return result, errors.New("未知导出模式")
	}
	if job.Mode == "merged" && len(categories) == 0 {
		return result, errors.New("合并模式需要明确选择已加载的规则分类")
	}
	selected := map[string]bool{}
	for _, s := range job.Domains {
		selected[s] = true
	}
	explicitDomains := job.Domains != nil
	entries := []model.RuleEntry{}
	observedKeys := map[string]bool{}
	externalKeys := map[string]bool{}
	typ := model.Domain
	if job.UseSuffix {
		typ = model.Suffix
		result.Warnings = append(result.Warnings, "已主动选择 DOMAIN-SUFFIX：这会包含观察 Hostname 的全部子域名，扩大匹配范围。")
	}
	for _, d := range observed {
		if d.Kind != "domain" {
			continue
		}
		if explicitDomains && !selected[d.Hostname] {
			continue
		}
		result.ObservedDomains++
		r, e := rules.Normalize(model.RuleEntry{Type: typ, Value: d.Hostname, Origins: []model.RuleOrigin{{Source: "observed", Category: job.TaskID, Version: model.Version}}})
		if e != nil {
			return result, e
		}
		entries = append(entries, r)
		observedKeys[r.Key()] = true
	}
	if job.Mode == "merged" {
		for _, c := range categories {
			if !c.Loaded {
				return result, errors.New("选定分类尚未加载")
			}
			if c.Broad {
				result.Warnings = append(result.Warnings, c.Name+" 是通用或大型分类，请核对合并范围。")
			}
			if len(c.Warnings) > 0 {
				result.Warnings = append(result.Warnings, fmt.Sprintf("%s 有 %d 项解析警告，不支持的内容未导出。", c.Name, len(c.Warnings)))
			}
			for _, r := range c.Rules {
				normal, e := rules.Normalize(r)
				if e != nil {
					return result, e
				}
				entries = append(entries, normal)
				externalKeys[normal.Key()] = true
			}
		}
	}
	unique := rules.Unique(entries)
	excluded := map[string]bool{}
	for _, key := range job.Excluded {
		excluded[key] = true
	}
	selectedSuffix := map[string]string{}
	for _, r := range unique {
		if r.Type == model.Suffix && !excluded[r.Key()] {
			selectedSuffix[r.Value] = r.Key()
		}
	}
	// Prefer the broadest selected suffix as the covering representative. Keywords
	// are not used to delete narrower rules: substring coverage is too ambiguous.
	final := []model.RuleEntry{}
	for _, r := range unique {
		entry := model.PreviewEntry{RuleEntry: r, Selected: !excluded[r.Key()], Label: "规则库补充"}
		if observedKeys[r.Key()] {
			entry.Label = "本次抓取"
		}
		if observedKeys[r.Key()] && externalKeys[r.Key()] {
			entry.Label = "双方匹配"
			if entry.Selected {
				result.DuplicateOrCovered++
			}
		}
		if r.Type == model.Keyword {
			entry.Risk = "关键词规则可能误匹配不相关域名"
		}
		if entry.Selected && (r.Type == model.Domain || r.Type == model.Suffix) {
			// Walk DNS label boundaries, retaining the broadest selected suffix.
			// This bounds lookup by hostname depth instead of all suffix rules.
			for value := r.Value; ; {
				if key := selectedSuffix[value]; key != "" && key != r.Key() {
					entry.CoveredBy = key
				}
				i := strings.IndexByte(value, '.')
				if i < 0 {
					break
				}
				value = value[i+1:]
			}
			if entry.CoveredBy != "" {
				result.DuplicateOrCovered++
			}
		}
		if entry.Selected && entry.CoveredBy == "" {
			final = append(final, r)
			if !observedKeys[r.Key()] {
				result.AddedRules++
			}
		}
		result.Entries = append(result.Entries, entry)
	}
	if len(final) == 0 {
		return result, errors.New("没有可导出的已选择域名规则（IP 地址不作为普通域名导出）")
	}
	result.FinalRules = len(final)
	provenance := []string{"Castorice-WebRuleAnalyzer " + model.Version + " · 规则来源与许可证", "观察数据来自扫描任务 " + job.TaskID + "；有限扫描不代表完整覆盖。"}
	seenOrigins := map[string]bool{}
	for _, r := range final {
		for _, o := range r.Origins {
			if o.Source == "observed" {
				continue
			}
			repo := ""
			if o.Source == "blackmatrix7" {
				repo = "blackmatrix7/ios_rule_script"
			} else if o.Source == "v2fly" {
				repo = "v2fly/domain-list-community"
			}
			line := fmt.Sprintf("%s / %s @ %s · %s", o.Source, o.Category, o.Version, o.License)
			if repo != "" {
				line += "\nhttps://github.com/" + repo + "/blob/" + o.Version + "/LICENSE\nhttps://github.com/" + repo + "/blob/" + o.Version + "/" + o.File
			}
			if !seenOrigins[line] {
				seenOrigins[line] = true
				provenance = append(provenance, line)
			}
		}
	}
	if len(seenOrigins) > 0 {
		result.Attribution = strings.Join(provenance, "\n\n") + "\n"
	}
	content, mime, ext, err := Serialize(final, job)
	if err != nil {
		return result, err
	}
	result.Content = content
	result.MIME = mime
	result.Filename = Filename(job.Filename, ext)
	return result, nil
}

func Serialize(entries []model.RuleEntry, job model.ExportJob) (string, string, string, error) {
	for _, r := range entries {
		if _, err := rules.Normalize(r); err != nil {
			return "", "", "", err
		}
	}
	if job.Format == "singbox" {
		type sourceRule struct {
			Domain  []string `json:"domain,omitempty"`
			Suffix  []string `json:"domain_suffix,omitempty"`
			Keyword []string `json:"domain_keyword,omitempty"`
		}
		rule := sourceRule{}
		for _, r := range entries {
			switch r.Type {
			case model.Domain:
				rule.Domain = append(rule.Domain, r.Value)
			case model.Suffix:
				rule.Suffix = append(rule.Suffix, r.Value)
			case model.Keyword:
				rule.Keyword = append(rule.Keyword, r.Value)
			}
		}
		output := struct {
			Version int          `json:"version"`
			Rules   []sourceRule `json:"rules"`
		}{3, []sourceRule{rule}}
		b, err := json.MarshalIndent(output, "", "  ")
		return string(b) + "\n", "application/json", ".json", err
	}
	if job.Format != "clash" && job.Format != "provider" {
		return "", "", "", errors.New("不支持的导出格式")
	}
	if job.Format == "clash" {
		if err := ValidatePolicy(job.Policy); err != nil {
			return "", "", "", err
		}
	}
	values := []string{}
	for _, r := range entries {
		v := r.Key()
		if job.Format == "clash" {
			v += "," + job.Policy
		}
		values = append(values, v)
	}
	var object any
	if job.Format == "provider" {
		object = struct {
			Payload []string `yaml:"payload"`
		}{values}
	} else if job.ListOnly {
		object = values
	} else {
		object = struct {
			Rules []string `yaml:"rules"`
		}{values}
	}
	b, err := yaml.Marshal(object)
	if err != nil {
		return "", "", "", err
	}
	attribution := []string{"# Castorice-WebRuleAnalyzer " + model.Version + " · 浏览器观察结果，覆盖有限"}
	origins := map[string]bool{}
	for _, r := range entries {
		for _, o := range r.Origins {
			if o.Source == "observed" {
				continue
			}
			line := fmt.Sprintf("# 来源 %s / %s @ %s · %s", o.Source, o.Category, o.Version, o.License)
			if !origins[line] {
				origins[line] = true
				attribution = append(attribution, line)
			}
		}
	}
	sort.Strings(attribution[1:])
	return strings.Join(attribution, "\n") + "\n" + string(b), "application/yaml", ".yaml", nil
}
