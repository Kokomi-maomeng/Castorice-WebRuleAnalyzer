import DiagnosticAlert from "../components/DiagnosticAlert";
import { useEffect, useMemo, useState } from "react";
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
import SettingsDialog from "../components/SettingsDialog";
import HistoryDialog from "../components/HistoryDialog";
import RuleLibrary from "../components/RuleLibrary";
import ExportDialog from "../components/ExportDialog";
import type {
  Diagnostic,
  HistoryDeletion,
  RequestFilter,
  ScanTask,
  Settings,
} from "../types";
import { makeTheme } from "../theme";
import { useScan } from "../hooks/useScan";
import { useActiveScan } from "../hooks/useActiveScan";
import { api } from "../services/api";
import { active, defaultSettings, errorMessage } from "../utils/format";
export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [options, setOptions] = useState(defaultSettings.scan);
  const [url, setURL] = useState("");
  const [id, setID] = useState("");
  const [resetCount, setResetCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [canShowBrowser, setCanShowBrowser] = useState(true);
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
  const [libraryCategory, setLibraryCategory] = useState("");
  const [mode, setMode] = useState<"observed" | "merged">("observed");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<RequestFilter>({
    host: "",
    method: "",
    type: "",
    status: "",
    page: 0,
  });
  const { task, setTask, domains, requests, total, logs, connection } = useScan(
    id,
    filter,
  );
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const { activeTask: backgroundTask, rememberActive } = useActiveScan(task);
  const currentActive = active(task)
    ? task
    : active(backgroundTask)
      ? backgroundTask
      : undefined;
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && systemDark);
  const theme = useMemo(
    () => makeTheme(dark, reducedMotion),
    [dark, reducedMotion],
  );
  const chosenDomains = useMemo(
    () =>
      domains.filter((d) => d.kind === "domain" && !excluded.has(d.hostname)),
    [domains, excluded],
  );
  useEffect(() => {
    void Promise.all([
      api<Settings>("/settings"),
      api<{ visible_browser: boolean }>("/health"),
    ])
      .then(([s, capabilities]) => {
        setCanShowBrowser(capabilities.visible_browser);
        setSettings(s);
        setOptions(
          capabilities.visible_browser
            ? s.scan
            : {
                ...s.scan,
                mode: s.scan.mode === "interactive" ? "quick" : s.scan.mode,
                visible: false,
              },
        );
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setInitializing(false));
  }, []);
  useEffect(() => {
    setExcluded(new Set());
    setFilter({ host: "", method: "", type: "", status: "", page: 0 });
    setMode("observed");
  }, [id]);
  const running = !!currentActive;
  function reset(keepDialog = false) {
    if ((!keepDialog && running) || active(task) || busy || initializing)
      return;
    setID("");
    setTask(undefined);
    setURL("");
    setError("");
    setDiagnostic(undefined);
    setFailedAttempt(false);
    notify("");
    if (!keepDialog) closeDialog();
    setResetCount((v) => v + 1);
    setTab(0);
    setMobilePanel("domains");
    setLibraryCategory("");
    setMode("observed");
    setExcluded(new Set());
    setFilter({ host: "", method: "", type: "", status: "", page: 0 });
    setOptions(
      canShowBrowser
        ? settings.scan
        : {
            ...settings.scan,
            mode:
              settings.scan.mode === "interactive"
                ? "quick"
                : settings.scan.mode,
            visible: false,
          },
    );
  }
  async function start() {
    setBusy(true);
    setError("");
    setDiagnostic(undefined);
    setFailedAttempt(false);
    try {
      const scan = await api<ScanTask>("/scans", "POST", { url, options });
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
  function save(value: Settings) {
    setSettings(value);
    if (!running) setOptions(value.scan);
  }
  async function toggleTheme() {
    const value = {
      ...settings,
      theme: dark ? ("light" as const) : ("dark" as const),
    };
    try {
      save(await api<Settings>("/settings", "PUT", value));
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  function openLibrary(category = "") {
    setLibraryCategory(category);
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
        <Box component="main" className="app-main">
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
          <ScanControls
            url={url}
            setURL={setURL}
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
                <Button
                  onClick={() => {
                    setID(currentActive.id);
                    setURL(currentActive.target_url);
                    setOptions(currentActive.options);
                  }}
                >
                  返回正在采集
                </Button>
              }
            >
              {task ? "另一个任务正在采集。" : "有任务正在采集。"}
            </Alert>
          )}
          {connection && <Alert severity="warning">{connection}</Alert>}
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
                setFilter({ ...filter, host, page: 0 });
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
        </Box>
        {dialog === "settings" && (
          <SettingsDialog
            open={dialogOpen}
            onExited={dialogExited}
            canShowBrowser={canShowBrowser}
            settings={settings}
            onSave={save}
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
            onOpen={(t) => {
              setID(t.id);
              setURL(t.target_url);
              setOptions(t.options);
              setTab(0);
            }}
          />
        )}
        {dialog === "rules" && (
          <RuleLibrary
            open={dialogOpen}
            onExited={dialogExited}
            initialCategory={libraryCategory}
            onClose={closeDialog}
            notify={notify}
            onRematch={() => void rematch()}
          />
        )}
        {dialog === "export" && task && (
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
