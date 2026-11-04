import { Box, MenuItem, TextField, Typography } from "@mui/material";
import type { ScanOptions } from "../types";

export default function NetworkOptions({
  options,
  onChange,
}: {
  options: ScanOptions;
  onChange: (o: ScanOptions) => void;
}) {
  const set = <K extends keyof ScanOptions>(key: K, value: ScanOptions[K]) =>
    onChange({ ...options, [key]: value });
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
        gap: 1.5,
      }}
    >
      <TextField
        select
        label="DNS 解析"
        value={options.dns_mode || "auto"}
        onChange={(e) =>
          set("dns_mode", e.target.value as ScanOptions["dns_mode"])
        }
      >
        <MenuItem value="auto">系统 + Fake-IP 安全回退</MenuItem>
        <MenuItem value="system">仅系统 DNS</MenuItem>
        <MenuItem value="secure">独立安全 DNS</MenuItem>
      </TextField>
      <TextField
        select
        label="安全 DNS 服务"
        value={options.dns_provider || "cloudflare"}
        disabled={options.dns_mode === "system"}
        onChange={(e) =>
          set("dns_provider", e.target.value as ScanOptions["dns_provider"])
        }
      >
        <MenuItem value="cloudflare">Cloudflare</MenuItem>
        <MenuItem value="google">Google Public DNS</MenuItem>
      </TextField>
      <TextField
        label="本机代理（可选）"
        value={options.upstream_proxy || ""}
        placeholder="http://127.0.0.1:端口"
        onChange={(e) => set("upstream_proxy", e.target.value.trim())}
        helperText="支持 HTTP / SOCKS5 回环 IP，无认证；留空使用系统网络。"
        sx={{ gridColumn: "1 / -1" }}
      />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ gridColumn: "1 / -1" }}
      >
        {options.dns_mode === "secure"
          ? "独立模式使用所选 HTTPS DNS，替代系统解析答案；所有实际目标仍校验公网地址。"
          : "自动模式只回退已知 Fake-IP，不覆盖回环或私网答案。"}{" "}
        系统网络仍可由 TUN 接管。
      </Typography>
    </Box>
  );
}
