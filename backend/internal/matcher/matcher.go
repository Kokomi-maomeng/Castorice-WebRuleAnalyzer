package matcher

import (
	"fmt"
	"sort"
	"strings"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

// Aliases strengthen real downloaded rule hits; names alone never identify apps.
var identities = map[string][]string{
	"gemini":        {"gemini.google.com", "bard.google.com", "ai.google.dev", "deepmind.google", "deepmind.com"},
	"google-gemini": {"gemini.google.com", "bard.google.com", "ai.google.dev"},
	"openai":        {"chatgpt.com", "openai.com"}, "youtube": {"youtube.com", "youtu.be"},
	"github": {"github.com"}, "claude": {"claude.ai", "anthropic.com"}, "anthropic": {"claude.ai", "anthropic.com"},
	"copilot": {"copilot.microsoft.com"}, "netflix": {"netflix.com"}, "spotify": {"spotify.com"},
}

func identity(name, target string) bool {
	n := strings.ToLower(name)
	if aliases, known := identities[n]; known {
		for _, host := range aliases {
			if target == host || strings.HasSuffix(target, "."+host) {
				return true
			}
		}
		return false
	}
	for _, label := range strings.Split(target, ".") {
		if len(label) > 2 && label == n {
			return true
		}
	}
	return false
}
func family(name string) string {
	switch strings.ToLower(name) {
	case "google-gemini", "gemini":
		return "gemini"
	case "anthropic", "claude":
		return "claude"
	}
	return strings.ToLower(name)
}

func Match(target string, observed []model.DomainRecord, categories []model.RuleCategory) ([]model.RuleMatch, string, string, int) {
	target = strings.TrimSuffix(strings.ToLower(target), ".")
	hosts := []string{}
	seen := map[string]bool{}
	exact := map[string][]int{}
	suffix := map[string][]int{}
	for _, d := range observed {
		host := strings.TrimSuffix(strings.ToLower(d.Hostname), ".")
		if d.Kind != "domain" || seen[host] {
			continue
		}
		seen[host] = true
		index := len(hosts)
		hosts = append(hosts, host)
		exact[host] = append(exact[host], index)
		for part := host; strings.Contains(part, "."); {
			suffix[part] = append(suffix[part], index)
			_, part, _ = strings.Cut(part, ".")
		}
	}
	out := []model.RuleMatch{}
	for _, c := range categories {
		if !c.Loaded || len(c.Rules) == 0 {
			continue
		}
		// Retain the strongest concrete rule per hostname, with label boundaries.
		best := map[int]model.RuleEntry{}
		strength := map[int]int{}
		for _, rule := range c.Rules {
			indexes := []int{}
			rank := 0
			switch rule.Type {
			case model.Domain:
				indexes = exact[rule.Value]
				rank = 1000 + len(rule.Value)
			case model.Suffix:
				indexes = suffix[rule.Value]
				rank = len(rule.Value)
			case model.Keyword:
				rank = -1
				for i, host := range hosts {
					if strings.Contains(host, rule.Value) {
						indexes = append(indexes, i)
					}
				}
			}
			for _, i := range indexes {
				if _, ok := best[i]; !ok || rank > strength[i] {
					best[i] = rule
					strength[i] = rank
				}
			}
		}
		if len(best) == 0 {
			continue
		}
		hit := model.RuleMatch{CategoryID: c.ID, Category: c.Name, Source: c.Source, Version: c.Version, Broad: c.Broad, Confidence: "low", Relation: "dependency", MatchedDomains: []string{}, Evidence: []model.RuleEvidence{}, Reasons: []string{}}
		targetSpecificity := 0
		for i, host := range hosts {
			rule, ok := best[i]
			if !ok {
				continue
			}
			hit.MatchedDomains = append(hit.MatchedDomains, host)
			isTarget := host == target
			hit.Evidence = append(hit.Evidence, model.RuleEvidence{Hostname: host, Type: rule.Type, Value: rule.Value, Target: isTarget})
			if isTarget && rule.Type != model.Keyword {
				hit.Relation = "target"
				targetSpecificity = len(rule.Value)
			} else if isTarget {
				hit.Relation = "keyword"
			}
		}
		hit.Coverage = float64(len(best)) / float64(max(1, len(hosts)))
		if hit.Relation == "target" {
			hit.Score = 50 + float64(targetSpecificity)/100
			hit.Confidence = "medium"
			hit.Reasons = append(hit.Reasons, "已下载的精确或后缀规则命中本次访问的目标主机")
			if identity(c.Name, target) && !c.Broad {
				hit.Score += 40
				hit.Confidence = "high"
				hit.Suitable = true
				hit.Reasons = append(hit.Reasons, "分类名称或已核对别名与目标网站一致")
			}
			if c.Broad {
				hit.Score -= 15
				hit.Reasons = append(hit.Reasons, "这是通用集合，不能视为目标网站的专属规则")
			}
		} else if hit.Relation == "keyword" {
			hit.Score = hit.Coverage
			hit.Reasons = append(hit.Reasons, "目标只命中关键词，存在包含关系误匹配风险，不用于识别应用")
		} else {
			hit.Score = hit.Coverage
			hit.Reasons = append(hit.Reasons, "仅命中本次观察到的第三方请求；不代表目标网站属于此应用")
		}
		out = append(out, hit)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].CategoryID < out[j].CategoryID
		}
		return out[i].Score > out[j].Score
	})
	recommended := ""
	note := "目标主机没有匹配到专属分类；第三方请求命中仅供核对。可直接导出观察域名。"
	if len(out) > 0 && out[0].Suitable {
		ambiguous := false
		for _, other := range out[1:] {
			if other.Suitable && family(other.Category) != family(out[0].Category) {
				ambiguous = true
			}
		}
		if !ambiguous {
			recommended = out[0].CategoryID
			note = "目标主机命中专属规则，可核对原文后选择合并。"
		} else {
			note = "多个不同应用分类同时声称目标主机，需核对规则原文后手动选择。"
			for i := range out {
				out[i].Suitable = false
				if out[i].Confidence == "high" {
					out[i].Confidence = "medium"
				}
			}
		}
	}
	total := len(out)
	if total > 60 {
		note += fmt.Sprintf(" 当前显示前 60 个，共 %d 个命中分类；其余可在规则库中检索。", total)
		out = out[:60]
	}
	return out, recommended, note, total
}
