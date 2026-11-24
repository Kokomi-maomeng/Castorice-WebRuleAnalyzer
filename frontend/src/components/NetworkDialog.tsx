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
  Stack,
  Typography,
} from "@mui/material";
import { CloseRounded, ContentCopyRounded } from "@mui/icons-material";
import { api, copy } from "../services/api";
import type { DNSCheck, NetworkDiagnosis, ScanOptions } from "../types";
import { errorMessage } from "../utils/format";
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
  onApply: (o: ScanOptions) => void;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState(p.options),
    [result, setResult] = useState<NetworkDiagnosis>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const [compareSecure, setCompareSecure] = useState(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function diagnose() {
    const g = ++generation.current;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const data = await api<NetworkDiagnosis>("/network/diagnose", "POST", {
        url: p.url,
        options: draft,
        compare_secure: compareSecure,
        root_only: true,
      });
      if (g === generation.current) setResult(data);
    } catch (e) {
      if (g === generation.current) setError(scanAddressIssue(e));
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  function change(o: ScanOptions) {
    generation.current++;
    setBusy(false);
    setResult(undefined);
    setDraft(o);
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
      <DialogTitle id="network-diagnostic-title">
        网络诊断与本次网络设置
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
          {p.label ? `检测目标：${p.label}` : "请在主界面填写有效的域名。"}
        </Typography>
        <NetworkOptions options={draft} onChange={change} />
        {draft.dns_mode === "secure" ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            选择独立安全 DNS 会将公网目标名交给{" "}
            {draft.dns_provider === "google" ? "Google" : "Cloudflare"} 解析。
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
        <Button
          sx={{ my: 2 }}
          variant="outlined"
          onClick={() => void diagnose()}
          disabled={busy || !p.url.trim()}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
        >
          {busy ? "正在检测解析与连接…" : "运行网络诊断"}
        </Button>
        {error && <Alert severity="error">{error}</Alert>}
        {result && (
          <Stack className="motion-panel" sx={{ gap: 1 }}>
            <Typography variant="body2">连接路径：{result.route}</Typography>
            {result.secure_note && (
              <Typography variant="body2" color="text.secondary">
                {result.secure_note}
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
                连接；页面、证书及业务可用性需要实际扫描核对。
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
            p.notify("已应用本次网络配置");
          }}
        >
          用于本次扫描
        </Button>
      </DialogActions>
    </Dialog>
  );
}
