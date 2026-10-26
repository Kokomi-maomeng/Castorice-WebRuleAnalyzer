import { useEffect, useMemo, useState } from 'react';
import { Alert, AppBar, Box, Button, Chip, CircularProgress, CssBaseline, IconButton, Snackbar, Stack, ThemeProvider, Toolbar, Tooltip, Typography, useMediaQuery } from '@mui/material';
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
    const [canShowBrowser, setCanShowBrowser] = useState(true);
    const [error, setError] = useState('');
    const [notice, notify] = useState('');
    const [dialog, setDialog] = useState('');
    const [tab, setTab] = useState(0);
    const [mobilePanel, setMobilePanel] = useState('domains');
    const [libraryCategory, setLibraryCategory] = useState('');
    const [mode, setMode] = useState<'observed' | 'merged'>('observed');
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<RequestFilter>({ host: '', method: '', type: '', status: '', page: 0 });
    const { task, setTask, domains, requests, total, logs, connection } = useScan(id, filter);
    const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
    const dark = settings.theme === 'dark' || settings.theme === 'system' && systemDark;
    const theme = useMemo(() => makeTheme(dark), [dark]);
    const chosenDomains = useMemo(() => domains.filter(d => d.kind === 'domain' && !excluded.has(d.hostname)), [domains, excluded]);
    useEffect(() => {
        void Promise.all([api<Settings>('/settings'), api<ScanTask[]>('/scans'), api<{ visible_browser: boolean }>('/health')]).then(([s, scans, capabilities]) => { setCanShowBrowser(capabilities.visible_browser); setSettings(s); setOptions(capabilities.visible_browser ? s.scan : { ...s.scan, mode: s.scan.mode === 'interactive' ? 'quick' : s.scan.mode, visible: false }); const stored = localStorage.getItem('castorice.lastScan'); const restore = scans.find(active) || scans.find(t => t.id === stored) || scans[0]; if (restore) {
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
    function openLibrary(category = '') { setLibraryCategory(category); setDialog('rules'); }
    return <ThemeProvider theme={theme}><CssBaseline /><Box className="app-shell">
     <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}><Toolbar sx={{ minHeight: '54px !important', px: { xs: 1, sm: 2 }, gap: 1 }}>
      <HubRounded color="primary" /><Typography noWrap sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}><Box component="span" className="brand-full">Castorice-WebRuleAnalyzer</Box><Box component="span" className="brand-short">Web规则分析器</Box><Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>v1.2</Typography></Typography>
      <Tooltip title="开源规则库"><IconButton aria-label="开源规则库" onClick={() => openLibrary()}><MenuBookRounded /></IconButton></Tooltip><Tooltip title="扫描历史"><IconButton aria-label="扫描历史" onClick={() => setDialog('history')}><HistoryRounded /></IconButton></Tooltip><Tooltip title="切换主题"><IconButton aria-label="切换主题" onClick={() => void toggleTheme()}>{dark ? <LightModeRounded /> : <DarkModeRounded />}</IconButton></Tooltip><Tooltip title="软件设置"><IconButton aria-label="软件设置" onClick={() => setDialog('settings')}><SettingsRounded /></IconButton></Tooltip>
     </Toolbar></AppBar>
     <Box component="main" className="app-main">
      {initializing && <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}><CircularProgress size={16} /><Typography variant="body2">连接本地服务…</Typography></Stack>}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <ScanControls url={url} setURL={setURL} options={options} setOptions={setOptions} canShowBrowser={canShowBrowser} running={running} busy={busy || initializing} onStart={() => void start()} onStop={() => void stop()} />
      {connection && <Alert severity="warning">{connection}</Alert>}
      <Stack direction="row" className="workspace-toolbar" sx={{ gap: 1, alignItems: 'center' }}><Box className="mobile-switch"><Button size="small" variant={mobilePanel === 'domains' ? 'contained' : 'text'} onClick={() => setMobilePanel('domains')}>域名</Button><Button size="small" variant={mobilePanel === 'analysis' ? 'contained' : 'text'} onClick={() => setMobilePanel('analysis')}>分析 / 规则命中</Button></Box><Typography variant="caption" color="text.secondary" className="privacy-note">独立浏览器 · URL 脱敏 · 本地保存</Typography><Chip size="small" label={running ? '正在采集' : '本地工作区'} variant="outlined" sx={{ ml: 'auto' }} /></Stack>
      <Box className="workspace" data-mobile-panel={mobilePanel}>
       <DomainPanel task={task} domains={domains} excluded={excluded} toggle={host => setExcluded(old => { const value = new Set(old); if (value.has(host)) value.delete(host); else value.add(host); return value; })} mode={mode} setMode={setMode} onExport={() => setDialog('export')} onRequests={host => { setFilter({ ...filter, host, page: 0 }); setTab(1); setMobilePanel('analysis'); }} notify={notify} />
       <AnalysisPanel key={id} task={task} requests={requests} total={total} filter={filter} setFilter={setFilter} logs={logs} tab={tab} setTab={setTab} logLevel={settings.log_level} notify={notify} matchContent={<MatchPanel task={task} onRematch={() => void rematch()} onLibrary={openLibrary} busy={busy} />} />
      </Box>
     </Box>
     {dialog === 'settings' && <SettingsDialog canShowBrowser={canShowBrowser} settings={settings} onSave={save} onClose={() => setDialog('')} onLibrary={() => openLibrary()} notify={notify} />}
     {dialog === 'history' && <HistoryDialog onClose={() => setDialog('')} onOpen={t => { setID(t.id); setURL(t.target_url); setOptions(t.options); setTab(0); }} />}
     {dialog === 'rules' && <RuleLibrary initialCategory={libraryCategory} onClose={() => setDialog('')} notify={notify} onRematch={() => void rematch()} />}
     {dialog === 'export' && task && <ExportDialog task={task} domains={chosenDomains} mode={mode} settings={settings} onClose={() => setDialog('')} notify={notify} onRematch={() => void rematch()} />}
     <Snackbar open={!!notice} autoHideDuration={4500} disableWindowBlurListener onClose={() => notify('')} message={notice} sx={{ pointerEvents: 'none' }} />
    </Box></ThemeProvider>;
}
