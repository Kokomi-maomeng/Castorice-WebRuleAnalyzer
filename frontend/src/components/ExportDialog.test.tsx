import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExportDialog from './ExportDialog';
import { defaultSettings } from '../utils/format';
import type { DomainRecord, ExportResult, ScanTask } from '../types';
const { mockAPI } = vi.hoisted(() => ({ mockAPI: vi.fn() }));
vi.mock('../services/api', () => ({ api: mockAPI, copy: vi.fn(), download: vi.fn() }));
const task: ScanTask = { id: 'test', target_url: 'https://example.com', status: 'completed', options: defaultSettings.scan, started_at: '2026-10-21T00:00:00Z', domain_count: 1, ip_count: 0, request_count: 1, pages: [], matches: [] };
const domains: DomainRecord[] = [{ hostname: 'example.com', kind: 'domain', first_seen: task.started_at, request_count: 1, resource_types: ['Document'], request_ids: ['a'], source: 'browser-observed' }];
const output: ExportResult = { attribution: '', content: 'rules:\n  - DOMAIN,example.com,dibao\n', filename: 'rules.yaml', mime: 'application/yaml', observed_domains: 1, added_rules: 0, duplicate_or_covered: 0, final_rules: 1, warnings: [], entries: [{ rule_type: 'DOMAIN', rule_value: 'example.com', label: '本次抓取', selected: true, origins: [] }] };
beforeEach(() => { mockAPI.mockReset(); mockAPI.mockImplementation(async (path: string, _method: string, body: { excluded?: string[] }) => { if (path === '/rules/categories') return []; if (body.excluded?.length) throw new Error('没有可导出的已选择域名规则'); return output; }); });
afterEach(cleanup);
describe('导出预览', () => {
 it('全部取消后仍可恢复条目，错误时禁止下载旧内容', async () => {
  render(<ExportDialog task={task} domains={domains} mode="observed" settings={defaultSettings} onClose={vi.fn()} notify={vi.fn()} onRematch={vi.fn()} />);
  const checkbox = await screen.findByRole('checkbox', { name: '导出 DOMAIN,example.com' }); await waitFor(() => expect(screen.getByRole('button', { name: '下载文件' })).toBeEnabled());
  fireEvent.click(checkbox); await screen.findByText('没有可导出的已选择域名规则'); expect(screen.getByRole('button', { name: '下载文件' })).toBeDisabled(); expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox); await waitFor(() => expect(screen.getByRole('button', { name: '下载文件' })).toBeEnabled()); expect(checkbox).toBeChecked();
 });
 it('低置信度合并不自动选择分类或调用导出', async () => {
  render(<ExportDialog task={task} domains={domains} mode="merged" settings={defaultSettings} onClose={vi.fn()} notify={vi.fn()} onRematch={vi.fn()} />);
  expect(await screen.findByText(/未自动选定可靠分类/)).toBeInTheDocument(); await new Promise(resolve => setTimeout(resolve, 400)); expect(mockAPI.mock.calls.some(([path]) => path === '/export')).toBe(false); expect(screen.getByRole('button', { name: '下载文件' })).toBeDisabled();
 });
});
