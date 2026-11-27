import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  CssBaseline,
  Snackbar,
  Stack,
  ThemeProvider,
  Typography,
  useMediaQuery,
} from "@mui/material";
import AppTitleBar from "../components/AppTitleBar";
import ScanControls from "../components/ScanControls";
import DomainPanel from "../components/DomainPanel";
import AnalysisPanel from "../components/AnalysisPanel";
import MatchPanel from "../components/MatchPanel";
import type {
  HistoryDeletion,
  RequestFilter,
  ScanOptions,
  ScanTask,
  Settings,
} from "../types";
import { makeTheme } from "../theme";
import { useScan } from "../hooks/useScan";
import { useActiveScan } from "../hooks/useActiveScan";
import { useScanAddress } from "../hooks/useScanAddress";
import { maxZoom, minZoom, useAppZoom } from "../hooks/useAppZoom";
import { api } from "../services/api";
import {
  active,
  errorMessage,
  isExportable,
  isRedacted,
  tipText,
} from "../utils/format";
import {
  savedScanTarget,
  scanAddressIssue,
  scanTargetLabel,
} from "../utils/scanAddress";

const SettingsDialog = lazy(() => import("../components/SettingsDialog"));
const NetworkDialog = lazy(() => import("../components/NetworkDialog"));
const HistoryDialog = lazy(() => import("../components/HistoryDialog"));
const RuleLibrary = lazy(() => import("../components/RuleLibrary"));
const ExportDialog = lazy(() => import("../components/ExportDialog"));
const emptyFilter: RequestFilter = {
  host: "",
  method: "",
  type: "",
  status: "",
  page: 0,
};

