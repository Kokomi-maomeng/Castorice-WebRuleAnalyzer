import { useEffect, useMemo, useState } from 'react';
import { Alert, AppBar, Box, Button, Chip, CircularProgress, Container, CssBaseline, IconButton, Snackbar, Stack, ThemeProvider, Toolbar, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { DarkModeRounded, HistoryRounded, HubRounded, LightModeRounded, MenuBookRounded, SettingsRounded } from '@mui/icons-material';
import ScanControls from '../components/ScanControls';
import DomainPanel from '../components/DomainPanel';
import AnalysisPanel from '../components/AnalysisPanel';
import MatchPanel from '../components/MatchPanel';
import SettingsDialog from '../components/SettingsDialog';
import HistoryDialog from '../components/HistoryDialog';
import RuleLibrary from '../components/RuleLibrary';
import ExportDialog from '../components/ExportDialog';
import type { RequestFilter, ScanTask, Settings } from '../types';
import { makeTheme } from '../theme';
import { useScan } from '../hooks/useScan';
import { api } from '../services/api';
import { active, defaultSettings, errorMessage } from '../utils/format';
export default function App() {
    const [settings, setSettings] = useState<Settings>(defaultSettings);
    const [options, setOptions] = useState(defaultSettings.scan);
    const [url, setURL] = useState('');
    const [id, setID] = useState('');
    const [busy, setBusy] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [error, setError] = useState('');
    const [notice, notify] = useState('');
    const [dialog, setDialog] = useState('');
    const [tab, setTab] = useState(0);
    const [mode, setMode] = useState<'observed' | 'merged'>('observed');
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<RequestFilter>({ host: '', method: '', type: '', status: '', page: 0 });
    const { task, setTask, domains, requests, total, logs, connection } = useScan(id, filter);
    const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
    const dark = settings.theme === 'dark' || settings.theme === 'system' && systemDark;
    const theme = useMemo(() => makeTheme(dark), [dark]);
    const chosenDomains = useMemo(() => domains.filter(d => d.kind === 'domain' && !excluded.has(d.hostname)), [domains, excluded]);
    useEffect(() => {
        void Promise.all([api<Settings>('/settings'), api<ScanTask[]>('/scans')]).then(([s, scans]) => { setSettings(s); setOptions(s.scan); const stored = localStorage.getItem('castorice.lastScan'); const restore = scans.find(active) || scans.find(t => t.id === stored) || scans[0]; if (restore) {
            setID(restore.id);
            setURL(restore.target_url);
        } }).catch(e => setError(errorMessage(e))).finally(() => setInitializing(false));
    }, []);
    useEffect(() => { setExcluded(new Set()); setFilter({ host: '', method: '', type: '', status: '', page: 0 }); setMode('observed'); if (id)
        localStorage.setItem('castorice.lastScan', id); }, [id]);
    const running = active(task);
    async function start() { setBusy(true); setError(''); try {
        const scan = await api<ScanTask>('/scans', 'POST', { url, options });
        setID(scan.id);
        setTask(scan);
        setTab(0);
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy(false);
    } }
    async function stop() { if (!task)
        return; setBusy(true); try {
        await api(`/scans/${task.id}/stop`, 'POST');
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy(false);
    } }
    async function rematch() { if (!task || active(task))
        return; setBusy(true); try {
        setTask(await api<ScanTask>('/rules/match', 'POST', { task_id: task.id }));
    }
    catch (e) {
        notify(errorMessage(e));
    }
    finally {
        setBusy(false);
    } }
    function save(value: Settings) { setSettings(value); if (!running)
        setOptions(value.scan); }
    async function toggleTheme() { const value = { ...settings, theme: dark ? 'light' as const : 'dark' as const }; try {
        save(await api<Settings>('/settings', 'PUT', value));
    }
    catch (e) {
        notify(errorMessage(e));
    } }
    return <ThemeProvider theme={theme}><CssBaseline /><AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}><Toolbar sx={{ minHeight: 82, maxWidth: 1536, width: '100%', mx: 'auto', px: { xs: 2, md: 4 }, gap: 1.5 }}><Box sx={{ display: 'grid', placeItems: 'center', width: 42, height: 42, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 3, mr: .5 }}><HubRounded /></Box><Box sx={{ minWidth: 0, flex: 1 }}><Typography sx={{ fontSize: { xs: 14, sm: 18 }, fontWeight: 700, letterSpacing: -.3, overflowWrap: 'anywhere' }}>Castorice-WebRuleAnalyzer</Typography><Typography variant="caption" color="text.secondary">Web分流规则分析器 <Box component="span" sx={{ mx: .5 }}>·</Box> v1.0</Typography></Box><Button color="inherit" startIcon={<MenuBookRounded />} onClick={() => setDialog('rules')} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>规则库</Button><Tooltip title="扫描历史"><IconButton aria-label="扫描历史" onClick={() => setDialog('history')}><HistoryRounded /></IconButton></Tooltip><Tooltip title={dark ? '切换浅色' : '切换深色'}><IconButton aria-label="切换主题" onClick={() => void toggleTheme()}>{dark ? <LightModeRounded /> : <DarkModeRounded />}</IconButton></Tooltip><Tooltip title="设置"><IconButton aria-label="软件设置" onClick={() => setDialog('settings')}><SettingsRounded /></IconButton></Tooltip></Toolbar></AppBar>
  <Container maxWidth={false} sx={{ maxWidth: 1536, py: 3.5, px: { xs: 2, md: 4 } }}>
   {initializing && <Stack direction="row" sx={{ mb: 2, alignItems: "center", gap: 1 }}><CircularProgress size={18}/><Typography>正在连接本地服务…</Typography></Stack>}
   {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
   <ScanControls url={url} setURL={setURL} options={options} setOptions={setOptions} running={running} busy={busy || initializing} onStart={() => void start()} onStop={() => void stop()}/>
   <Stack direction="row" sx={{ py: 2.5, alignItems: "center", gap: 1, flexWrap: "wrap" }}><Chip size="small" label="浏览器网络事件" variant="outlined" color="secondary"/><Typography variant="caption" color="text.secondary">独立会话 · 查询参数脱敏 · 默认精确域名匹配</Typography><Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', display: { xs: 'none', md: 'block' } }}>本地运行 / 单任务采集</Typography></Stack>
   {connection && <Alert severity="warning" sx={{ mb: 2 }}>{connection}</Alert>}
   <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(350px,.8fr) minmax(0,1.6fr)' }, gap: 2.5 }}>
    <DomainPanel task={task} domains={domains} excluded={excluded} toggle={host => setExcluded(old => { const value = new Set(old); if (value.has(host))
        value.delete(host);
    else
        value.add(host); return value; })} mode={mode} setMode={setMode} onExport={() => setDialog('export')} onRequests={host => { setFilter({ ...filter, host, page: 0 }); setTab(1); }} notify={notify}/>
    <AnalysisPanel key={id} task={task} requests={requests} total={total} filter={filter} setFilter={setFilter} logs={logs} tab={tab} setTab={setTab} logLevel={settings.log_level} notify={notify}/>
   </Box>
   <MatchPanel task={task} onRematch={() => void rematch()} onLibrary={() => setDialog('rules')} busy={busy}/>
   <Typography variant="caption" color="text.secondary" align="center" sx={{ mt: 3, display: "block" }}>仅记录当前受控浏览器可观察的网络事件。有限扫描无法证明整个应用的完整域名覆盖。</Typography>
  </Container>
  {dialog === 'settings' && <SettingsDialog settings={settings} onSave={save} onClose={() => setDialog('')} onLibrary={() => setDialog('rules')} notify={notify}/>}
  {dialog === 'history' && <HistoryDialog onClose={() => setDialog('')} onOpen={t => { setID(t.id); setURL(t.target_url); setOptions(t.options); setTab(0); }}/>}
  {dialog === 'rules' && <RuleLibrary onClose={() => setDialog('')} notify={notify} onRematch={() => void rematch()}/>}
  {dialog === 'export' && task && <ExportDialog task={task} domains={chosenDomains} mode={mode} settings={settings} onClose={() => setDialog('')} notify={notify} onRematch={() => void rematch()}/>}
  <Snackbar open={!!notice} autoHideDuration={4500} onClose={() => notify('')} message={notice}/>
 </ThemeProvider>;
}
