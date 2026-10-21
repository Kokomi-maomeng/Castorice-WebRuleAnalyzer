export interface ScanOptions {
	 dns_mode?: 'auto' | 'system';
 mode: 'quick' | 'explore' | 'interactive'; max_seconds: number; max_depth: number; max_pages: number;
 navigation_seconds: number; quiet_millis: number; interval_millis: number; observe_seconds: number; visible: boolean; browser_path: string;
}
export interface Settings { scan: ScanOptions; theme: 'light' | 'dark' | 'system'; log_level: string; export_format: ExportFormat; policy: string }
export interface PageRecord { url: string; depth: number; status: string; reason?: string }
export interface RuleMatch { category_id: string; category: string; source: string; version: string; score: number; confidence: string; reasons: string[]; matched_domains: string[]; coverage: number; suitable: boolean; broad: boolean }
export interface ScanTask { test_mode?: boolean; id: string; target_url: string; status: string; options: ScanOptions; started_at: string; ended_at?: string; end_reason?: string; error?: string; browser?: string; current_page?: string; request_count: number; domain_count: number; ip_count: number; pages: PageRecord[]; matches: RuleMatch[]; recommended_category?: string; match_note?: string }
export interface DomainRecord { hostname: string; kind: string; registrable?: string; first_seen: string; request_count: number; resource_types: string[]; request_ids: string[]; source: string }
export interface NetworkRequest { id: string; cdp_id: string; task_id: string; time: string; method: string; url: string; hostname: string; host_kind: string; scheme: string; protocol?: string; resource_type: string; status_code?: number; remote_ip?: string; source_page?: string; initiator?: string; duration_ms?: number; state: string; failure?: string; first_domain: boolean }
export interface TaskEvent { id: number; task_id: string; time: string; kind: string; level: string; message: string }
export interface RuleSource { license_text?: string; license_url?: string; id: string; name: string; repository: string; license: string; version: string; updated_at?: string; status: string; error?: string; category_count: number; loaded_count: number }
export interface RuleCategory { id: string; name: string; source: string; version: string; path: string; loaded: boolean; broad: boolean; rule_count: number; warnings: string[] }
export type ExportFormat = 'clash' | 'provider' | 'singbox';
export interface RuleOrigin { source: string; source_category: string; source_version: string; file?: string; license?: string }
export interface PreviewEntry { rule_type: string; rule_value: string; origins: RuleOrigin[]; label: string; covered_by?: string; risk?: string; selected: boolean }
export interface ExportJob { task_id: string; mode: 'observed' | 'merged'; category_ids: string[]; format: ExportFormat; policy: string; filename: string; list_only: boolean; use_suffix: boolean; domains: string[]; excluded: string[] }
export interface ExportResult { attribution: string; content: string; filename: string; mime: string; entries: PreviewEntry[]; observed_domains: number; added_rules: number; duplicate_or_covered: number; final_rules: number; warnings: string[] }
export interface RequestFilter { host: string; method: string; type: string; status: string; page: number }