export default function App() {
  const [settings, setSettings] = useState<Settings>();
  const [modeOverride, setScanMode] = useState<ScanOptions["mode"]>();
  const [networkOverride, setScanNetwork] =
    useState<
      Pick<ScanOptions, "dns_mode" | "dns_provider" | "upstream_proxy">
    >();
  const address = useScanAddress();
  const [historyTarget, setHistoryTarget] = useState("");
  const [id, setID] = useState("");
  const [resetCount, setResetCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recordingPending, setRecordingPending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [retry, setRetry] = useState(0);
  const [canShowBrowser, setCanShowBrowser] = useState(true);
  const [browserAvailable, setBrowserAvailable] = useState(true);
  const [browserManaged, setBrowserManaged] = useState(false);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, notify] = useState("");
  const [dialog, setDialog] = useState("");
  const pendingHistory = useRef<ScanTask>(undefined);
  const [settingsLibrary, setSettingsLibrary] = useState(false);
  const [settingsLibraryOpen, setSettingsLibraryOpen] = useState(false);
  function openDialog(name: string) {
    setDialog(name);
    setDialogOpen(true);
  }
  function closeDialog() {
    setDialogOpen(false);
  }
  function dialogExited() {
    if (dialogOpen) return;
    setDialog("");
    if (pendingHistory.current) {
      openTask(pendingHistory.current);
      pendingHistory.current = undefined;
    }
  }
  const [tab, setTab] = useState(0);
  const [mobilePanel, setMobilePanel] = useState("domains");
  const [libraryCategory, setLibraryCategory] = useState<{
    id: string;
    version?: string;
    path?: string;
  }>();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<RequestFilter>(emptyFilter);
  const {
    task,
    setTask,
    domains,
    requests,
    total,
    logs,
    connection,
    syncingResults,
  } = useScan(id, filter);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [nativeDark, setNativeDark] = useState(
    () => window.castoriceWindow?.systemDark,
  );
  useEffect(() => {
    const changed = (event: Event) => {
      setNativeDark((event as CustomEvent<boolean | undefined>).detail);
    };
    window.addEventListener("castorice-system-theme", changed);
    return () => window.removeEventListener("castorice-system-theme", changed);
  }, []);
  const { zoom, changeZoom } = useAppZoom();
  const { activeTask: backgroundTask, rememberActive } = useActiveScan(task);
  const currentActive = active(task)
    ? task
    : active(backgroundTask)
      ? backgroundTask
      : undefined;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const dark =
    settings?.theme === "dark" ||
    ((settings?.theme ?? "system") === "system" && (nativeDark ?? systemDark));
  const theme = useMemo(
    () => makeTheme(dark, reducedMotion),
    [dark, reducedMotion],
  );
  const chosenDomains = useMemo(
    () => domains.filter((d) => isExportable(d) && !excluded.has(d.hostname)),
    [domains, excluded],
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<Settings>("/settings"),
      api<{
        visible_browser: boolean;
        browser_available?: boolean;
        browser_managed?: boolean;
      }>("/health"),
    ])
      .then(([s, capabilities]) => {
        if (cancelled) return;
        setCanShowBrowser(capabilities.visible_browser);
        setBrowserAvailable(capabilities.browser_available !== false);
        setBrowserManaged(!!capabilities.browser_managed);
        setSettings(s);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);
  useEffect(() => {
    if (!initializing) window.castoriceWindow?.command("ready");
  }, [initializing]);
  const selectedMode = modeOverride ?? settings?.scan.mode;
  const options: ScanOptions | undefined =
    settings && selectedMode
      ? {
          ...settings.scan,
          ...networkOverride,
          mode:
            !canShowBrowser && selectedMode === "interactive"
              ? "quick"
              : selectedMode,
          visible: canShowBrowser && settings.scan.visible,
        }
      : undefined;
  function resetView() {
    setExcluded(new Set());
    setFilter(emptyFilter);
    setTab(0);
    setMobilePanel("domains");
  }
  function openTask(t: ScanTask) {
    const redacted = t.target_redacted || isRedacted(t.target_url);
    const saved = redacted ? undefined : savedScanTarget(t);
    resetView();
    setID(t.id);
    address.edit(redacted ? "" : scanTargetLabel(t.target_url), saved);
    setHistoryTarget(redacted ? scanTargetLabel(t.target_url) : "");
  }
  const running = !!currentActive;
  function reset(keepDialog = false) {
    if ((!keepDialog && running) || active(task) || busy || initializing)
      return;
    setID("");
    setTask(undefined);
    address.edit("");
    setHistoryTarget("");
    setError("");
    notify("");
    if (!keepDialog) closeDialog();
    setResetCount((v) => v + 1);
    setLibraryCategory(undefined);
    resetView();
  }
  async function start() {
    if (!options || busy || running) return;
    setBusy(true);
    setError("");
    try {
      const target = await address.prepare(address.value);
      if (!target) return;
      address.setIssue("");
      const scan = await api<ScanTask>("/scans", "POST", {
        url: target.url,
        options,
        root_only: true,
      });
      setScanNetwork((current) =>
        current === networkOverride ? undefined : current,
      );
      resetView();
      setHistoryTarget("");
      setID(scan.id);
      setTask(scan);
      rememberActive(scan);
      setTab(0);
    } catch (e) {
      address.setIssue(scanAddressIssue(e));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!currentActive) return;
    setBusy(true);
    try {
      await api(`/scans/${currentActive.id}/stop`, "POST");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function setRecordingPaused(paused: boolean) {
    if (!currentActive) return;
    const recordingID = currentActive.id;
    setRecordingPending(true);
    try {
      const result = await api<{ recording_paused: boolean }>(
        `/scans/${recordingID}/recording`,
        "POST",
        { paused },
      );
      const apply = (old?: ScanTask) =>
        old?.id === recordingID && old.status === "running"
          ? { ...old, recording_paused: result.recording_paused }
          : old;
      setTask(apply);
      rememberActive(apply);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRecordingPending(false);
    }
  }
  async function rematch() {
    if (!task || active(task)) return;
    setBusy(true);
    try {
      setTask(
        await api<ScanTask>("/rules/match", "POST", { task_id: task.id }),
      );
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function openLibrary(id = "", version?: string, path?: string) {
    setLibraryCategory(id ? { id, version, path } : undefined);
    openDialog("rules");
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <Box className="app-shell">
        <AppTitleBar
          zoom={zoom}
          minZoom={minZoom}
          maxZoom={maxZoom}
          onZoom={changeZoom}
          onLibrary={() => openLibrary()}
          onHistory={() => openDialog("history")}
          onNetwork={() => openDialog("network")}
          onSettings={() => openDialog("settings")}
        />
        <Box
          component="main"
          className="app-main scroll-region"
          tabIndex={0}
          aria-label="扫描工作区"
        >
          {initializing && (
            <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2">连接本地服务…</Typography>
            </Stack>
          )}
          <Collapse in={!!error} unmountOnExit>
            <Alert severity="error" onClose={() => setError("")}>
              {tipText(error)}
            </Alert>
          </Collapse>
          {!initializing && !settings && (
            <Button
              onClick={() => {
                setError("");
                setInitializing(true);
                setRetry((old) => old + 1);
              }}
            >
              重新连接
            </Button>
          )}
          {settings && options && (
            <>
              {!browserAvailable && (
                <Alert severity="warning">
                  采集需要 Chrome、Edge 或
                  Chromium。请在运行服务的电脑安装浏览器，再重新打开应用
                </Alert>
              )}
              <ScanControls
                url={address.value}
                setURL={address.edit}
                onNormalize={address.prepare}
                addressIssue={address.issue}
                addressNotice={address.notice}
                showingEarlierResult={!!task && !running}
                historyTarget={historyTarget}
                browserAvailable={browserAvailable}
                options={options}
                setMode={setScanMode}
                canShowBrowser={canShowBrowser}
                running={running}
                busy={busy || initializing}
                interactiveTask={
                  currentActive?.options.mode === "interactive" &&
                  currentActive.status === "running"
                    ? currentActive
                    : undefined
                }
                recordingPending={recordingPending}
                onRecordingChange={(paused) => void setRecordingPaused(paused)}
                onStart={() => void start()}
                onStop={() => void stop()}
                onReset={reset}
              />
              {currentActive && currentActive.id !== id && (
                <Alert
                  severity="info"
                  action={
                    <Button onClick={() => openTask(currentActive)}>
                      返回正在采集
                    </Button>
                  }
                >
                  {task ? "另一个任务正在采集" : "有任务正在采集"}
                </Alert>
              )}
              <Box className="mobile-switch">
                <Button
                  size="small"
                  variant={mobilePanel === "domains" ? "contained" : "text"}
                  onClick={() => setMobilePanel("domains")}
                >
                  域名
                </Button>
                <Button
                  size="small"
                  variant={mobilePanel === "analysis" ? "contained" : "text"}
                  onClick={() => setMobilePanel("analysis")}
                >
                  分析 / 规则命中
                </Button>
              </Box>
              <Box className="workspace" data-mobile-panel={mobilePanel}>
                <DomainPanel
                  key={`domains:${id}:${resetCount}`}
                  task={task}
                  syncingResults={syncingResults}
                  domains={domains}
                  excluded={excluded}
                  onSelect={(hosts, selected) =>
                    setExcluded((old) => {
                      const value = new Set(old);
                      for (const host of hosts) {
                        if (selected) value.delete(host);
                        else value.add(host);
                      }
                      return value;
                    })
                  }
                  onExport={() => openDialog("export")}
                  onRequests={(host) => {
                    setFilter({ ...filter, host, exactHost: true, page: 0 });
                    setTab(1);
                    setMobilePanel("analysis");
                  }}
                  notify={notify}
                />
                <AnalysisPanel
                  key={`analysis:${id}:${resetCount}`}
                  task={task}
                  options={options}
                  browserManaged={browserManaged}
                  connection={connection}
                  syncingResults={syncingResults}
                  requests={requests}
                  total={total}
                  filter={filter}
                  setFilter={setFilter}
                  logs={logs}
                  tab={tab}
                  setTab={setTab}
                  logLevel={settings.log_level}
                  notify={notify}
                  matchContent={
                    <MatchPanel
                      task={task}
                      onRematch={() => void rematch()}
                      onLibrary={openLibrary}
                      busy={busy}
                    />
                  }
                />
              </Box>
            </>
          )}
        </Box>
        <Suspense
          fallback={
            <CircularProgress
              aria-label="正在打开"
              size={22}
              sx={{ position: "fixed", top: "45%", left: "48%" }}
            />
          }
        >
          {dialog === "settings" && settings && (
            <SettingsDialog
              open={dialogOpen}
              onExited={dialogExited}
              canShowBrowser={canShowBrowser}
              browserManaged={browserManaged}
              settings={settings}
              selectedMode={selectedMode ?? settings.scan.mode}
              onSave={(value) => {
                setSettings(value);
                setScanMode(undefined);
                setScanNetwork(undefined);
              }}
              onClose={closeDialog}
              onLibrary={() => {
                setSettingsLibrary(true);
                setSettingsLibraryOpen(true);
              }}
              notify={notify}
            >
              {settingsLibrary && (
                <RuleLibrary
                  open={settingsLibraryOpen}
                  onClose={() => setSettingsLibraryOpen(false)}
                  onExited={() => {
                    if (!settingsLibraryOpen) setSettingsLibrary(false);
                  }}
                  notify={notify}
                  onRematch={() => void rematch()}
                />
              )}
            </SettingsDialog>
          )}
          {dialog === "network" && options && (
            <NetworkDialog
              open={dialogOpen}
              onExited={dialogExited}
              onClose={closeDialog}
              url={address.target?.url || address.value}
              label={address.target?.host || address.value.trim()}
              options={options}
              onApply={({ dns_mode, dns_provider, upstream_proxy }) => {
                setScanNetwork({ dns_mode, dns_provider, upstream_proxy });
              }}
              notify={notify}
            />
          )}
          {dialog === "history" && (
            <HistoryDialog
              open={dialogOpen}
              onExited={dialogExited}
              notify={notify}
              onDeleted={(result: HistoryDeletion) => {
                if (result.ids.includes(id)) reset(true);
              }}
              onClose={closeDialog}
              onOpen={(record) => {
                pendingHistory.current = record;
                closeDialog();
              }}
            />
          )}
          {dialog === "rules" && (
            <RuleLibrary
              open={dialogOpen}
              onExited={dialogExited}
              initialCategory={libraryCategory?.id}
              expectedVersion={libraryCategory?.version}
              expectedPath={libraryCategory?.path}
              onClose={closeDialog}
              notify={notify}
              onRematch={() => void rematch()}
            />
          )}
          {dialog === "export" && task && settings && (
            <ExportDialog
              open={dialogOpen}
              onExited={dialogExited}
              task={task}
              domains={chosenDomains}
              settings={settings}
              onClose={closeDialog}
              notify={notify}
              onRematch={() => void rematch()}
            />
          )}
        </Suspense>
        <Snackbar
          open={!!notice}
          autoHideDuration={4500}
          disableWindowBlurListener
          onClose={() => notify("")}
          message={tipText(notice)}
          sx={{ pointerEvents: "none" }}
        />
      </Box>
    </ThemeProvider>
  );
}
