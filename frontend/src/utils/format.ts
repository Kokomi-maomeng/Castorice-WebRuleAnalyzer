import type { ScanTask, Settings } from "../types";
export const defaultSettings: Settings = {
  scan: {
    dns_mode: "auto",
    mode: "quick",
    max_seconds: 180,
    max_depth: 2,
    max_pages: 20,
    navigation_seconds: 30,
    quiet_millis: 1500,
    interval_millis: 500,
    observe_seconds: 10,
    visible: false,
    browser_path: "",
  },
  theme: "light",
  log_level: "INFO",
  export_format: "clash",
  policy: "dibao",
};
export const modeNames: Record<string, string> = {
  quick: "快速扫描",
  explore: "自动探索",
  interactive: "辅助交互",
};
export const statusNames: Record<string, string> = {
  starting: "准备浏览器",
  running: "正在采集",
  stopping: "正在停止",
  completed: "扫描完成",
  cancelled: "已停止",
  timed_out: "达到时间上限",
  failed: "扫描失败",
};
export const reasonNames: Record<string, string> = {
  completed: "完成当前扫描队列",
  user_stopped: "用户主动停止",
  time_limit: "达到最大扫描时间",
  page_limit: "达到页面数量上限",
  request_limit: "达到 20,000 条请求上限",
  resource_limit: "达到页面或请求数量上限",
  navigation_failed: "页面无法完成导航",
  browser_start_failed: "浏览器启动失败",
  browser_exited: "受控浏览器已退出",
  service_interrupted: "服务异常中断",
  database_error: "数据库写入失败",
  service_shutdown: "服务关闭",
  unsafe_target: "目标被安全策略阻止",
  origin_changed: "跳转到不同站点，仅观察当前页；可用最终地址重新分析",
};
export const pageNames: Record<string, string> = {
  visiting: "访问中",
  visited: "已访问",
  queued: "待访问",
  pending: "未访问",
  skipped: "已跳过",
  blocked: "已阻止",
  failed: "访问失败",
};
export const active = (t?: ScanTask | null) =>
  !!t && ["starting", "running", "stopping"].includes(t.status);
export const time = (value?: string) =>
  value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
export const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未更新";
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
