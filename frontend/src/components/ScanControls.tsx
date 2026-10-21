import { useState } from 'react';
import { Box, Button, CircularProgress, Collapse, FormControlLabel, InputAdornment, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { ArrowForwardRounded, ExpandMoreRounded, LinkRounded, StopRounded, TuneRounded } from '@mui/icons-material';
import type { ScanOptions } from '../types';
import { modeNames } from '../utils/format';
interface Props {
    url: string;
    setURL: (v: string) => void;
    options: ScanOptions;
    setOptions: (v: ScanOptions) => void;
    running: boolean;
    busy: boolean;
    onStart: () => void;
    onStop: () => void;
}
export default function ScanControls(p: Props) {
    const [advanced, setAdvanced] = useState(false);
    const set = <K extends keyof ScanOptions>(key: K, value: ScanOptions[K]) => p.setOptions({ ...p.options, [key]: value });
    const number = (label: string, key: keyof ScanOptions, min: number, max: number) => <TextField label={label} type="number" value={p.options[key]} onChange={e => set(key, Number(e.target.value))} slotProps={{ htmlInput: { min, max } }} disabled={p.running} sx={{ minWidth: 130, flex: 1 }}/>;
    return <Paper component="section" sx={{ p: { xs: 2.5, md: 4 }, background: theme => theme.palette.mode === 'dark' ? 'linear-gradient(120deg,#262031,#1e2425)' : 'linear-gradient(115deg,#f0eafb,#edf5f1)', border: 1, borderColor: 'divider' }}>
  <Box sx={{ maxWidth: 930, mx: 'auto' }}>
   <Typography variant="h5" sx={{ mb: .8 }}>从一次访问，看清网站的网络依赖</Typography>
   <Typography color="text.secondary" sx={{ mb: 2.7 }}>采集实际请求、识别域名，生成可核对的分流规则。</Typography>
   <Box component="form" onSubmit={e => { e.preventDefault(); if (!p.running && !p.busy)
        p.onStart(); }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5 }}>
     <TextField fullWidth label="要分析的网站" placeholder="输入网址，如 example.com" value={p.url} disabled={p.running} onChange={e => p.setURL(e.target.value)} autoComplete="off" slotProps={{ input: { startAdornment: <InputAdornment position="start"><LinkRounded color="primary"/></InputAdornment> } }} sx={{ '& .MuiOutlinedInput-root': { height: 56, bgcolor: 'background.paper', borderRadius: 3 } }}/>
     {p.running ? <Button variant="contained" color="error" startIcon={<StopRounded />} onClick={p.onStop} disabled={p.busy} sx={{ minWidth: 150 }}>停止采集</Button> : <Button type="submit" variant="contained" endIcon={p.busy ? <CircularProgress size={18} color="inherit"/> : <ArrowForwardRounded />} disabled={p.busy || !p.url.trim()} sx={{ minWidth: 150, minHeight: 50 }}>开始分析</Button>}
    </Stack>
   </Box>
   <Stack direction="row" sx={{ mt: 2.5, gap: 2, alignItems: "center", flexWrap: "wrap" }}>
    <TextField select label="扫描模式" value={p.options.mode} onChange={e => set('mode', e.target.value as ScanOptions['mode'])} disabled={p.running} sx={{ width: 155 }}>{Object.entries(modeNames).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}</TextField>
    <Typography color="text.secondary" variant="body2">上限 {p.options.max_seconds} 秒{p.options.mode === 'explore' ? ` · 深度 ${p.options.max_depth} · ${p.options.max_pages} 页` : p.options.mode === 'interactive' ? ' · 可见浏览器，手动操作' : ' · 单页异步请求观察'}</Typography>
    <Button size="small" startIcon={<TuneRounded />} endIcon={<ExpandMoreRounded sx={{ transform: advanced ? 'rotate(180deg)' : '' }}/>} onClick={() => setAdvanced(v => !v)} sx={{ ml: 'auto' }}>高级设置</Button>
   </Stack>
   <Collapse in={advanced}>
    <Stack direction="row" sx={{ mt: 2.5, gap: 1.5, flexWrap: "wrap" }}>
     {number('总时长上限 / 秒', 'max_seconds', 1, 3600)}{number('探索深度', 'max_depth', 0, 8)}{number('最多页面', 'max_pages', 1, 200)}{number('导航超时 / 秒', 'navigation_seconds', 1, 120)}
    </Stack>
    <Stack direction="row" sx={{ mt: 2, gap: 1.5, flexWrap: "wrap" }}>
     {number('每页观察上限 / 秒', 'observe_seconds', 1, 300)}{number('静默等待 / 毫秒', 'quiet_millis', 100, 30000)}{number('页面间隔 / 毫秒', 'interval_millis', 0, 30000)}
     <TextField select label="DNS 解析" value={p.options.dns_mode || 'auto'} disabled={p.running} onChange={e => set('dns_mode', e.target.value as 'auto' | 'system')} sx={{ minWidth: 215 }}><MenuItem value="auto">系统 DNS + Fake-IP 安全回退</MenuItem><MenuItem value="system">仅系统 DNS</MenuItem></TextField><FormControlLabel control={<Switch checked={p.options.visible || p.options.mode === 'interactive'} disabled={p.running || p.options.mode === 'interactive'} onChange={(_, value) => set('visible', value)}/>} label="显示受控浏览器"/>
    </Stack>
    {p.options.mode === 'explore' && <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>仅导航同源普通链接；跳过查询参数、下载与已知操作路径，不点击按钮或提交表单。</Typography>}
   </Collapse>
  </Box>
 </Paper>;
}
