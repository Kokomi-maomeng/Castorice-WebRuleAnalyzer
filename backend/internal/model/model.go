package model

import "time"

const Version = "v1.3"

type ScanOptions struct {
	DNSMode           string `json:"dns_mode"`
	Mode              string `json:"mode"`
	MaxSeconds        int    `json:"max_seconds"`
	MaxDepth          int    `json:"max_depth"`
	MaxPages          int    `json:"max_pages"`
	NavigationSeconds int    `json:"navigation_seconds"`
	QuietMillis       int    `json:"quiet_millis"`
	IntervalMillis    int    `json:"interval_millis"`
	ObserveSeconds    int    `json:"observe_seconds"`
	Visible           bool   `json:"visible"`
	BrowserPath       string `json:"browser_path"`
}

func DefaultOptions() ScanOptions {
	return ScanOptions{DNSMode: "auto", Mode: "quick", MaxSeconds: 180, MaxDepth: 2, MaxPages: 20, NavigationSeconds: 30, QuietMillis: 1500, IntervalMillis: 500, ObserveSeconds: 10}
}

type Settings struct {
	Scan         ScanOptions `json:"scan"`
	Theme        string      `json:"theme"`
	LogLevel     string      `json:"log_level"`
	ExportFormat string      `json:"export_format"`
	Policy       string      `json:"policy"`
}

func DefaultSettings() Settings {
	return Settings{Scan: DefaultOptions(), Theme: "light", LogLevel: "INFO", ExportFormat: "clash", Policy: "dibao"}
}

type PageRecord struct {
	URL    string `json:"url"`
	Depth  int    `json:"depth"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type ScanTask struct {
	TestMode            bool         `json:"test_mode"`
	ID                  string       `json:"id"`
	TargetURL           string       `json:"target_url"`
	Status              string       `json:"status"`
	Options             ScanOptions  `json:"options"`
	StartedAt           time.Time    `json:"started_at"`
	EndedAt             *time.Time   `json:"ended_at,omitempty"`
	EndReason           string       `json:"end_reason,omitempty"`
	Error               string       `json:"error,omitempty"`
	Browser             string       `json:"browser,omitempty"`
	CurrentPage         string       `json:"current_page,omitempty"`
	RequestCount        int          `json:"request_count"`
	DomainCount         int          `json:"domain_count"`
	IPCount             int          `json:"ip_count"`
	Pages               []PageRecord `json:"pages"`
	Matches             []RuleMatch  `json:"matches"`
	RecommendedCategory string       `json:"recommended_category,omitempty"`
	MatchNote           string       `json:"match_note,omitempty"`
}

func (s ScanTask) Active() bool {
	return s.Status == "starting" || s.Status == "running" || s.Status == "stopping"
}

type NetworkRequest struct {
	ID           string    `json:"id"`
	CDPID        string    `json:"cdp_id"`
	TaskID       string    `json:"task_id"`
	Time         time.Time `json:"time"`
	Method       string    `json:"method"`
	URL          string    `json:"url"`
	Hostname     string    `json:"hostname"`
	HostKind     string    `json:"host_kind"`
	Scheme       string    `json:"scheme"`
	Protocol     string    `json:"protocol,omitempty"`
	ResourceType string    `json:"resource_type"`
	StatusCode   int       `json:"status_code,omitempty"`
	RemoteIP     string    `json:"remote_ip,omitempty"`
	SourcePage   string    `json:"source_page,omitempty"`
	Initiator    string    `json:"initiator,omitempty"`
	DurationMS   *float64  `json:"duration_ms,omitempty"`
	State        string    `json:"state"`
	Failure      string    `json:"failure,omitempty"`
	FirstDomain  bool      `json:"first_domain"`
}

type DomainRecord struct {
	Hostname      string    `json:"hostname"`
	Kind          string    `json:"kind"`
	Registrable   string    `json:"registrable,omitempty"`
	FirstSeen     time.Time `json:"first_seen"`
	RequestCount  int       `json:"request_count"`
	ResourceTypes []string  `json:"resource_types"`
	RequestIDs    []string  `json:"request_ids"`
	Source        string    `json:"source"`
}

type Event struct {
	ID      int64     `json:"id"`
	TaskID  string    `json:"task_id"`
	Time    time.Time `json:"time"`
	Kind    string    `json:"kind"`
	Level   string    `json:"level"`
	Message string    `json:"message"`
}

type RuleType string

const (
	Domain  RuleType = "DOMAIN"
	Suffix  RuleType = "DOMAIN-SUFFIX"
	Keyword RuleType = "DOMAIN-KEYWORD"
)

type RuleOrigin struct {
	Source   string `json:"source"`
	Category string `json:"source_category"`
	Version  string `json:"source_version"`
	File     string `json:"file,omitempty"`
	License  string `json:"license,omitempty"`
}

type RuleEntry struct {
	Type       RuleType     `json:"rule_type"`
	Value      string       `json:"rule_value"`
	Origins    []RuleOrigin `json:"origins"`
	Attributes []string     `json:"attributes,omitempty"`
}

func (r RuleEntry) Key() string { return string(r.Type) + "," + r.Value }

type RuleCategory struct {
	Raw         string      `json:"raw,omitempty"`
	Format      string      `json:"format,omitempty"`
	ContentHash string      `json:"content_hash,omitempty"`
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Source      string      `json:"source"`
	Version     string      `json:"version"`
	Path        string      `json:"path"`
	Loaded      bool        `json:"loaded"`
	Broad       bool        `json:"broad"`
	RuleCount   int         `json:"rule_count"`
	Warnings    []string    `json:"warnings"`
	Rules       []RuleEntry `json:"rules,omitempty"`
}

type RuleSource struct {
	AutoUpdate    bool       `json:"auto_update"`
	CheckedAt     *time.Time `json:"checked_at,omitempty"`
	RemoteVersion string     `json:"remote_version,omitempty"`
	LicenseText   string     `json:"license_text,omitempty"`
	LicenseURL    string     `json:"license_url,omitempty"`
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Repository    string     `json:"repository"`
	License       string     `json:"license"`
	Version       string     `json:"version"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
	Status        string     `json:"status"`
	Error         string     `json:"error,omitempty"`
	CategoryCount int        `json:"category_count"`
	LoadedCount   int        `json:"loaded_count"`
}

