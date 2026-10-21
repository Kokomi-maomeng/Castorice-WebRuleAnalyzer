import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, Link, Stack, TextField, Typography } from '@mui/material';
import { CloseRounded, CloudDownloadRounded, RefreshRounded } from '@mui/icons-material';
import type { RuleCategory, RuleSource } from '../types';
import { api } from '../services/api';
import { date, errorMessage } from '../utils/format';
interface Props {
    onClose: () => void;
    notify: (s: string) => void;
    onRematch: () => void;
}
const names: Record<string, string> = { not_initialized: '尚未初始化', syncing: '正在同步', ready: '缓存可用', error: '同步失败', cached: '更新失败，使用旧缓存', cache_invalid: '缓存校验失败' };
export default function RuleLibrary(p: Props) {
    const [sources, setSources] = useState<RuleSource[]>([]);
    const [categories, setCategories] = useState<RuleCategory[]>([]);
    const [busy, setBusy] = useState('');
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(60);
    const [error, setError] = useState('');
    async function reload() { const [s, c] = await Promise.all([api<RuleSource[]>('/rules/sources'), api<RuleCategory[]>('/rules/categories')]); setSources(s); setCategories(c); }
    useEffect(() => { void reload().catch(e => setError(errorMessage(e))); }, []);
    async function sync(id: string) { setBusy(id); setError(''); const polling = setInterval(() => { void api<RuleSource[]>('/rules/sources').then(setSources).catch(() => undefined); }, 2000); try {
        await api('/rules/sync', 'POST', { source: id });
        await reload();
        p.notify('规则库已同步并保存到本地');
        p.onRematch();
    }
    catch (e) {
        setError(errorMessage(e));
        await reload().catch(() => undefined);
    }
    finally {
        clearInterval(polling);
        setBusy('');
    } }
    async function load(id: string) { setBusy(id); setError(''); try {
        await api('/rules/load', 'POST', { id });
        await reload();
        p.onRematch();
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy('');
    } }
    const filtered = categories.filter(c => (c.name + ' ' + c.source).toLowerCase().includes(query.toLowerCase()));
    return <Dialog open fullWidth maxWidth="md" onClose={p.onClose}><DialogTitle>开源规则库<IconButton aria-label="关闭规则库" onClick={p.onClose} sx={{ float: 'right' }}><CloseRounded /></IconButton></DialogTitle><DialogContent dividers>
  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>按来源独立索引，保留分类、Commit 和原始匹配类型。更新失败时已有缓存仍然可用。</Typography>
  {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
  <Stack sx={{ gap: 2 }}>{sources.map(source => <Box key={source.id} sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 3 }}>
   <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}><Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 650 }}>{source.name}</Typography><Chip label={names[source.status] || source.status} color={source.status === 'ready' ? 'success' : source.status === 'cached' || source.status === 'error' ? 'warning' : 'default'}/><Button startIcon={busy === source.id ? <CircularProgress size={16}/> : <RefreshRounded />} disabled={!!busy || source.status === 'syncing'} onClick={() => void sync(source.id)}>{source.version ? '更新' : '初始化'}</Button></Stack>
   <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{source.loaded_count} / {source.category_count} 个分类已加载 · {source.license}</Typography>
   <Typography variant="caption" color="text.secondary" sx={{ mt: .7, display: "block" }}>上次成功：{date(source.updated_at)} · Commit {source.version ? source.version.slice(0, 12) : '—'}</Typography>
   <Link href={source.repository} target="_blank" rel="noreferrer" variant="caption">上游仓库与许可证</Link>
   {source.id === 'blackmatrix7' && <Typography variant="caption" color="text.secondary" sx={{ mt: .7, display: "block" }}>先加载常用应用分类，其余按需下载；使用前请阅读上游 GPL-2.0 及附加声明。</Typography>}
   {source.license_text && <Box component="details" sx={{ mt: 1, fontSize: 12 }}><summary style={{ cursor: 'pointer' }}>查看已缓存的许可证原文</summary><Box component="pre" sx={{ maxHeight: 180, overflow: 'auto', mt: 1, fontSize: 11 }}>{source.license_text}</Box></Box>}{source.error && <Alert severity="warning" sx={{ mt: 1 }}>{source.error}</Alert>}
  </Box>)}</Stack>
  <Divider sx={{ my: 2.5 }}/><TextField fullWidth placeholder="搜索分类，如 Gemini、OpenAI、YouTube" value={query} onChange={e => { setQuery(e.target.value); setLimit(60); }} slotProps={{ htmlInput: { 'aria-label': '搜索规则分类' } }}/>
  <Box sx={{ mt: 1, maxHeight: 320, overflow: 'auto' }}>{filtered.slice(0, limit).map(c => <Stack direction="row" key={c.id} sx={{ py: 1.2, borderBottom: 1, borderColor: 'divider', alignItems: "center", gap: 1 }}><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name} <Typography component="span" variant="caption" color="text.secondary">{c.source}</Typography></Typography><Typography variant="caption" color="text.secondary">{c.loaded ? `${c.rule_count} 条可转换规则` : '未加载'}{c.broad ? ' · 通用/大型分类' : ''}{c.warnings?.length ? ` · ${c.warnings.length} 项未转换/解析提示` : ''}</Typography>{c.warnings?.length > 0 && <Box component="details" sx={{ fontSize: 11, color: 'text.secondary' }}><summary>查看解析提示</summary>{c.warnings.slice(0, 20).map((w, i) => <div key={i}>{w}</div>)}{c.warnings.length > 20 && <div>另有 {c.warnings.length - 20} 项</div>}</Box>}</Box>{!c.loaded && <Button size="small" disabled={!!busy} startIcon={busy === c.id ? <CircularProgress size={14}/> : <CloudDownloadRounded />} onClick={() => void load(c.id)}>加载</Button>}</Stack>)}{filtered.length > limit && <Button fullWidth onClick={() => setLimit(v => v + 100)}>继续显示（共 {filtered.length} 类）</Button>}{categories.length === 0 && <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>初始化规则源后，在这里查看真实分类。</Typography>}</Box>
 </DialogContent></Dialog>;
}
