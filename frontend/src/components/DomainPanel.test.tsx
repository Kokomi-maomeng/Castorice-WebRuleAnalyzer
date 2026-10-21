import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DomainPanel from './DomainPanel';
import type { DomainRecord } from '../types';

afterEach(cleanup);
const domains: DomainRecord[] = [
 { hostname: 'app.example.com', kind: 'domain', first_seen: '2026-10-21T00:00:00Z', request_count: 3, resource_types: ['Document', 'Fetch'], request_ids: ['a', 'b', 'c'], source: 'browser-observed' },
 { hostname: 'cdn.thirdparty.com', kind: 'domain', first_seen: '2026-10-21T00:00:01Z', request_count: 1, resource_types: ['Image'], request_ids: ['d'], source: 'browser-observed' },
 { hostname: '8.8.8.8', kind: 'ipv4', first_seen: '2026-10-21T00:00:02Z', request_count: 1, resource_types: ['Fetch'], request_ids: ['e'], source: 'browser-observed' },
];
describe('观察域名面板', () => {
 it('保留第三方观察域名，IP 不可作为普通域名导出', () => {
  const toggle = vi.fn(); render(<DomainPanel domains={domains} excluded={new Set()} toggle={toggle} mode="observed" setMode={vi.fn()} onExport={vi.fn()} onRequests={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByText('cdn.thirdparty.com')).toBeInTheDocument(); expect(screen.getByText('已选 2 个域名')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '选择 8.8.8.8' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 cdn.thirdparty.com' })); expect(toggle).toHaveBeenCalledWith('cdn.thirdparty.com');
 });
 it('合并模式仍然只展示传入的观察清单，域名可跳转关联请求', () => {
  const onRequests = vi.fn(); render(<DomainPanel domains={domains} excluded={new Set(['cdn.thirdparty.com'])} toggle={vi.fn()} mode="merged" setMode={vi.fn()} onExport={vi.fn()} onRequests={onRequests} notify={vi.fn()} />);
  expect(screen.getByText('已选 1 个域名')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'app.example.com' })); expect(onRequests).toHaveBeenCalledWith('app.example.com');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索域名' }), { target: { value: 'missing' } }); expect(screen.getByText('没有匹配的域名')).toBeInTheDocument();
 });
});
