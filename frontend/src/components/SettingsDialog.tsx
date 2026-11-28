import NetworkOptions from "./NetworkOptions";
import ScanNumberFields, { invalidScanField } from "./ScanNumberFields";
import { APP_VERSION } from "../version";
import { useEffect, useId, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  DarkModeRounded,
  DeleteOutlineRounded,
  DevicesRounded,
  LightModeRounded,
  SaveRounded,
} from "@mui/icons-material";
import type { ScanOptions, Settings } from "../types";
import { api } from "../services/api";
import { errorMessage, modeNames, tipText } from "../utils/format";
import ContextHelp from "./ContextHelp";
import { controlledBrowserHelp, scanModeDescriptions } from "./ScanModeSelect";
const themeChoices = {
  light: { label: "浅色", Icon: LightModeRounded },
  dark: { label: "深色", Icon: DarkModeRounded },
  system: { label: "跟随系统", Icon: DevicesRounded },
} as const;
interface Props {
  open?: boolean;
  onExited?: () => void;
  canShowBrowser: boolean;
  browserManaged: boolean;
  settings: Settings;
  selectedMode: ScanOptions["mode"];
  onSave: (v: Settings) => void;
  onClose: () => void;
  notify: (s: string) => void;
}
export default function SettingsDialog(p: Props) {
  const modeID = useId();
  const [draft, setDraft] = useState(() => ({
    ...p.settings,
    scan: { ...p.settings.scan, mode: p.selectedMode },
  }));
  const [browsers, setBrowsers] = useState<
    {
      name: string;
      path: string;
    }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<
      {
        name: string;
        path: string;
      }[]
    >("/browsers")
      .then(setBrowsers)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const setScan = <K extends keyof ScanOptions>(
    key: K,
    value: ScanOptions[K],
  ) => setDraft((d) => ({ ...d, scan: { ...d.scan, [key]: value } }));
  const setScanOptions = (scan: ScanOptions) =>
    setDraft((d) => ({ ...d, scan }));
  async function save() {
    const invalid = invalidScanField(draft.scan);
    if (invalid) {
      setError(`请修正「${invalid}」`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const value = await api<Settings>("/settings", "PUT", draft);
      p.onSave(value);
      p.notify("设置已保存");
      p.onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function clearSessions() {
    setBusy(true);
    setError("");
    try {
      await api("/browser/sessions", "DELETE");
      p.notify("残留浏览器会话已清理");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      aria-labelledby="software-settings-title"
      open={p.open ?? true}
      fullWidth
      maxWidth="md"
      onClose={p.onClose}
      slotProps={{ transition: { onExited: p.onExited } }}
    >
      <DialogTitle id="software-settings-heading" className="dialog-heading">
        <Box component="span" id="software-settings-title">
          软件设置
        </Box>
        <IconButton
          aria-label="关闭设置"
          onClick={p.onClose}
          sx={{ ml: "auto", flexShrink: 0 }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {tipText(error)}
          </Alert>
        )}
        <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 650 }}>
          浏览器与会话
        </Typography>
        <TextField
          select
          fullWidth
          label="已检测到的浏览器"
          value={
            browsers.some((b) => b.path === draft.scan.browser_path)
              ? draft.scan.browser_path
              : ""
          }
          onChange={(e) => setScan("browser_path", e.target.value)}
          disabled={p.browserManaged}
          helperText={
            p.browserManaged
              ? "采集浏览器由服务管理员指定"
              : browsers.length
                ? "从运行采集服务的电脑选择"
                : "未检测到浏览器，请安装 Chrome、Edge 或 Chromium"
          }
        >
          <MenuItem value="">自动检测（Chrome / Edge / Chromium）</MenuItem>
          {browsers.map((b) => (
            <MenuItem key={b.path} value={b.path}>
              {b.name} · {b.path}
            </MenuItem>
          ))}
        </TextField>
        <Button
          sx={{ mt: 1 }}
          disabled={busy}
          startIcon={<DeleteOutlineRounded />}
          onClick={() => void clearSessions()}
        >
          清理残留会话
        </Button>
        <Divider sx={{ my: 3 }} />
        <Stack direction="row" sx={{ mb: 1, alignItems: "center", gap: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
            扫描参数
          </Typography>
          <ContextHelp label="查看扫描参数生效范围">
            保存后的参数用于之后启动的扫描
          </ContextHelp>
        </Stack>
        <Tabs
          aria-label="设置扫描模式"
          value={draft.scan.mode}
          variant="fullWidth"
          onChange={(_, value: ScanOptions["mode"]) => setScan("mode", value)}
          sx={{
            borderBottom: 1,
            borderColor: "divider",
            "& .MuiTab-root": { minWidth: 0, px: 0.75 },
          }}
        >
          {(Object.keys(scanModeDescriptions) as ScanOptions["mode"][]).map(
            (mode) => (
              <Tab
                key={mode}
                id={`${modeID}-${mode}`}
                aria-controls={`${modeID}-panel`}
                label={modeNames[mode]}
                value={mode}
                disabled={mode === "interactive" && !p.canShowBrowser}
              />
            ),
          )}
        </Tabs>
        <Box
          role="tabpanel"
          id={`${modeID}-panel`}
          aria-labelledby={`${modeID}-${draft.scan.mode}`}
        >
          <Typography variant="body2" color="text.secondary" sx={{ my: 1.5 }}>
            {scanModeDescriptions[draft.scan.mode]}
          </Typography>
          {!p.canShowBrowser && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              自行交互需要服务端图形会话
            </Typography>
          )}
          <Box className="advanced-grid">
            <ScanNumberFields options={draft.scan} change={setScanOptions} />
          </Box>
          <Box sx={{ mt: 2 }}>
            <NetworkOptions options={draft.scan} onChange={setScanOptions} />
          </Box>
          {draft.scan.mode === "interactive" &&
            p.canShowBrowser &&
            !window.castoriceDesktop && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                受控浏览器在运行采集服务的电脑上打开。远程访问此网页时，请在服务端图形会话操作
              </Typography>
            )}
          {p.canShowBrowser && draft.scan.mode !== "interactive" && (
            <Stack direction="row" sx={{ alignItems: "center", mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.scan.visible}
                    onChange={(_, checked) => setScan("visible", checked)}
                  />
                }
                label="显示受控浏览器"
                sx={{ mr: 0 }}
              />
              <ContextHelp label="查看显示受控浏览器说明">
                {controlledBrowserHelp}
              </ContextHelp>
            </Stack>
          )}
        </Box>
        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 650 }}>
          外观、日志与导出
        </Typography>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap" }}>
          <TextField
            select
            label="主题"
            value={draft.theme}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                theme: e.target.value as Settings["theme"],
              }))
            }
            sx={{ maxWidth: "100%", width: 150 }}
          >
            {Object.entries(themeChoices).map(([value, { label, Icon }]) => (
              <MenuItem key={value} value={value}>
                <Box
                  component="span"
                  sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
                >
                  <Icon fontSize="small" />
                  {label}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="默认显示日志级别"
            value={draft.log_level}
            onChange={(e) =>
              setDraft((d) => ({ ...d, log_level: e.target.value }))
            }
            sx={{ maxWidth: "100%", width: 170 }}
          >
            {["DEBUG", "INFO", "WARN", "ERROR"].map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="默认导出格式"
            value={draft.export_format}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                export_format: e.target.value as Settings["export_format"],
              }))
            }
            sx={{ flex: "1 1 180px", minWidth: 0 }}
          >
            <MenuItem value="clash">Clash / Mihomo YAML</MenuItem>
            <MenuItem value="provider">Rule Provider</MenuItem>
            <MenuItem value="singbox">sing-box JSON v3</MenuItem>
          </TextField>
          <TextField
            label="默认策略组"
            value={draft.policy}
            onChange={(e) =>
              setDraft((d) => ({ ...d, policy: e.target.value }))
            }
            sx={{ maxWidth: "100%", width: 140 }}
          />
        </Stack>
        <Divider sx={{ my: 3 }} />
        <Box>
          {window.castoriceDesktop && (
            <>
              <Typography
                variant="body2"
                sx={{ overflowWrap: "anywhere", mb: 1 }}
              >
                数据目录：{window.castoriceDesktop.dataDir}
              </Typography>
              <Typography
                variant="body2"
                sx={{ overflowWrap: "anywhere", mb: 1 }}
              >
                导出目录：{window.castoriceDesktop.exportDir}
              </Typography>
            </>
          )}
          <Typography variant="caption" color="text.secondary">
            Castorice-WebRuleAnalyzer {APP_VERSION} · Web分流规则分析器
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={p.onClose}>取消</Button>
        <Button
          variant="contained"
          startIcon={<SaveRounded />}
          disabled={busy}
          onClick={() => void save()}
        >
          保存设置
        </Button>
      </DialogActions>
    </Dialog>
  );
}
