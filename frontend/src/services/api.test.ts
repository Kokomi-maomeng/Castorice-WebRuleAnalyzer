import { afterEach, expect, test, vi } from 'vitest';
import { download } from './api';
afterEach(() => { delete window.castoriceDesktop; vi.unstubAllGlobals(); });
test('desktop saves through authenticated local API and returns real destination', async () => {
 const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { token: 'session' } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ data: { path: 'C:\\App\\exports\\规则.yaml' } }) });
 vi.stubGlobal('fetch', fetcher);
 window.castoriceDesktop = { version: 'v1.1', dataDir: 'C:\\App\\data', exportDir: 'C:\\App\\exports' };
 expect(await download('rules: []', '规则.yaml', 'text/yaml')).toBe('C:\\App\\exports\\规则.yaml');
 expect(fetcher).toHaveBeenCalledWith('/api/desktop/export', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Castorice-Token': 'session' }), body: JSON.stringify({ filename: '规则.yaml', content: 'rules: []' }) }));
});
test('write failure reaches the caller without claiming success', async () => {
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { message: 'disk full' } }) }));
 window.castoriceDesktop = { version: 'v1.1', dataDir: '', exportDir: '' };
 await expect(download('rules: []', 'rules.yaml', 'text/yaml')).rejects.toThrow('disk full');
});
