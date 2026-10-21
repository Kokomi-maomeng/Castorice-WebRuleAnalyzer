import { useMemo, useState } from 'react';
import { Box, Button, Checkbox, Chip, Divider, FormControlLabel, IconButton, InputAdornment, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { ContentCopyRounded, DownloadRounded, PublicRounded, SearchRounded, TravelExploreRounded } from '@mui/icons-material';
import type { DomainRecord, ScanTask } from '../types';
import { copy } from '../services/api';
import { time } from '../utils/format';
interface Props {
    domains: DomainRecord[];
    task?: ScanTask;
    excluded: Set<string>;
    toggle: (h: string) => void;
    mode: 'observed' | 'merged';
    setMode: (m: 'observed' | 'merged') => void;
    onExport: () => void;
    onRequests: (host: string) => void;
    notify: (s: string) => void;
}
export default function DomainPanel(p: Props) {
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('name');
    const [limit, setLimit] = useState(100);
    const list = useMemo(() => p.domains.filter(d => d.hostname.includes(query.toLowerCase())).sort((a, b) => sort === 'count' ? b.request_count - a.request_count : sort === 'time' ? a.first_seen.localeCompare(b.first_seen) : a.hostname.localeCompare(b.hostname)), [p.domains, query, sort]);
    const selected = p.domains.filter(d => d.kind === 'domain' && !p.excluded.has(d.hostname));
    const matched = new Set(p.task?.matches.flatMap(m => m.matched_domains) || []);
    return <Paper component="section" sx={{ border: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', minHeight: 660, overflow: 'hidden' }}>
  <Box sx={{ p: 2.5, pb: 2 }}>
   <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}><Typography variant="h6">观察到的域名</Typography><Chip label={`${p.task?.domain_count || 0} 个`} color="primary" variant="outlined"/></Stack>
   <Typography variant="caption" color="text.secondary">来自本次浏览器请求 · 外部规则仅在导出预览展示</Typography>
   <Stack direction="row" sx={{ mt: 2, gap: 1 }}>
    <TextField placeholder="搜索域名" value={query} onChange={e => { setQuery(e.target.value); setLimit(100); }} fullWidth slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small"/></InputAdornment> }, htmlInput: { 'aria-label': '搜索域名' } }}/>
    <TextField select value={sort} onChange={e => setSort(e.target.value)} slotProps={{ htmlInput: { 'aria-label': '域名排序' } }} sx={{ minWidth: 104 }}><MenuItem value="name">字母顺序</MenuItem><MenuItem value="count">请求次数</MenuItem><MenuItem value="time">发现时间</MenuItem></TextField>
   </Stack>
  </Box>
  <Divider />
  <Box sx={{ flex: 1, maxHeight: 440, minHeight: 280, overflow: 'auto' }}>
   {list.length === 0 ? <Stack sx={{ minHeight: 280, px: 3, color: 'text.secondary', alignItems: "center", justifyContent: "center" }}><Box sx={{ p: 2, borderRadius: '50%', bgcolor: 'action.hover', mb: 2 }}><TravelExploreRounded sx={{ fontSize: 35, color: 'primary.main' }}/></Box><Typography sx={{ fontWeight: 600 }}>{query ? '没有匹配的域名' : '等待首次发现'}</Typography><Typography variant="body2" sx={{ mt: 1, textAlign: 'center' }}>开始分析后，实际请求中的域名会显示在这里。</Typography></Stack> : list.slice(0, limit).map(d => <Box key={d.hostname} sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
    <Checkbox size="small" checked={d.kind === 'domain' && !p.excluded.has(d.hostname)} disabled={d.kind !== 'domain'} onChange={() => p.toggle(d.hostname)} slotProps={{ input: { 'aria-label': `选择 ${d.hostname}` } }}/>
    <Box sx={{ flex: 1, minWidth: 0, ml: .5 }}>
     <Button onClick={() => p.onRequests(d.hostname)} sx={{ p: 0, textAlign: 'left', display: 'block', minWidth: 0, color: 'text.primary', lineHeight: 1.5, borderRadius: 1 }}><span className="domain-name">{d.hostname}</span></Button>
     <Stack direction="row" sx={{ mt: .6, gap: .7, alignItems: "center" }}><Typography variant="caption" color="text.secondary">{d.request_count} 次 · {time(d.first_seen)}</Typography>{d.kind !== 'domain' && <Chip size="small" label={d.kind.toUpperCase()}/>}{matched.has(d.hostname) && <Chip label="规则命中" color="secondary" size="small" variant="outlined"/>}</Stack>
     <Typography variant="caption" color="text.secondary">{d.resource_types.join(' · ')}</Typography>
    </Box>
    <Tooltip title="复制域名"><IconButton size="small" aria-label={`复制 ${d.hostname}`} onClick={() => void copy(d.hostname).then(() => p.notify('域名已复制')).catch(e => p.notify(String(e)))}><ContentCopyRounded sx={{ fontSize: 16 }}/></IconButton></Tooltip>
   </Box>)}
   {list.length > limit && <Button fullWidth onClick={() => setLimit(l => l + 100)}>继续显示（剩余 {list.length - limit} 条）</Button>}
  </Box>
  <Divider />
  <Box sx={{ p: 2.5, bgcolor: 'action.hover' }}>
   <Stack direction="row" sx={{ alignItems: "center", gap: .8 }}><PublicRounded color="primary" sx={{ fontSize: 17 }}/><Typography variant="subtitle2">导出范围</Typography><Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>已选 {selected.length} 个域名</Typography></Stack>
   <RadioGroup value={p.mode} onChange={e => p.setMode(e.target.value as Props['mode'])} sx={{ mt: .8 }}><FormControlLabel value="observed" control={<Radio size="small"/>} label={<Typography variant="body2">仅抓取结果</Typography>}/><FormControlLabel value="merged" control={<Radio size="small"/>} label={<Typography variant="body2">抓取 + 开源规则库</Typography>}/></RadioGroup>
   <Button variant="contained" fullWidth startIcon={<DownloadRounded />} disabled={!selected.length} onClick={p.onExport} sx={{ mt: 1.5 }}>预览与导出规则</Button>
  </Box>
 </Paper>;
}
