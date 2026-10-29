import { APP_VERSION } from "../version";
import { useEffect, useState } from "react";
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
  DeleteOutlineRounded,
  LibraryBooksRounded,
  SaveRounded,
} from "@mui/icons-material";
import type { ScanOptions, Settings } from "../types";
import { api } from "../services/api";
import { errorMessage, modeNames } from "../utils/format";
interface Props {
  canShowBrowser: boolean;
  settings: Settings;
  onSave: (v: Settings) => void;
  onClose: () => void;
  onLibrary: () => void;
  notify: (s: string) => void;
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
  const number = (
    label: string,
    key: keyof ScanOptions,
    min: number,
    max: number,
  ) => (
    <TextField
      label={label}
      type="number"
      value={draft.scan[key]}
      onChange={(e) => setScan(key, Number(e.target.value))}
      slotProps={{ htmlInput: { min, max } }}
      sx={{ minWidth: 140, flex: 1 }}
    />
  );
  async function save() {
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
    <Dialog open fullWidth maxWidth="md" onClose={p.onClose}>
      <DialogTitle>
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
        <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 650 }}>
          默认扫描参数
        </Typography>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap" }}>
          <TextField
            select
            label="默认模式"
            value={draft.scan.mode}
            onChange={(e) =>
              setScan("mode", e.target.value as ScanOptions["mode"])
            }
            sx={{ width: 170 }}
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
          {number("总时长上限 / 秒", "max_seconds", 1, 3600)}
          {number("探索深度", "max_depth", 0, 8)}
          {number("最大页面数", "max_pages", 1, 200)}
        </Stack>
        <Stack direction="row" sx={{ mt: 2, gap: 1.5, flexWrap: "wrap" }}>
          {number("导航超时 / 秒", "navigation_seconds", 1, 120)}
          {number("每页观察上限 / 秒", "observe_seconds", 1, 300)}
          {number("静默等待 / 毫秒", "quiet_millis", 100, 30000)}
          {number("页面间隔 / 毫秒", "interval_millis", 0, 30000)}
        </Stack>
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
        >
          <MenuItem value="">自动检测（Chrome / Edge / Chromium）</MenuItem>
          {browsers.map((b) => (
            <MenuItem key={b.path} value={b.path}>
              {b.name} · {b.path}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="自定义浏览器可执行文件路径（留空自动检测）"
          fullWidth
          value={draft.scan.browser_path}
          onChange={(e) => setScan("browser_path", e.target.value)}
          sx={{ mt: 2 }}
        />
        <TextField
          select
          fullWidth
          label="采集 DNS 解析"
          value={draft.scan.dns_mode || "auto"}
          onChange={(e) =>
            setScan("dns_mode", e.target.value as "auto" | "system")
          }
          sx={{ mt: 2 }}
        >
          <MenuItem value="auto">系统 DNS + Fake-IP 安全回退</MenuItem>
          <MenuItem value="system">仅系统 DNS</MenuItem>
        </TextField>
        <Typography variant="caption" color="text.secondary">
          系统答案含已知 Fake-IP、且其余均为公网地址时，自动模式通过 Cloudflare
          1.1.1.1 HTTPS DNS 查询域名，仍校验公网地址；不更改系统 DNS。
        </Typography>
        <FormControlLabel
          control={
            <Switch
              disabled={!p.canShowBrowser}
              checked={draft.scan.visible}
              onChange={(_, checked) => setScan("visible", checked)}
            />
          }
          label="默认显示受控浏览器"
          sx={{ mt: 1 }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block" }}
        >
          始终使用独立临时 Profile。结束后自动删除；异常退出残留可手动清理。
        </Typography>
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
            sx={{ width: 140 }}
          >
            <MenuItem value="light">浅色</MenuItem>
            <MenuItem value="dark">深色</MenuItem>
            <MenuItem value="system">跟随系统</MenuItem>
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
    </Dialog>
  );
}
