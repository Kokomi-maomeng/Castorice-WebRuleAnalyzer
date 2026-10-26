import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { CloseRounded, ContentCopyRounded, DownloadRounded } from '@mui/icons-material';
import type { DomainRecord, ExportFormat, ExportJob, ExportResult, RuleCategory, ScanTask, Settings } from '../types';
import { api, copy, download } from '../services/api';
import { errorMessage } from '../utils/format';
interface Props {
    task: ScanTask;
    domains: DomainRecord[];
    mode: 'observed' | 'merged';
    settings: Settings;
    onClose: () => void;
    notify: (s: string) => void;
    onRematch: () => void;
}
export default function ExportDialog(p: Props) {
    const [mode, setMode] = useState(p.mode);
    const [format, setFormat] = useState<ExportFormat>(p.settings.export_format);
    const [policy, setPolicy] = useState(p.settings.policy);
    const [filename, setFilename] = useState('castorice-rules');
    const [suffix, setSuffix] = useState(false);
    const [listOnly, setListOnly] = useState(false);
    const [categories, setCategories] = useState<RuleCategory[]>([]);
    const [categoryIDs, setCategoryIDs] = useState<string[]>(p.task.matches.some(m => m.category_id === p.task.recommended_category && m.relation === 'target' && m.suitable) ? [p.task.recommended_category!] : []);
    const [excluded, setExcluded] = useState<string[]>([]);
    const [result, setResult] = useState<ExportResult>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingCategory, setLoadingCategory] = useState(false);
    const [tab, setTab] = useState(0);
    const [previewLimit, setPreviewLimit] = useState(200);
    const [query, setQuery] = useState('');
    useEffect(() => { void api<RuleCategory[]>('/rules/categories').then(setCategories).catch(e => setError(errorMessage(e))); }, []);
    const job = useMemo<ExportJob>(() => ({ task_id: p.task.id, mode, category_ids: categoryIDs, format, policy, filename, list_only: listOnly, use_suffix: suffix, domains: p.domains.map(d => d.hostname), excluded }), [p.task.id, p.domains, mode, categoryIDs, format, policy, filename, listOnly, suffix, excluded]);
    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setError('');
        const timer = setTimeout(() => { if (mode === 'merged' && !categoryIDs.length) {
            setResult(undefined);
            setLoading(false);
            return;
        } void api<ExportResult>('/export', 'POST', job).then(r => { if (!disposed)
            setResult(r); }).catch(e => { if (!disposed) {
            setError(errorMessage(e));
        } }).finally(() => { if (!disposed)
            setLoading(false); }); }, 280);
        return () => { disposed = true; clearTimeout(timer); };
    }, [job, mode, categoryIDs]);
    async function choose(values: RuleCategory[]) {
        setLoadingCategory(true);
        setError('');
        try {
            const resolved: RuleCategory[] = [];
            for (const c of values)
                resolved.push(c.loaded ? c : await api<RuleCategory>('/rules/load', 'POST', { id: c.id }));
            setCategoryIDs(resolved.map(c => c.id));
            setCategories(old => old.map(c => resolved.find(r => r.id === c.id) || c));
            p.onRematch();
        }
        catch (e) {
            setError(errorMessage(e));
        }
        finally {
            setLoadingCategory(false);
        }
    }
    const entries = result?.entries.filter(e => (e.rule_type + ',' + e.rule_value).toLowerCase().includes(query.toLowerCase())) || [];
    const fresh = !loading && !loadingCategory && !error && !!result;
    return <Dialog open onClose={p.onClose} maxWidth="lg" fullWidth><DialogTitle>预览与导出规则<IconButton aria-label="关闭导出" onClick={p.onClose} sx={{ float: 'right' }}><CloseRounded /></IconButton></DialogTitle><DialogContent dividers>
  <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap" }}>
   <TextField select label="导出范围" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setExcluded([]); }} sx={{ flex: 1, minWidth: 185 }}><MenuItem value="observed">仅抓取结果</MenuItem><MenuItem value="merged">抓取 + 开源规则库</MenuItem></TextField>
   <TextField select label="输出格式" value={format} onChange={e => setFormat(e.target.value as ExportFormat)} sx={{ flex: 1, minWidth: 200 }}><MenuItem value="clash">Clash / Mihomo YAML</MenuItem><MenuItem value="provider">Mihomo Rule Provider</MenuItem><MenuItem value="singbox">sing-box Source Rule Set v3</MenuItem></TextField>
   <TextField label="策略组名称" value={policy} onChange={e => setPolicy(e.target.value)} disabled={format !== 'clash'} sx={{ width: 150 }}/>
   <TextField label="文件名称（自动扩展名）" value={filename} onChange={e => setFilename(e.target.value)} sx={{ flex: 1, minWidth: 180 }}/>
  </Stack>
  {mode === 'merged' && <Box sx={{ mt: 2 }}><Autocomplete multiple options={categories} value={categories.filter(c => categoryIDs.includes(c.id))} disabled={loadingCategory} getOptionLabel={c => `${c.name} · ${c.source}${c.loaded ? ` · ${c.rule_count} 条` : ' · 按需下载'}`} isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(_, values) => void choose(values)} renderInput={params => <TextField {...params} label="选择真实规则分类（未加载的分类将按需下载）"/>} renderOption={(props, option) => { const { key, ...rest } = props; return <li key={key} {...rest}>{option.name} · {option.source}{option.broad ? ' · 通用/大型分类' : ''}{option.loaded ? ` · ${option.rule_count} 条` : ' · 按需下载'}</li>; }}/>{loadingCategory && <Typography variant="caption">正在下载并验证分类…</Typography>}{!categoryIDs.length && <Alert severity="info" sx={{ mt: 1.5 }}>未自动选定可靠分类。可手动选择，或切换为仅抓取结果。未初始化时请先到“规则库”同步来源。</Alert>}</Box>}
  <Stack direction="row" sx={{ mt: 1, gap: 3, flexWrap: "wrap" }}><FormControlLabel control={<Checkbox checked={suffix} onChange={(_, checked) => { setSuffix(checked); setExcluded([]); }}/>} label={<Typography variant="body2">主动扩大观察域名为 DOMAIN-SUFFIX</Typography>}/><FormControlLabel control={<Checkbox checked={listOnly} disabled={format !== 'clash'} onChange={(_, checked) => setListOnly(checked)}/>} label={<Typography variant="body2">只输出规则列表（不含 rules:）</Typography>}/></Stack>
  {suffix && <Alert severity="warning" sx={{ mb: 1 }}>后缀匹配会包含观察域名的全部子域名；默认精确 DOMAIN 更保守。</Alert>}
  {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
  {result && <><Stack direction="row" sx={{ my: 1.5, gap: 1, flexWrap: "wrap" }}><Chip label={`本次抓取 ${result.observed_domains} 个域名`}/><Chip label={`规则库补充 ${result.added_rules} 条规则`}/><Chip label={`重复或被覆盖 ${result.duplicate_or_covered} 条`}/><Chip label={`最终导出 ${result.final_rules} 条规则`} color="primary"/></Stack>{result.warnings.map((w, i) => <Alert key={i} severity="warning" sx={{ my: 1 }}>{w}</Alert>)}</>}
  <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ borderBottom: 1, borderColor: 'divider' }}><Tab label="条目与来源"/><Tab label="文件内容"/></Tabs>
  {loading && <Stack direction="row" sx={{ p: 2, gap: 1, alignItems: "center" }}><CircularProgress size={17}/><Typography variant="body2">正在计算合并与覆盖关系…</Typography></Stack>}
  {result && tab === 0 && <><TextField placeholder="过滤预览条目" value={query} onChange={e => { setQuery(e.target.value); setPreviewLimit(200); }} fullWidth sx={{ mt: 1.5 }}/><TableContainer sx={{ height: 330 }}><Table size="small" stickyHeader><TableHead><TableRow><TableCell padding="checkbox">选择</TableCell><TableCell>类型 / 域名</TableCell><TableCell>来源与覆盖关系</TableCell></TableRow></TableHead><TableBody>{entries.slice(0, previewLimit).map(entry => { const key = `${entry.rule_type},${entry.rule_value}`; return <TableRow key={key}><TableCell padding="checkbox"><Checkbox size="small" checked={!excluded.includes(key)} slotProps={{ input: { 'aria-label': `导出 ${key}` } }} onChange={(_, checked) => setExcluded(old => checked ? old.filter(k => k !== key) : [...old, key])}/></TableCell><TableCell sx={{ maxWidth: 400, overflowWrap: 'anywhere' }}><code>{key}</code>{entry.risk && <Typography color="warning.main" variant="caption" sx={{ display: "block" }}>{entry.risk}</Typography>}</TableCell><TableCell><Chip label={entry.label} color={entry.label === '本次抓取' ? 'default' : 'secondary'} variant="outlined"/><Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{entry.origins.filter(o => o.source !== 'observed').map(o => `${o.source}/${o.source_category} @ ${o.source_version.slice(0, 8)}`).join('；')}</Typography>{entry.covered_by && <Typography variant="caption" color="text.secondary">由 {entry.covered_by} 覆盖，不重复输出。取消上层规则后会恢复。</Typography>}</TableCell></TableRow>; })}</TableBody></Table></TableContainer>{entries.length > previewLimit && <Button onClick={() => setPreviewLimit(v => v + 200)}>继续显示（共 {entries.length} 条）</Button>}</>}
  {result && tab === 1 && <Box component="pre" sx={{ p: 2, mt: 1, height: 350, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 2, fontSize: 12 }}>{result.content}</Box>}
 </DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={p.onClose}>取消</Button>{fresh && result?.attribution && <Button onClick={() => void download(result.attribution, result.filename + '.sources.txt', 'text/plain').then(path => p.notify(path ? '已保存至 ' + path : '已生成来源说明')).catch(e => p.notify(errorMessage(e)))}>下载来源说明</Button>}<Button startIcon={<ContentCopyRounded />} disabled={!fresh} onClick={() => void copy(result!.content).then(() => p.notify('规则已复制')).catch(e => p.notify(errorMessage(e)))}>复制内容</Button><Button variant="contained" startIcon={<DownloadRounded />} disabled={!fresh} onClick={() => void download(result!.content, result!.filename, result!.mime).then(path => p.notify(path ? `已保存至 ${path}` : `已生成 ${result!.filename}`)).catch(e => p.notify(errorMessage(e)))}>{window.castoriceDesktop ? '保存到软件目录' : '下载文件'}</Button></DialogActions></Dialog>;
}
