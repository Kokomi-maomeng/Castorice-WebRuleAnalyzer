import NetworkOptions from "./NetworkOptions";
import ScanNumberFields, { invalidScanField } from "./ScanNumberFields";
import { APP_VERSION } from "../version";
import { useEffect, useState, type ReactNode } from "react";
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
  TextField,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  DarkModeRounded,
  DeleteOutlineRounded,
  DevicesRounded,
  LibraryBooksRounded,
  LightModeRounded,
  SaveRounded,
} from "@mui/icons-material";
import type { ScanOptions, Settings } from "../types";
import { api } from "../services/api";
import { errorMessage, modeNames } from "../utils/format";
import ContextHelp from "./ContextHelp";
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
  onSave: (v: Settings) => void;
  onClose: () => void;
  onLibrary: () => void;
  notify: (s: string) => void;
  children?: ReactNode;
}
export default function SettingsDialog(p: Props) {
  const [draft, setDraft] = useState(p.settings);
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
      setError(`请修正「${invalid}」。`);
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
  async function clear(path: string, message: string) {
    setBusy(true);
    setError("");
    try {
      await api(path, "DELETE");
      p.notify(message);
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
      <DialogTitle id="software-settings-title">
        软件设置
        <IconButton
          aria-label="关闭设置"
          onClick={p.onClose}
          sx={{ float: "right" }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack direction="row" sx={{ mb: 2, alignItems: "center", gap: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 650 }}>
            默认扫描参数
          </Typography>
          <ContextHelp label="默认扫描参数应用范围">
            保存后应用于尚未编辑的工作区，或清空工作区后的下一次扫描。
          </ContextHelp>
        </Stack>
        <Box className="advanced-grid">
          <TextField
            select
            label="默认模式"
            value={draft.scan.mode}
            onChange={(e) =>
              setScan("mode", e.target.value as ScanOptions["mode"])
            }
            fullWidth
          >
            {Object.entries(modeNames).map(([key, name]) => (
              <MenuItem
                key={key}
                value={key}
                disabled={key === "interactive" && !p.canShowBrowser}
              >
                {name}
              </MenuItem>
            ))}
          </TextField>
          <ScanNumberFields options={draft.scan} change={setScanOptions} />
        </Box>
        <Divider sx={{ my: 3 }} />
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
              ? "采集浏览器由服务管理员指定。"
              : browsers.length
                ? "从运行采集服务的电脑选择。"
                : "未检测到浏览器，请安装 Chrome、Edge 或 Chromium。"
          }
        >
          <MenuItem value="">自动检测（Chrome / Edge / Chromium）</MenuItem>
          {browsers.map((b) => (
            <MenuItem key={b.path} value={b.path}>
              {b.name} · {b.path}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ mt: 2 }}>
          <NetworkOptions options={draft.scan} onChange={setScanOptions} />
        </Box>
        <Stack direction="row" sx={{ alignItems: "center", mt: 1 }}>
          <FormControlLabel
            control={
              <Switch
                disabled={!p.canShowBrowser}
                checked={draft.scan.visible}
                onChange={(_, checked) => setScan("visible", checked)}
              />
            }
            label="默认显示受控浏览器"
            sx={{ mr: 0 }}
          />
          <ContextHelp label="默认显示受控浏览器说明">
            快速扫描和自动探索时，开启会显示独立的采集窗口，关闭则在无头模式运行。辅助交互始终显示窗口。采集使用临时浏览器资料，正常结束后自动清理。
          </ContextHelp>
        </Stack>
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
            sx={{ width: 150 }}
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
            sx={{ width: 170 }}
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
            sx={{ flex: 1, minWidth: 180 }}
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
            sx={{ width: 140 }}
          />
        </Stack>
        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 650 }}>
          规则库与本地缓存
        </Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
          <Button startIcon={<LibraryBooksRounded />} onClick={p.onLibrary}>
            管理 / 更新规则库
          </Button>
          <Button
            color="warning"
            disabled={busy}
            startIcon={<DeleteOutlineRounded />}
            onClick={() =>
              void clear(
                "/rules/cache",
                "缓存已清理，保留更新开关；已开启的来源会重新下载",
              )
            }
          >
            清理规则缓存
          </Button>
          <Button
            disabled={busy}
            startIcon={<DeleteOutlineRounded />}
            onClick={() =>
              void clear("/browser/sessions", "残留浏览器会话已清理")
            }
          >
            清理残留会话
          </Button>
        </Stack>
        <Box sx={{ mt: 2 }}>
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
      {p.children}
    </Dialog>
  );
}
