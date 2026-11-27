import { useRef, useState, useEffect } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { CloseRounded, ContentCopyRounded } from "@mui/icons-material";
import { api, copy } from "../services/api";
import type { DNSCheck, NetworkDiagnosis, ScanOptions } from "../types";
import { errorMessage, tipText } from "../utils/format";
import { scanAddressIssue } from "../utils/scanAddress";
import DiagnosticAlert from "./DiagnosticAlert";
import NetworkOptions from "./NetworkOptions";

export default function NetworkDialog(p: {
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  url: string;
  label?: string;
  options: ScanOptions;
  onApply: (options: ScanOptions) => void;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState(p.options),
    [result, setResult] = useState<NetworkDiagnosis>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const request = useRef<AbortController>(undefined);
  const [compareSecure, setCompareSecure] = useState(false);
  const [http3Mode, setHTTP3Mode] = useState<"" | "selected" | "direct">("");
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );
  async function diagnose() {
    const g = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const data = await api<NetworkDiagnosis>(
        "/network/diagnose",
        "POST",
        {
          url: p.url,
          options: draft,
          compare_secure: compareSecure,
          root_only: true,
          http3_mode: http3Mode || undefined,
        },
        { signal: controller.signal },
      );
      if (g === generation.current) setResult(data);
    } catch (e) {
      if (g === generation.current) setError(scanAddressIssue(e));
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  function change(o: ScanOptions) {
    generation.current++;
    request.current?.abort();
    setBusy(false);
    setResult(undefined);
    if (http3Mode === "direct" && draft.upstream_proxy !== o.upstream_proxy) {
      setHTTP3Mode("selected");
    }
    setDraft(o);
  }
  function changeHTTP3Mode(mode: typeof http3Mode) {
    setHTTP3Mode(mode);
    setResult(undefined);
  }
  return (
    <Dialog
      open={p.open}
      aria-labelledby="network-diagnostic-title"
      onClose={p.onClose}
      slotProps={{ transition: { onExited: p.onExited } }}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle id="network-diagnostic-heading">
        <Box component="span" id="network-diagnostic-title">
          网络诊断
        </Box>
        <IconButton
          aria-label="关闭网络诊断"
          onClick={p.onClose}
          sx={{ float: "right" }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ mb: 2, overflowWrap: "anywhere" }}>
          {p.label ? `检测目标：${p.label}` : "请在主界面填写有效的域名"}
        </Typography>
        <NetworkOptions options={draft} onChange={change} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          可用这里的 DNS 和代理运行诊断，也可临时应用到下次扫描
        </Typography>
        {draft.dns_mode === "secure" ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            选择独立安全 DNS 会将公网目标名交给{" "}
            {draft.dns_provider === "google" ? "Google" : "Cloudflare"} 解析
          </Typography>
        ) : (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Checkbox
                checked={compareSecure}
                disabled={busy}
                onChange={(_, checked) => {
                  setCompareSecure(checked);
                  setResult(undefined);
                }}
              />
            }
            label={`另用 ${draft.dns_provider === "google" ? "Google" : "Cloudflare"} HTTPS DNS 对照解析`}
          />
        )}
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={!!http3Mode}
                disabled={busy}
                onChange={(_, checked) =>
                  changeHTTP3Mode(checked ? "selected" : "")
                }
              />
            }
            label="探测 QUIC / HTTP/3"
          />
          {http3Mode && draft.upstream_proxy && (
            <RadioGroup
              aria-label="HTTP/3 探测路径"
              value={http3Mode}
              onChange={(_, value) =>
                changeHTTP3Mode(value === "direct" ? "direct" : "selected")
              }
              sx={{ pl: 2 }}
            >
              <FormControlLabel
                value="selected"
                control={<Radio disabled={busy} />}
                label="沿用所选网络路径"
              />
              <FormControlLabel
                value="direct"
                control={<Radio disabled={busy} />}
                label="仅此探测独立使用系统网络"
              />
            </RadioGroup>
          )}
        </Box>
        <Button
          sx={{ my: 2 }}
          variant="outlined"
          onClick={() => void diagnose()}
          disabled={busy || !p.url.trim()}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
        >
          {busy ? "正在检测解析与连接…" : "运行网络诊断"}
        </Button>
        {error && <Alert severity="error">{tipText(error)}</Alert>}
        {result && (
          <Stack className="motion-panel" sx={{ gap: 1 }}>
            {result.http3 && <HTTP3Result result={result.http3} />}
            <Typography variant="body2">连接路径：{result.route}</Typography>
            {result.secure_note && (
              <Typography variant="body2" color="text.secondary">
                {tipText(result.secure_note)}
              </Typography>
            )}
            {(
              [
                ["系统解析", result.system],
                ["独立安全解析", result.secure],
              ] as [string, DNSCheck | undefined][]
            ).map(([label, value]) => {
              if (!value) return null;
              return (
                <Box
                  key={label}
                  sx={{
                    p: 1.5,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 2,
                  }}
                >
                  <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
                  <Typography
                    className="mono"
                    sx={{ overflowWrap: "anywhere", my: 0.5 }}
                  >
                    {value.addresses.join("、") || "未取得地址"}
                  </Typography>
                  {value.diagnostic && (
                    <DiagnosticAlert
                      diagnostic={value.diagnostic}
                      severity="warning"
                    />
                  )}
                </Box>
              );
            })}
            {result.connection ? (
              <DiagnosticAlert
                diagnostic={result.connection}
                severity="warning"
              />
            ) : (
              <Alert severity="success">
                当前所选路径已建立 TCP
                连接。可通过实际扫描核对页面、证书及业务可用性
              </Alert>
            )}
            <Button
              startIcon={<ContentCopyRounded />}
              onClick={() =>
                void copy(JSON.stringify(result, null, 2))
                  .then(() => p.notify("诊断已复制"))
                  .catch((e) => p.notify(errorMessage(e)))
              }
            >
              复制诊断结果
            </Button>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>关闭</Button>
        <Button
          variant="contained"
          onClick={() => {
            p.onApply(draft);
            p.onClose();
            p.notify("下次扫描将使用这里的网络选项");
          }}
        >
          用于下次扫描
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HTTP3Result({
  result,
}: {
  result: NonNullable<NetworkDiagnosis["http3"]>;
}) {
  return (
    <Stack
      sx={{
        p: 1.5,
        gap: 0.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
      }}
    >
      <Typography sx={{ fontWeight: 600 }}>QUIC / HTTP/3 探测</Typography>
      <Typography variant="body2">{result.route}</Typography>
      <Typography variant="body2">
        {result.advertised === undefined
          ? "未取得 Alt-Svc 声明"
          : `${result.advertisement_source} ${result.advertised ? "声明了 h3" : "未声明 h3"}`}
      </Typography>
      <Typography variant="body2">
        {result.alpn ? `实际协商 ${result.alpn}` : "未协商 HTTP/3"}
        {result.http_status
          ? ` · HTTP ${result.http_status}`
          : " · 未取得 HTTP 响应"}
      </Typography>
      {result.diagnostic && (
        <DiagnosticAlert diagnostic={result.diagnostic} severity="warning" />
      )}
    </Stack>
  );
}
