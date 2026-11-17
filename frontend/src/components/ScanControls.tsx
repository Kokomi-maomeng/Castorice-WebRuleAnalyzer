import NetworkOptions from "./NetworkOptions";
import NetworkDialog from "./NetworkDialog";
import ScanModeSelect from "./ScanModeSelect";
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
  Paper,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import {
  ArrowForwardRounded,
  CloseRounded,
  LinkRounded,
  RestartAltRounded,
  StopRounded,
  TuneRounded,
} from "@mui/icons-material";
import type { ScanOptions } from "../types";

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
  notify: (s: string) => void;
}
export default function ScanControls(p: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const { mode } = p.options;
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
      onBlur={(e) => {
        const value = Number(e.target.value);
        const bounded = Math.min(max, Math.max(min, Math.trunc(value)));
        if (bounded !== value) set(key, bounded);
      }}
      slotProps={{ htmlInput: { min, max } }}
      disabled={p.running}
      fullWidth
    />
  );
  const modeSelect = () => (
    <ScanModeSelect
      value={mode}
      onChange={(value) => set("mode", value)}
      disabled={p.running || p.busy}
      canShowBrowser={p.canShowBrowser}
    />
  );

  return (
    <Paper
      component="section"
      className="scan-controls"
      sx={{ p: 1.25, border: 1, borderColor: "divider", flexShrink: 0 }}
    >
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!p.running && !p.busy && p.url.trim()) p.onStart();
        }}
        className="scan-form"
      >
        <TextField
          fullWidth
          label="要分析的网站"
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
        {modeSelect()}
        <Button
          className="advanced-button"
          startIcon={<TuneRounded />}
          onClick={() => setAdvanced(true)}
          aria-label="高级配置"
          title="高级配置"
          disabled={p.busy || p.running}
        >
          <span>高级配置</span>
        </Button>
        <Stack direction="row" className="scan-actions" sx={{ gap: 0.75 }}>
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
              开始采集
            </Button>
          )}
          <Button
            className="clear-workspace"
            startIcon={<RestartAltRounded />}
            onClick={() => p.onReset()}
            disabled={p.running || p.busy}
          >
            清空工作区
          </Button>
        </Stack>
      </Box>
      <Dialog
        open={advanced}
        aria-labelledby="advanced-config-title"
        onClose={() => setAdvanced(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="advanced-config-title">
          高级配置
          <IconButton
            aria-label="关闭高级配置"
            onClick={() => setAdvanced(false)}
            sx={{ float: "right" }}
          >
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box className="advanced-grid" sx={{ pt: 0.5 }}>
            <Box sx={{ gridColumn: "1 / -1" }}>{modeSelect()}</Box>
            {number("总时长 / 秒", "max_seconds", 1, 3600)}
            {number("导航超时 / 秒", "navigation_seconds", 1, 120)}
            {mode !== "interactive" &&
              number("每页观察 / 秒", "observe_seconds", 1, 300)}
            {mode !== "interactive" &&
              number("静默等待 / 毫秒", "quiet_millis", 100, 30000)}
            {mode !== "quick" && number("最多页面", "max_pages", 1, 200)}
            {mode === "explore" && number("探索深度", "max_depth", 0, 8)}
            {mode === "explore" &&
              number("页面间隔 / 毫秒", "interval_millis", 0, 30000)}
            <Box sx={{ gridColumn: "1 / -1" }}>
              <NetworkOptions options={p.options} onChange={p.setOptions} />
            </Box>
          </Box>
          {p.canShowBrowser && mode !== "interactive" && (
            <FormControlLabel
              sx={{ mt: 0.75 }}
              control={
                <Switch
                  checked={p.options.visible}
                  disabled={p.running}
                  onChange={(_, value) => set("visible", value)}
                />
              }
              label="显示受控浏览器"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiagnosing(true)} sx={{ mr: "auto" }}>
            网络诊断
          </Button>
          <Button onClick={() => setAdvanced(false)}>完成</Button>
        </DialogActions>
        {diagnosing && (
          <NetworkDialog
            open
            onClose={() => setDiagnosing(false)}
            url={p.url}
            options={p.options}
            onApply={p.setOptions}
            notify={p.notify}
          />
        )}
      </Dialog>
    </Paper>
  );
}
