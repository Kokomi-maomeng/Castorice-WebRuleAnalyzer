import { useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, IconButton, LinearProgress, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { ArticleRounded, CheckCircleRounded, CloseRounded, ContentCopyRounded, DataObjectRounded, DeleteOutlineRounded, HubRounded, RadioButtonCheckedRounded, RouteRounded } from '@mui/icons-material';
import type { NetworkRequest, RequestFilter, ScanTask, TaskEvent } from '../types';
import { active, modeNames, pageNames, reasonNames, statusNames, time } from '../utils/format';
import { copy } from '../services/api';
interface Props {
    task?: ScanTask;
    requests: NetworkRequest[];
    total: number;
    filter: RequestFilter;
    setFilter: (f: RequestFilter) => void;
    logs: TaskEvent[];
    tab: number;
    setTab: (v: number) => void;
    logLevel: string;
    notify: (s: string) => void;
}
const levels: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
export default function AnalysisPanel(p: Props) {
    const [detail, setDetail] = useState<NetworkRequest>();
    const [logFilter, setLogFilter] = useState('');
    const [cleared, setCleared] = useState(0);
    const [pageLimit, setPageLimit] = useState(20);
    const t = p.task;
    const running = active(t);
    const filteredLogs = p.logs.filter(l => l.id > cleared && (logFilter ? l.level === logFilter : levels[l.level] >= levels[p.logLevel]));
    const filter = (key: keyof RequestFilter, value: string) => p.setFilter({ ...p.filter, page: 0, [key]: value });
    const stageEvents = p.logs.filter(l => ['created', 'browser', 'navigation', 'page_loaded', 'explore', 'interactive', 'extract', 'ended', 'stopping'].includes(l.kind));
    const visited = t?.pages.filter(page => page.status === 'visited').length || 0;
    return <Paper component="section" sx={{ border: 1, borderColor: 'divider', minWidth: 0, minHeight: 660, overflow: 'hidden' }}>
  <Stack direction="row" sx={{ px: 2.5, py: 2, alignItems: "center", justifyContent: "space-between" }}><Typography variant="h6">实时抓取与分析</Typography><Chip size="small" label={t ? statusNames[t.status] || t.status : '就绪'} color={running ? 'primary' : t?.status === 'failed' ? 'error' : t ? 'success' : 'default'} icon={running ? <RadioButtonCheckedRounded sx={{ animation: 'pulse 1.5s infinite' }}/> : <CheckCircleRounded />}/></Stack>
  <Tabs value={p.tab} onChange={(_, value) => p.setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ px: 1.5, borderBottom: 1, borderColor: 'divider' }}><Tab icon={<RouteRounded sx={{ fontSize: 18 }}/>} iconPosition="start" label="抓取流程"/><Tab icon={<HubRounded sx={{ fontSize: 18 }}/>} iconPosition="start" label={`网络请求${t ? ` (${t.request_count})` : ''}`}/><Tab icon={<ArticleRounded sx={{ fontSize: 18 }}/>} iconPosition="start" label="运行日志"/></Tabs>
  {p.tab === 0 && <Box sx={{ p: 2.5 }}>
   {!t ? <Stack sx={{ minHeight: 400, color: 'text.secondary', alignItems: "center", justifyContent: "center" }}><DataObjectRounded sx={{ fontSize: 55, color: 'primary.main', opacity: .5, mb: 2 }}/><Typography variant="h6" color="text.primary">准备好探索一个网站</Typography><Typography sx={{ mt: 1 }}>输入 URL，开始一次独立的浏览器采集。</Typography><Typography variant="caption" sx={{ mt: 2 }}>CDP 网络事件采集 · 非 PCAP 抓包</Typography></Stack> : <>
    <Stack direction="row" sx={{ mb: 2, gap: 1.5 }}>{[['实际域名', t.domain_count], ['网络请求', t.request_count], ['已访问页面', visited]].map(([label, value]) => <Box key={label} sx={{ p: 2, flex: 1, bgcolor: 'action.hover', borderRadius: 3 }}><Typography variant="h5">{value}</Typography><Typography variant="caption" color="text.secondary">{label}</Typography></Box>)}</Stack>
    {running && <LinearProgress sx={{ borderRadius: 2, mb: 2 }}/>}
    {t.test_mode && <Alert severity="warning" sx={{ mb: 2 }}>当前任务启用了显式测试白名单，仅用于本地验收站。</Alert>}{t.error && <Alert severity="error" sx={{ mb: 2 }}>{t.error}</Alert>}
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}><b>当前页面</b>　{t.current_page || t.target_url}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ mt: .8, display: "block" }}>{modeNames[t.options.mode]} · {t.options.max_seconds}s 上限 · {t.browser || '检测浏览器中'} · 独立临时 Profile{t.ip_count > 0 ? ` · 另有 ${t.ip_count} 个 IP 主机` : ''}</Typography>
    {t.end_reason && <Alert icon={<CheckCircleRounded fontSize="small"/>} severity={t.status === 'failed' ? 'warning' : 'info'} sx={{ mt: 2 }}>{reasonNames[t.end_reason] || t.end_reason}。本次扫描仅代表实际访问和观察范围。</Alert>}
    <Stack sx={{ mt: 2, maxHeight: 235, overflow: 'auto', gap: 1.2 }}>{stageEvents.slice(-15).map((e, index, arr) => <Stack key={e.id} direction="row" sx={{ gap: 1.2, alignItems: "flex-start" }}><Box sx={{ mt: .5, width: 8, height: 8, flexShrink: 0, borderRadius: '50%', bgcolor: index === arr.length - 1 && running ? 'primary.main' : 'secondary.main' }}/><Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{e.message}</Typography><Typography variant="caption" color="text.secondary">{time(e.time)}</Typography></Box></Stack>)}</Stack>
    {t.pages.length > 0 && <><Divider sx={{ my: 2 }}/><Typography variant="subtitle2" sx={{ mb: 1 }}>页面覆盖记录 · {t.pages.length} 条</Typography><TableContainer sx={{ maxHeight: 220 }}><Table size="small"><TableBody>{t.pages.slice(0, pageLimit).map((page, i) => <TableRow key={i}><TableCell sx={{ maxWidth: 360, overflowWrap: 'anywhere' }}><Typography variant="caption">{page.url}</Typography>{page.reason && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{page.reason}</Typography>}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}><Chip variant="outlined" label={pageNames[page.status] || page.status} color={page.status === 'visited' ? 'success' : 'default'}/></TableCell><TableCell>{page.depth}</TableCell></TableRow>)}</TableBody></Table></TableContainer>{t.pages.length > pageLimit && <Button size="small" onClick={() => setPageLimit(v => v + 50)}>显示更多页面</Button>}</>}
   </>}
  </Box>}
  {p.tab === 1 && <Box>
   <Stack direction="row" sx={{ p: 2, gap: 1, flexWrap: "wrap" }}>
    <TextField label="域名过滤" value={p.filter.host} onChange={e => filter('host', e.target.value)} sx={{ flex: 2, minWidth: 140 }}/>
    <TextField select label="方法" value={p.filter.method} onChange={e => filter('method', e.target.value)} sx={{ flex: 1, minWidth: 95 }}>{['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map(v => <MenuItem value={v} key={v}>{v || '全部'}</MenuItem>)}</TextField>
    <TextField select label="类型" value={p.filter.type} onChange={e => filter('type', e.target.value)} sx={{ flex: 1, minWidth: 115 }}>{['', 'Document', 'Fetch', 'XHR', 'Script', 'Stylesheet', 'Image', 'Font', 'WebSocket', 'Media', 'Other'].map(v => <MenuItem value={v} key={v}>{v || '全部'}</MenuItem>)}</TextField>
    <TextField select label="状态" value={p.filter.status} onChange={e => filter('status', e.target.value)} sx={{ flex: 1, minWidth: 100 }}>{[['', '全部'], ['2', '2xx'], ['3', '3xx'], ['4', '4xx'], ['5', '5xx'], ['failed', '连接失败']].map(([v, label]) => <MenuItem value={v} key={v}>{label}</MenuItem>)}</TextField>
   </Stack>
   <TableContainer sx={{ maxHeight: 450, minHeight: 330 }}><Table stickyHeader size="small" sx={{ '& td': { py: 1.3, cursor: 'pointer' } }}><TableHead><TableRow>{['时间', 'Method', 'Host', 'Type', 'Status', '耗时'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{p.requests.map(req => <TableRow hover key={req.id} onClick={() => setDetail(req)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter')
            setDetail(req); }}><TableCell sx={{ whiteSpace: 'nowrap' }}>{time(req.time)}</TableCell><TableCell><Typography variant="caption" color={req.method === 'GET' ? 'secondary.main' : 'primary.main'} sx={{ fontWeight: 700 }}>{req.method}</Typography></TableCell><TableCell sx={{ maxWidth: 240, overflowWrap: 'anywhere' }}><span className="domain-name">{req.hostname}</span></TableCell><TableCell>{req.resource_type}</TableCell><TableCell sx={{ color: req.state === 'failed' || (req.status_code || 0) >= 400 ? 'error.main' : 'text.primary' }}>{req.status_code || (req.state === 'failed' ? '失败' : '等待')}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{req.duration_ms === undefined ? '—' : `${req.duration_ms.toFixed(0)} ms`}</TableCell></TableRow>)}{!p.requests.length && <TableRow><TableCell colSpan={6} align="center" sx={{ height: 250, color: 'text.secondary' }}>暂无符合条件的请求</TableCell></TableRow>}</TableBody></Table></TableContainer>
   <TablePagination component="div" count={p.total} page={Math.min(p.filter.page, Math.max(0, Math.ceil(p.total / 50) - 1))} onPageChange={(_, page) => p.setFilter({ ...p.filter, page })} rowsPerPage={50} rowsPerPageOptions={[50]} labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count} 条`}/>
  </Box>}
  {p.tab === 2 && <Box sx={{ p: 2 }}>
   <Stack direction="row" sx={{ mb: 2, gap: 1, alignItems: "center" }}><TextField select label="日志级别" value={logFilter} onChange={e => setLogFilter(e.target.value)} sx={{ width: 140 }}><MenuItem value="">默认（{p.logLevel}+）</MenuItem>{['DEBUG', 'INFO', 'WARN', 'ERROR'].map(l => <MenuItem value={l} key={l}>{l}</MenuItem>)}</TextField><Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>最近 2,000 条</Typography><Tooltip title="清空当前显示"><IconButton aria-label="清空日志显示" onClick={() => setCleared(p.logs.at(-1)?.id || 0)}><DeleteOutlineRounded /></IconButton></Tooltip><Tooltip title="复制当前日志"><IconButton aria-label="复制日志" onClick={() => void copy(filteredLogs.map(l => `${l.time} [${l.level}] ${l.message}`).join('\n')).then(() => p.notify('日志已复制')).catch(e => p.notify(String(e)))}><ContentCopyRounded /></IconButton></Tooltip></Stack>
   <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 1.5, height: 430, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 12 }}>{filteredLogs.length ? filteredLogs.map(l => <Box key={l.id} sx={{ py: .5, display: 'flex', gap: 1 }}><Box component="span" sx={{ flexShrink: 0, color: 'text.secondary' }}>{time(l.time)}</Box><Box component="span" sx={{ flexShrink: 0, width: 40, color: l.level === 'ERROR' ? 'error.main' : l.level === 'WARN' ? 'warning.main' : 'secondary.main' }}>{l.level}</Box><Box component="span" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{l.message}</Box></Box>) : <Typography variant="body2" color="text.secondary">暂无日志</Typography>}</Box>
  </Box>}
  <Dialog open={!!detail} onClose={() => setDetail(undefined)} fullWidth maxWidth="md"><DialogTitle>请求详情<IconButton aria-label="关闭请求详情" onClick={() => setDetail(undefined)} sx={{ float: 'right' }}><CloseRounded /></IconButton></DialogTitle><DialogContent dividers><Alert severity="info" sx={{ mb: 2 }}>查询参数值已脱敏；不记录请求头、Cookie、认证信息或正文。远端 IP 为浏览器报告值，可能是本地保护代理端点。</Alert>{detail && <Table size="small"><TableBody>{Object.entries({ '请求 ID': detail.id, '时间': detail.time, 'URL（脱敏）': detail.url, '方法': detail.method, '域名 / 主机': detail.hostname, '协议': detail.protocol || detail.scheme, '类型': detail.resource_type, '状态码': detail.status_code || '未获取', '请求状态': detail.state, '耗时': detail.duration_ms === undefined ? '未完成或未提供' : `${detail.duration_ms.toFixed(2)} ms`, '浏览器报告远端 IP': detail.remote_ip || '未提供', '来源页面': detail.source_page || '未提供', 'Initiator': detail.initiator || '未提供', '失败原因': detail.failure || '—', '任务 ID': detail.task_id }).map(([label, value]) => <TableRow key={label}><TableCell sx={{ width: 160 }}>{label}</TableCell><TableCell sx={{ overflowWrap: 'anywhere' }}><code>{value}</code></TableCell></TableRow>)}</TableBody></Table>}</DialogContent></Dialog>
 </Paper>;
}
