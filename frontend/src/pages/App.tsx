import DiagnosticAlert from "../components/DiagnosticAlert";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  Diagnostic,
  HistoryDeletion,
  RequestFilter,
  ScanOptions,
  ScanTask,
  Settings,
} from "../types";
import { makeTheme } from "../theme";
import { useScan } from "../hooks/useScan";
import { useActiveScan } from "../hooks/useActiveScan";
import { api } from "../services/api";
import {
  active,
  errorMessage,
  isExportable,
  isRedacted,
} from "../utils/format";

const SettingsDialog = lazy(() => import("../components/SettingsDialog"));
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
  const [optionsOverride, setOptions] = useState<ScanOptions>();
  const [url, setURL] = useState("");
  const [historyTarget, setHistoryTarget] = useState("");
  const [id, setID] = useState("");
  const [resetCount, setResetCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [retry, setRetry] = useState(0);
  const [canShowBrowser, setCanShowBrowser] = useState(true);
  const [browserAvailable, setBrowserAvailable] = useState(true);
  const [browserManaged, setBrowserManaged] = useState(false);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const [failedAttempt, setFailedAttempt] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, notify] = useState("");
  const [dialog, setDialog] = useState("");
  const [settingsLibrary, setSettingsLibrary] = useState(false);
  function openDialog(name: string) {
    setDialog(name);
    setDialogOpen(true);
  }
  function closeDialog() {
    setDialogOpen(false);
  }
  function dialogExited() {
    if (!dialogOpen) setDialog("");
  }
  const [tab, setTab] = useState(0);
  const [mobilePanel, setMobilePanel] = useState("domains");
  const [libraryCategory, setLibraryCategory] = useState<{
    id: string;
    version?: string;
    path?: string;
  }>();
  const [mode, setMode] = useState<"observed" | "merged">("observed");
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
  const { activeTask: backgroundTask, rememberActive } = useActiveScan(task);
  const currentActive = active(task)
    ? task
    : active(backgroundTask)
      ? backgroundTask
      : undefined;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const dark =
    settings?.theme === "dark" || (settings?.theme === "system" && systemDark);
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
  const preferredOptions = optionsOverride ?? settings?.scan;
  const options =
    preferredOptions && !canShowBrowser
      ? {
          ...preferredOptions,
          visible: false,
          mode:
            preferredOptions.mode === "interactive"
              ? ("quick" as const)
              : preferredOptions.mode,
        }
      : preferredOptions;
  function resetView() {
    setExcluded(new Set());
    setFilter(emptyFilter);
    setMode("observed");
    setTab(0);
    setMobilePanel("domains");
  }
  function openTask(t: ScanTask) {
    const redacted = t.target_redacted || isRedacted(t.target_url);
    resetView();
    setID(t.id);
    setURL(redacted ? "" : t.target_url);
    setHistoryTarget(redacted ? t.target_url : "");
    setOptions({
      ...t.options,
      browser_path: settings?.scan.browser_path || "",
    });
  }
  const running = !!currentActive;
  function reset(keepDialog = false) {
    if ((!keepDialog && running) || active(task) || busy || initializing)
      return;
    setID("");
    setTask(undefined);
    setURL("");
    setHistoryTarget("");
    setError("");
    setDiagnostic(undefined);
    setFailedAttempt(false);
    notify("");
    if (!keepDialog) closeDialog();
    setResetCount((v) => v + 1);
    setLibraryCategory(undefined);
    resetView();
    setOptions(undefined);
  }
  async function start() {
    if (!options || isRedacted(url)) return;
    setBusy(true);
    setError("");
    setDiagnostic(undefined);
    setFailedAttempt(false);
    try {
      const scan = await api<ScanTask>("/scans", "POST", { url, options });
      resetView();
      setHistoryTarget("");
      setID(scan.id);
      setTask(scan);
      rememberActive(scan);
      setTab(0);
    } catch (e) {
      setError(errorMessage(e));
      setFailedAttempt(true);
      if (e && typeof e === "object" && "diagnostic" in e)
        setDiagnostic(e.diagnostic as Diagnostic);
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
  async function toggleTheme() {
    if (!settings) return;
    const theme = dark ? "light" : "dark";
    try {
      const value = await api<Pick<Settings, "theme">>(
        "/settings/theme",
        "PUT",
        { theme },
      );
      setSettings((old) => old && { ...old, theme: value.theme });
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  function openLibrary(id = "", version?: string, path?: string) {
    setLibraryCategory(id ? { id, version, path } : undefined);
    openDialog("rules");
  }
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box className="app-shell">
        <AppTitleBar
          dark={dark}
          onTheme={() => void toggleTheme()}
          onLibrary={() => openLibrary()}
          onHistory={() => openDialog("history")}
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
            <Box>
              {diagnostic ? (
                <DiagnosticAlert diagnostic={diagnostic} />
              ) : (
                <Alert severity="error" onClose={() => setError("")}>
                  {error}
                </Alert>
              )}
              {failedAttempt && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  {task
                    ? `本次未启动；下方仍显示上一任务 ${task.target_url} 的结果。`
                    : "本次未启动，尚未产生采集结果。"}
                </Typography>
              )}
            </Box>
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
                  Chromium。请在运行服务的电脑安装浏览器，再重新打开应用。
                </Alert>
              )}
              <ScanControls
                url={url}
                setURL={setURL}
                historyTarget={historyTarget}
                browserAvailable={browserAvailable}
                options={options}
                setOptions={setOptions}
                canShowBrowser={canShowBrowser}
                running={running}
                busy={busy || initializing}
                onStart={() => void start()}
                onStop={() => void stop()}
                onReset={reset}
                notify={notify}
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
                  {task ? "另一个任务正在采集。" : "有任务正在采集。"}
                </Alert>
              )}
              {connection && <Alert severity="warning">{connection}</Alert>}
              {syncingResults && (
                <Typography role="status" color="text.secondary">
                  正在补取最终采集结果…
                </Typography>
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
                  toggle={(host) =>
                    setExcluded((old) => {
                      const value = new Set(old);
                      if (value.has(host)) value.delete(host);
                      else value.add(host);
                      return value;
                    })
                  }
                  mode={mode}
                  setMode={setMode}
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
              onSave={setSettings}
              onClose={closeDialog}
              onLibrary={() => setSettingsLibrary(true)}
              notify={notify}
            >
              {settingsLibrary && (
                <RuleLibrary
                  onClose={() => setSettingsLibrary(false)}
                  notify={notify}
                  onRematch={() => void rematch()}
                />
              )}
            </SettingsDialog>
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
              onOpen={openTask}
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
              mode={mode}
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
          message={notice}
          sx={{ pointerEvents: "none" }}
        />
      </Box>
    </ThemeProvider>
  );
}
