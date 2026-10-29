import { useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowForwardRounded,
  CloseRounded,
  LinkRounded,
  StopRounded,
  TuneRounded,
} from "@mui/icons-material";
import type { ScanOptions } from "../types";
import { modeNames } from "../utils/format";
interface Props {
  canShowBrowser: boolean;
  url: string;
  setURL: (v: string) => void;
  options: ScanOptions;
  setOptions: (v: ScanOptions) => void;
  running: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}
export default function ScanControls(p: Props) {
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof ScanOptions>(key: K, value: ScanOptions[K]) =>
    p.setOptions({ ...p.options, [key]: value });
  const number = (
    label: string,
    key: keyof ScanOptions,
    min: number,
    max: number,
  ) => (
    <TextField
      label={label}
      type="number"
      value={p.options[key]}
      onChange={(e) => set(key, Number(e.target.value))}
      slotProps={{ htmlInput: { min, max } }}
      disabled={p.running}
      fullWidth
    />
  );
  return (
    <Paper
      component="section"
      className="scan-controls"
      sx={{ p: 1.5, border: 1, borderColor: "divider", flexShrink: 0 }}
    >
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!p.running && !p.busy) {
            if (p.url.trim()) p.onStart();
            else p.onReset();
          }
        }}
        className="scan-form"
      >
        <TextField
          fullWidth
          label="要分析的网站"
          placeholder="example.com 或完整 URL"
          value={p.url}
          disabled={p.running}
          onChange={(e) => p.setURL(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              !p.url.trim() &&
              !p.running &&
              !p.busy
            ) {
              e.preventDefault();
              p.onReset();
            }
          }}
          autoComplete="off"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <LinkRounded color="primary" />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          label="扫描模式"
          value={p.options.mode}
          onChange={(e) => set("mode", e.target.value as ScanOptions["mode"])}
          disabled={p.running}
          className="scan-mode"
        >
          {Object.entries(modeNames).map(([v, label]) => (
            <MenuItem
              key={v}
              value={v}
              disabled={v === "interactive" && !p.canShowBrowser}
            >
              {label}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title={`高级设置 · 最长 ${p.options.max_seconds} 秒`}>
          <Button
            className="advanced-button"
            startIcon={<TuneRounded />}
            onClick={() => setAdvanced(true)}
            aria-label="高级设置"
          >
            <span>高级设置</span>
          </Button>
        </Tooltip>
        {p.running ? (
          <Button
            variant="contained"
            color="error"
            startIcon={<StopRounded />}
            onClick={p.onStop}
            disabled={p.busy}
          >
            停止采集
          </Button>
        ) : (
          <Button
            type="submit"
            variant="contained"
            endIcon={
              p.busy ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <ArrowForwardRounded />
              )
            }
            disabled={p.busy || !p.url.trim()}
          >
            开始分析
          </Button>
        )}
      </Box>
      <Dialog
        open={advanced}
        onClose={() => setAdvanced(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          本次扫描参数
          <IconButton
            aria-label="关闭高级设置"
            onClick={() => setAdvanced(false)}
            sx={{ float: "right" }}
          >
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 2,
              pt: 0.5,
            }}
          >
            <TextField
              select
              label="扫描模式"
              value={p.options.mode}
              onChange={(e) =>
                set("mode", e.target.value as ScanOptions["mode"])
              }
              disabled={p.running}
              sx={{ gridColumn: "1 / -1" }}
            >
              {Object.entries(modeNames).map(([v, label]) => (
                <MenuItem
                  key={v}
                  value={v}
                  disabled={v === "interactive" && !p.canShowBrowser}
                >
                  {label}
                </MenuItem>
              ))}
            </TextField>
            {number("总时长 / 秒", "max_seconds", 1, 3600)}
            {number("探索深度", "max_depth", 0, 8)}
            {number("最多页面", "max_pages", 1, 200)}
            {number("导航超时 / 秒", "navigation_seconds", 1, 120)}
            {number("每页观察 / 秒", "observe_seconds", 1, 300)}
            {number("静默等待 / 毫秒", "quiet_millis", 100, 30000)}
            {number("页面间隔 / 毫秒", "interval_millis", 0, 30000)}
            <TextField
              select
              label="DNS 解析"
              value={p.options.dns_mode || "auto"}
              disabled={p.running}
              onChange={(e) =>
                set("dns_mode", e.target.value as "auto" | "system")
              }
            >
              <MenuItem value="auto">系统 + Fake-IP 回退</MenuItem>
              <MenuItem value="system">仅系统 DNS</MenuItem>
            </TextField>
          </Box>
          <Stack sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={
                    p.options.visible || p.options.mode === "interactive"
                  }
                  disabled={
                    p.running ||
                    p.options.mode === "interactive" ||
                    !p.canShowBrowser
                  }
                  onChange={(_, value) => set("visible", value)}
                />
              }
              label="显示受控浏览器"
            />
            <Typography variant="caption" color="text.secondary">
              {!p.canShowBrowser
                ? "当前服务无图形会话，使用无头浏览器采集。"
                : ""}
              自动探索仅访问同源普通链接，不点击按钮或提交表单。参数仅用于本次扫描，默认值可在软件设置中保存。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdvanced(false)}>完成</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