type RuleMatch struct {
	Relation       string         `json:"relation"`
	Evidence       []RuleEvidence `json:"evidence"`
	CategoryID     string         `json:"category_id"`
	Category       string         `json:"category"`
	Source         string         `json:"source"`
	Version        string         `json:"version"`
	Score          float64        `json:"score"`
	Confidence     string         `json:"confidence"`
	Reasons        []string       `json:"reasons"`
	MatchedDomains []string       `json:"matched_domains"`
	Coverage       float64        `json:"coverage"`
	Suitable       bool           `json:"suitable"`
	Broad          bool           `json:"broad"`
}

type RuleEvidence struct {
	Hostname string   `json:"hostname"`
	Type     RuleType `json:"rule_type"`
	Value    string   `json:"rule_value"`
	Target   bool     `json:"target"`
}

type ExportJob struct {
	TaskID      string   `json:"task_id"`
	Mode        string   `json:"mode"`
	CategoryIDs []string `json:"category_ids"`
	Format      string   `json:"format"`
	Policy      string   `json:"policy"`
	Filename    string   `json:"filename"`
	ListOnly    bool     `json:"list_only"`
	UseSuffix   bool     `json:"use_suffix"`
	Domains     []string `json:"domains"`
	Excluded    []string `json:"excluded"`
}

type PreviewEntry struct {
	RuleEntry
	Label     string `json:"label"`
	CoveredBy string `json:"covered_by,omitempty"`
	Risk      string `json:"risk,omitempty"`
	Selected  bool   `json:"selected"`
}

type ExportResult struct {
	Attribution        string         `json:"attribution"`
	Content            string         `json:"content"`
	Filename           string         `json:"filename"`
	MIME               string         `json:"mime"`
	Entries            []PreviewEntry `json:"entries"`
	ObservedDomains    int            `json:"observed_domains"`
	AddedRules         int            `json:"added_rules"`
	DuplicateOrCovered int            `json:"duplicate_or_covered"`
	FinalRules         int            `json:"final_rules"`
	Warnings           []string       `json:"warnings"`
}
