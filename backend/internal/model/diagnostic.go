package model

// Diagnostic separates a useful user-facing explanation from optional technical details.
type Diagnostic struct {
	Code      string   `json:"code"`
	Stage     string   `json:"stage"`
	Message   string   `json:"message"`
	Hint      string   `json:"hint,omitempty"`
	Host      string   `json:"host,omitempty"`
	Addresses []string `json:"addresses,omitempty"`
	Detail    string   `json:"detail,omitempty"`
}

type RequestSummary struct {
	Responded        int `json:"responded"`
	ConnectionFailed int `json:"connection_failed"`
	HTTPError        int `json:"http_error"`
	Unfinished       int `json:"unfinished"`
	VisitedPages     int `json:"visited_pages"`
	FailedPages      int `json:"failed_pages"`
	BlockedPages     int `json:"blocked_pages"`
	PendingPages     int `json:"pending_pages"`
}

type DNSCheck struct {
	Addresses  []string    `json:"addresses"`
	Diagnostic *Diagnostic `json:"diagnostic,omitempty"`
}

type NetworkDiagnosis struct {
	URL         string      `json:"url"`
	Host        string      `json:"host"`
	DNSMode     string      `json:"dns_mode"`
	DNSProvider string      `json:"dns_provider"`
	Route       string      `json:"route"`
	System      DNSCheck    `json:"system"`
	Secure      DNSCheck    `json:"secure"`
	Connected   bool        `json:"connected"`
	Connection  *Diagnostic `json:"connection,omitempty"`
}
