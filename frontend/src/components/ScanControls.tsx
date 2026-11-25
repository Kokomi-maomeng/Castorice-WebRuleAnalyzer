import NetworkOptions from "./NetworkOptions";
import NetworkDialog from "./NetworkDialog";
import ScanModeSelect from "./ScanModeSelect";
import ScanNumberFields, { invalidScanField } from "./ScanNumberFields";
import ContextHelp from "./ContextHelp";
import { useState, type ClipboardEvent } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fade,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowForwardRounded,
  CloseRounded,
  LinkRounded,
  RestartAltRounded,
  StopRounded,
  TuneRounded,
} from "@mui/icons-material";
import type { ScanOptions, ScanTarget } from "../types";

interface Props {
  canShowBrowser: boolean;
  url: string;
  target?: ScanTarget;
  addressIssue: string;
  addressNotice: string;
  showingEarlierResult: boolean;
  historyTarget?: string;
  browserAvailable: boolean;
  setURL: (v: string) => void;
  onNormalize: (v: string, freshlyEdited?: boolean) => void;
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
  const [diagnosticMounted, setDiagnosticMounted] = useState(false);
  const { mode } = p.options;
  const set = <K extends keyof ScanOptions>(key: K, value: ScanOptions[K]) =>
    p.setOptions({ ...p.options, [key]: value });
  const invalid = invalidScanField(p.options);
  const canStart =
    !p.running && !p.busy && p.browserAvailable && p.url.trim() && !invalid;
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
          if (canStart) p.onStart();
        }}
        className="scan-form"
      >
        <Box className="scan-address">
          <TextField
            fullWidth
            label="要分析的网站"
            value={p.url}
            error={!!p.addressIssue}
            disabled={p.running}
            onChange={(e) => p.setURL(e.target.value)}
            onBlur={(e) => {
              if (!p.busy && !p.running && !p.addressIssue)
                p.onNormalize(e.target.value);
            }}
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
              htmlInput: {
                spellCheck: false,
                autoCapitalize: "none",
                inputMode: "url",
                onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
                  const input = e.currentTarget;
                  if (
                    p.busy ||
                    input.selectionStart !== 0 ||
                    input.selectionEnd !== input.value.length
                  )
                    return;
                  const value = e.clipboardData.getData("text");
                  if (!value) return;
                  e.preventDefault();
                  p.setURL(value);
                  p.onNormalize(value, true);
                },
              },
              input: {
                readOnly: p.busy,
                startAdornment: (
                  <InputAdornment position="start">
                    <LinkRounded color="primary" />
                  </InputAdornment>
                ),
                endAdornment: p.addressIssue && (
                  <InputAdornment position="end">
                    <ContextHelp label="查看地址问题" error>
                      {p.addressIssue}
                      {p.showingEarlierResult && (
                        <div>下方仍显示上次采集结果。</div>
                      )}
                    </ContextHelp>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box aria-live="polite" className="sr-only">
            {p.addressIssue}
          </Box>
          <Fade in={!!p.addressNotice} mountOnEnter unmountOnExit>
            <Paper
              className="scan-address-notice"
              role="status"
              elevation={2}
              sx={{ borderColor: "divider" }}
            >
              {p.addressNotice}
            </Paper>
          </Fade>
        </Box>
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
              disabled={!canStart}
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
      {p.historyTarget && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.75, overflowWrap: "anywhere" }}
        >
          历史域名 {p.historyTarget}。原地址已脱敏，重新采集时请填写域名。
        </Typography>
      )}
      {invalid && (
        <Typography variant="body2" color="error">
          请在高级配置中修正「{invalid}」。
        </Typography>
      )}
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
            <ScanNumberFields
              options={p.options}
              change={p.setOptions}
              disabled={p.running}
            />
            <Box sx={{ gridColumn: "1 / -1" }}>
              <NetworkOptions options={p.options} onChange={p.setOptions} />
            </Box>
          </Box>
          {mode === "interactive" && !window.castoriceDesktop && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              受控浏览器在运行采集服务的电脑上打开。远程访问此网页时，请在服务端图形会话操作。
            </Typography>
          )}
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
          <Button
            onClick={() => {
              setDiagnosticMounted(true);
              setDiagnosing(true);
            }}
            sx={{ mr: "auto" }}
          >
            网络诊断
          </Button>
          <Button onClick={() => setAdvanced(false)}>完成</Button>
        </DialogActions>
        {diagnosticMounted && (
          <NetworkDialog
            open={diagnosing}
            onClose={() => setDiagnosing(false)}
            onExited={() => {
              if (!diagnosing) setDiagnosticMounted(false);
            }}
            url={p.target?.url || p.url}
            label={p.target?.host}
            options={p.options}
            onApply={p.setOptions}
            notify={p.notify}
          />
        )}
      </Dialog>
    </Paper>
  );
}
