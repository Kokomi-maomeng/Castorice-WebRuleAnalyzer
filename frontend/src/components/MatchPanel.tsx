import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { AutoAwesomeRounded, RefreshRounded } from '@mui/icons-material';
import type { ScanTask } from '../types';
import { active } from '../utils/format';
interface Props {
    task?: ScanTask;
    onRematch: () => void;
    onLibrary: () => void;
    busy: boolean;
}
export default function MatchPanel(p: Props) {
    const t = p.task;
    return <Paper sx={{ p: 2.5, border: 1, borderColor: 'divider', mt: 2.5 }}>
  <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}><AutoAwesomeRounded color="primary"/><Typography variant="h6" sx={{ flex: 1 }}>规则库匹配</Typography><Button size="small" onClick={p.onLibrary}>管理规则库</Button><Button size="small" startIcon={<RefreshRounded />} onClick={p.onRematch} disabled={!t || active(t) || p.busy}>重新匹配</Button></Stack>
  {!t || active(t) ? <Typography color="text.secondary" sx={{ mt: 1.5 }}>扫描完成后，从已加载的真实规则分类中寻找匹配。默认导出仍为仅抓取结果。</Typography> : <>
   <Alert severity={t.recommended_category ? 'success' : 'info'} sx={{ mt: 1.5 }}>{t.match_note || '未加载规则库，仍可导出本次观察域名。'}</Alert>
   <Stack direction="row" sx={{ mt: t.matches.length ? 2 : 0, gap: 1.5, flexWrap: "wrap" }}>{t.matches.slice(0, 6).map(m => <Box key={m.category_id} sx={{ flex: '1 1 240px', maxWidth: 460, border: 1, borderColor: t.recommended_category === m.category_id ? 'primary.main' : 'divider', p: 2, borderRadius: 3 }}>
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}><Typography sx={{ flex: 1, fontWeight: 650 }}>{m.category}</Typography><Typography color="primary" sx={{ fontWeight: 700 }}>{m.score} 分</Typography></Stack>
    <Stack direction="row" sx={{ my: 1, gap: .7 }}><Chip label={m.source}/><Chip variant="outlined" color={m.suitable ? 'success' : 'default'} label={m.confidence === 'high' ? '高置信度' : m.confidence === 'medium' ? '中置信度' : '低置信度'}/>{m.broad && <Chip label="通用分类" color="warning" variant="outlined"/>}</Stack>
    <Typography variant="caption" color="text.secondary">命中 {m.matched_domains.length} 个观察域名 · 覆盖 {(m.coverage * 100).toFixed(0)}% · {m.version.slice(0, 8)}</Typography>
    <Box component="details" sx={{ mt: 1, fontSize: 12 }}><summary style={{ cursor: 'pointer' }}>查看匹配依据</summary>{m.reasons.map((r, i) => <Typography variant="caption" key={i} sx={{ mt: .6, display: "block" }}>{r}</Typography>)}<Typography variant="caption" sx={{ overflowWrap: 'anywhere', mt: .5, display: "block" }}>{m.matched_domains.join('、')}</Typography></Box>
   </Box>)}</Stack>
  </>}
 </Paper>;
}
