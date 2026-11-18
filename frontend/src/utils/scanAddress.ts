import { APIError } from "../services/api";
import type { ScanTarget, ScanTask } from "../types";

export function scanTargetLabel(value: string) {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "历史地址";
  }
}

export function savedScanTarget(task: ScanTask): ScanTarget | undefined {
  const host = scanTargetLabel(task.target_url);
  const bracketed = host.includes(":") ? `[${host}]` : host;
  let origin: string;
  if (task.target_scheme) {
    const port = task.target_port ? `:${task.target_port}` : "";
    origin = `${task.target_scheme}://${bracketed}${port}`;
  } else {
    try {
      origin = new URL(task.target_url).origin;
    } catch {
      return undefined;
    }
  }
  return {
    host,
    url: origin + "/",
    removed_prefix: false,
    removed_suffix: false,
  };
}

const scanMessages: Record<string, string> = {
  dns_not_found: "找不到这个域名，请检查拼写。",
  dns_no_address: "这个域名没有可用的网址记录，请检查拼写。",
  dns_timeout: "域名解析超时，请检查网络后重试。",
  dns_failed: "暂时无法解析这个域名，请检查网络后重试。",
  dns_non_public: "这个域名解析到了非公网地址，请检查域名或 DNS 设置。",
  target_internal: "请输入公网域名。当前地址属于本机或内网。",
  target_non_public: "请输入公网 IP 地址。",
  target_port: "这个网站端口暂时不可用，请检查输入。",
  browser_start_failed: "采集浏览器未能启动，请检查浏览器设置。",
};

export function scanAddressIssue(error: unknown) {
  if (error instanceof APIError) {
    return scanMessages[error.code] || error.message;
  }
  return "暂时无法检查地址，请确认应用服务正在运行。";
}
