import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { RefreshRounded } from '@mui/icons-material';
import type { ScanTask } from '../types';
import { active } from '../utils/format';
interface Props { task?: ScanTask; onRematch: () => void; onLibrary: (id?: string) => void; busy: boolean }
export default function MatchPanel(p: Props) {
 const t = p.task;
 const target = t?.matches.filter(m => m.relation === 'target') || [];
 const dependencies = t?.matches.filter(m => m.relation === 'dependency') || [];
 const keywords = t?.matches.filter(m => m.relation === 'keyword') || [];
 const legacy = t?.matches.some(m => !m.relation);
 function results(items: typeof target) { return items.map(m => <Box key={m.category_id} className="match-row" sx={{ border: 1, borderColor: m.suitable ? 'primary.main' : 'divider', borderRadius: 2, p: 1.5, mb: 1 }}>
  <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}><Typography sx={{ fontWeight: 650 }}>{m.category}</Typography><Chip label={m.source} size="small" variant="outlined" />{m.suitable && <Chip label="专属规则" color="success" size="small" />}{m.broad && <Chip label="通用集合" size="small" />}<Button size="small" sx={{ ml: 'auto' }} onClick={() => p.onLibrary(m.category_id)}>查看原文</Button></Stack>
  <Typography variant="caption" color="text.secondary">{m.matched_domains.length} 个观察域名命中 · {m.version.slice(0, 8)}</Typography>
  <Box component="details" sx={{ mt: .5, fontSize: 12 }}><summary>命中依据</summary>{m.reasons.map((r, i) => <Typography variant="caption" key={i} sx={{ display: 'block', mt: .5 }}>{r}</Typography>)}<Box component="ul" sx={{ pl: 2.5, my: 1 }}>{m.evidence?.map(e => <li key={e.hostname}><code>{e.hostname}</code>{e.target ? '（目标）' : ''}<br /><code>{e.rule_type},{e.rule_value}</code></li>)}</Box></Box>
 </Box>); }
 return <Paper component="section" className="match-panel" sx={{ p: 2, minHeight: 0, height: '100%', overflow: 'auto' }}>
  <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}><Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 650 }}>规则命中</Typography><Button size="small" onClick={() => p.onLibrary()}>规则库</Button><Button size="small" startIcon={<RefreshRounded />} onClick={p.onRematch} disabled={!t || active(t) || p.busy}>重新匹配</Button></Stack>
  {!t || active(t) ? <Typography color="text.secondary">扫描结束后查看目标主机与第三方请求的实际规则命中。</Typography> : <>
   <Alert severity={t.recommended_category && !legacy ? 'success' : 'info'} sx={{ mb: 1.5 }}>{legacy ? '历史结果使用旧版算法，请重新匹配。' : t.match_note}</Alert>
   <Typography variant="subtitle2" sx={{ mb: 1 }}>目标主机命中 · {target.length}</Typography>
   {target.length ? results(target) : <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>当前本地缓存没有命中目标主机的域名规则。可在规则库更新后重新匹配。</Typography>}
   {dependencies.length > 0 && <><Typography variant="subtitle2" sx={{ mb: .5 }}>第三方请求命中 · {dependencies.length}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>以下集合仅包含部分第三方依赖，不表示目标属于这些应用。</Typography>{results(dependencies)}</>}
   {keywords.length > 0 && <><Typography variant="subtitle2" sx={{ mb: 1 }}>目标关键词命中 · 需人工核对</Typography>{results(keywords)}</>}
  </>}
 </Paper>;
}
