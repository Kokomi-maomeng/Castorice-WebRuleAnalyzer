import ScanModeSelect from "./ScanModeSelect";
import { invalidScanField } from "./ScanNumberFields";
import ContextHelp from "./ContextHelp";
import { useEffect, useState, type ClipboardEvent } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Fade,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowForwardRounded,
  LinkRounded,
  PauseRounded,
  PlayArrowRounded,
  RestartAltRounded,
  StopRounded,
} from "@mui/icons-material";
import type { ScanOptions, ScanTask } from "../types";
import { tipText } from "../utils/format";

interface Props {
  canShowBrowser: boolean;
  url: string;
  addressIssue: string;
  addressNotice: string;
  showingEarlierResult: boolean;
  historyTarget?: string;
  browserAvailable: boolean;
  setURL: (v: string) => void;
  onNormalize: (v: string, freshlyEdited?: boolean) => void;
  options: ScanOptions;
  setMode: (mode: ScanOptions["mode"]) => void;
  running: boolean;
  busy: boolean;
  interactiveTask?: ScanTask;
  recordingPending: boolean;
  onRecordingChange: (paused: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}
export default function ScanControls(p: Props) {
  const invalid = invalidScanField(p.options);
  const canStart =
    !p.running && !p.busy && p.browserAvailable && p.url.trim() && !invalid;

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
                      {tipText(p.addressIssue)}
                      {p.showingEarlierResult && (
                        <div>下方仍显示上次采集结果</div>
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
              {tipText(p.addressNotice)}
            </Paper>
          </Fade>
        </Box>
        <ScanModeSelect
          value={p.options.mode}
          onChange={p.setMode}
          disabled={p.running || p.busy}
          canShowBrowser={p.canShowBrowser}
        />
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
      {p.interactiveTask && (
        <InteractiveControls
          task={p.interactiveTask}
          busy={p.busy || p.recordingPending}
          onChange={p.onRecordingChange}
        />
      )}
      {p.historyTarget && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.75, overflowWrap: "anywhere" }}
        >
          历史域名 {p.historyTarget}。原地址已脱敏，重新采集时请填写域名
        </Typography>
      )}
      {invalid && (
        <Typography variant="body2" color="error">
          请在软件设置中修正「{invalid}」
        </Typography>
      )}
    </Paper>
  );
}

function InteractiveControls({
  task,
  busy,
  onChange,
}: {
  task: ScanTask;
  busy: boolean;
  onChange: (paused: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  const paused = !!task.recording_paused;
  const elapsed = Math.max(
    0,
    Math.floor((now - Date.parse(task.started_at)) / 1000),
  );
  const remaining = Math.max(0, task.options.max_seconds - elapsed);
  return (
    <Stack
      direction="row"
      sx={{ mt: 1, gap: 1, alignItems: "center", flexWrap: "wrap" }}
    >
      <Button
        size="small"
        variant={paused ? "contained" : "outlined"}
        startIcon={paused ? <PlayArrowRounded /> : <PauseRounded />}
        disabled={busy || !remaining}
        onClick={() => onChange(!paused)}
      >
        {paused ? "继续记录" : "暂停记录"}
      </Button>
      {paused && (
        <Typography variant="body2" color="text.secondary" role="status">
          记录已暂停，浏览器和登录状态保留
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" role="timer">
        剩余 {remaining} 秒
      </Typography>
    </Stack>
  );
}
