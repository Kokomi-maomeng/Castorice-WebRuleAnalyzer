import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from '@mui/material';
import { CloseRounded, OpenInNewRounded, RefreshRounded } from '@mui/icons-material';
import type { ScanTask } from '../types';
import { api } from '../services/api';
import { date, errorMessage, modeNames, statusNames } from '../utils/format';
interface Props {
    onClose: () => void;
    onOpen: (task: ScanTask) => void;
}
export default function HistoryDialog(p: Props) {
    const [tasks, setTasks] = useState<ScanTask[]>([]);
    const [error, setError] = useState('');
    function reload() { void api<ScanTask[]>('/scans').then(setTasks).catch(e => setError(errorMessage(e))); }
    useEffect(reload, []);
    return <Dialog open fullWidth maxWidth="md" onClose={p.onClose}><DialogTitle>扫描历史<IconButton aria-label="刷新历史" onClick={reload} sx={{ ml: 1 }}><RefreshRounded /></IconButton><IconButton aria-label="关闭历史" onClick={p.onClose} sx={{ float: 'right' }}><CloseRounded /></IconButton></DialogTitle><DialogContent dividers>{error && <Alert severity="error">{error}</Alert>}<Typography variant="caption" color="text.secondary">最近 100 次任务。打开后可查看观察域名、请求、页面覆盖和匹配版本，并重新导出。</Typography><Stack sx={{ mt: 2, gap: 1.5 }}>{tasks.map(t => <Stack direction="row" key={t.id} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, alignItems: "center", gap: 2 }}><Stack sx={{ flex: 1, minWidth: 0, gap: .8 }}><Typography sx={{ overflowWrap: 'anywhere', fontWeight: 600 }}>{t.target_url}</Typography><Typography variant="caption" color="text.secondary">{date(t.started_at)} · {modeNames[t.options.mode]} · {t.domain_count} 个域名 · {t.request_count} 条请求</Typography><Stack direction="row" sx={{ gap: 1 }}><Chip label={statusNames[t.status] || t.status} variant="outlined"/>{t.recommended_category && <Chip label={t.recommended_category} color="secondary" variant="outlined"/>}</Stack></Stack><Button size="small" startIcon={<OpenInNewRounded />} onClick={() => { p.onOpen(t); p.onClose(); }}>打开</Button></Stack>)}{!tasks.length && <Typography color="text.secondary" sx={{ p: 5, textAlign: "center" }}>还没有扫描历史</Typography>}</Stack></DialogContent></Dialog>;
}
