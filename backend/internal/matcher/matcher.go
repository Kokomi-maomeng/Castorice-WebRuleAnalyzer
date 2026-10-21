package matcher

import (
	"math"
	"sort"
	"strings"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/domain"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/model"
)

// Identity hints are transparent application metadata, never synthetic rules.
// A hint can only score if the downloaded category also matches the target.
var identities = map[string][]string{
	"gemini":        {"gemini.google.com", "bard.google.com", "ai.google.dev", "deepmind.google", "deepmind.com"},
	"google-gemini": {"gemini.google.com", "bard.google.com", "ai.google.dev"},
	"openai":        {"chatgpt.com", "openai.com", "chat.openai.com"},
	"youtube":       {"youtube.com", "youtu.be"}, "github": {"github.com"},
	"claude": {"claude.ai", "anthropic.com"}, "anthropic": {"claude.ai", "anthropic.com"},
	"copilot": {"copilot.microsoft.com"}, "netflix": {"netflix.com"}, "spotify": {"spotify.com"},
}
var shared = map[string]bool{"accounts.google.com": true, "fonts.gstatic.com": true, "fonts.googleapis.com": true, "www.gstatic.com": true, "www.google-analytics.com": true, "www.googletagmanager.com": true, "login.microsoftonline.com": true}

func identity(name, target string) bool {
	n := strings.ToLower(name)
	for _, h := range identities[n] {
		if target == h || strings.HasSuffix(target, "."+h) {
			return true
		}
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

func Match(target string, observed []model.DomainRecord, categories []model.RuleCategory) ([]model.RuleMatch, string, string) {
	hosts := []string{}
	seenHosts := map[string]bool{}
	for _, d := range observed {
		if d.Kind == "domain" && !seenHosts[d.Hostname] {
			hosts = append(hosts, d.Hostname)
			seenHosts[d.Hostname] = true
		}
	}
	// Index observed hostnames and their label-boundary suffixes once. Matching
	// stays practical at 20,000 requests instead of scanning every rule against
	// every hostname in every category. Only keyword rules need substring scans.
	exactIndex := map[string][]int{}
	suffixIndex := map[string][]int{}
	registered := make([]string, len(hosts))
	for i, h := range hosts {
		exactIndex[h] = append(exactIndex[h], i)
		registered[i] = domain.Registrable(h)
		for suffix := h; strings.Contains(suffix, "."); {
			suffixIndex[suffix] = append(suffixIndex[suffix], i)
			_, next, _ := strings.Cut(suffix, ".")
			suffix = next
		}
	}
	type hostHit struct {
		weight float64
		exact  bool
	}
	hits := make([]map[int]hostHit, len(categories))
	frequency := map[string]int{}
	for ci, c := range categories {
		if !c.Loaded || c.RuleCount == 0 {
			continue
		}
		hits[ci] = map[int]hostHit{}
		for _, rule := range c.Rules {
			var indexes []int
			switch rule.Type {
			case model.Domain:
				indexes = exactIndex[rule.Value]
			case model.Suffix:
				indexes = suffixIndex[rule.Value]
			case model.Keyword:
				for i, h := range hosts {
					if strings.Contains(h, rule.Value) {
						indexes = append(indexes, i)
					}
				}
			}
			for _, i := range indexes {
				h := hosts[i]
				weight := 1.0
				if rule.Type == model.Keyword {
					weight = .12
				}
				if rule.Type == model.Suffix && rule.Value == registered[i] && h != rule.Value {
					weight = .35
				}
				if shared[h] {
					weight *= .08
				}
				hit := hits[ci][i]
				hit.weight = math.Max(hit.weight, weight)
				hit.exact = hit.exact || rule.Type != model.Keyword && rule.Value == h
				hits[ci][i] = hit
			}
		}
		for i := range hits[ci] {
			frequency[hosts[i]]++
		}
	}
	out := []model.RuleMatch{}
	for ci, c := range categories {
		if !c.Loaded || len(c.Rules) == 0 {
			continue
		}
		matched := []string{}
		specific := 0.0
		targetHit := false
		targetExact := false
		for i, h := range hosts {
			hit := hits[ci][i]
			if hit.weight > 0 {
				matched = append(matched, h)
				specific += hit.weight / math.Sqrt(float64(max(1, frequency[h])))
				if h == target {
					targetHit = true
					targetExact = hit.exact
				}
			}
		}
		if len(matched) == 0 {
			continue
		}
		coverage := float64(len(matched)) / float64(max(1, len(hosts)))
		reasons := []string{}
		score := math.Min(25, specific*12) + coverage*15
		explicit := targetHit && identity(c.Name, target) && !c.Broad
		if explicit {
			score += 65
			reasons = append(reasons, "目标域名与分类身份名称/公开别名一致，且命中已下载规则")
		}
		if targetExact && !shared[target] && !c.Broad {
			score += 15
			reasons = append(reasons, "规则直接包含目标 Hostname 的精确或后缀入口")
		}
		if c.Broad {
			score *= .4
			reasons = append(reasons, "通用/大型分类已降权，不适合自动合并")
		}
		reasons = append(reasons, "评分结合观察集合覆盖率与跨分类共享频率；共享认证、字体和宽泛后缀降权")
		score = math.Round(math.Min(score, 100)*10) / 10
		confidence := "low"
		if score >= 80 && explicit {
			confidence = "high"
		} else if score >= 40 {
			confidence = "medium"
		}
		out = append(out, model.RuleMatch{CategoryID: c.ID, Category: c.Name, Source: c.Source, Version: c.Version, Score: score, Confidence: confidence, Reasons: reasons, MatchedDomains: matched, Coverage: coverage, Suitable: confidence == "high", Broad: c.Broad})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].CategoryID < out[j].CategoryID
		}
		return out[i].Score > out[j].Score
	})
	recommended := ""
	note := "没有可靠的专属分类，保持仅抓取结果；可以手动加载并选择分类。评分不是统计准确率。"
	if len(out) > 0 && out[0].Suitable {
		ambiguous := false
		for _, other := range out[1:] {
			if out[0].Score-other.Score < 12 && family(out[0].Category) != family(other.Category) {
				ambiguous = true
				break
			}
		}
		if !ambiguous {
			recommended = out[0].CategoryID
			note = "发现高置信度专属分类，可选择合并。评分为可解释算法评分，不代表实际识别准确率。"
		} else {
			note = "多个不同应用分类评分接近，未自动选择，请人工核对。"
			for i := range out {
				out[i].Suitable = false
				if out[i].Confidence == "high" {
					out[i].Confidence = "medium"
				}
			}
		}
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out, recommended, note
}
