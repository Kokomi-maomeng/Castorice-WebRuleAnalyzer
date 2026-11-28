import ContextHelp from "./ContextHelp";
import { scanTargetLabel } from "../utils/scanAddress";
import { type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArticleRounded,
  CheckCircleRounded,
  CloseRounded,
  ContentCopyRounded,
  DataObjectRounded,
  DeleteOutlineRounded,
  HubRounded,
  PauseRounded,
  RadioButtonCheckedRounded,
  RouteRounded,
  WarningAmberRounded,
  StopCircleRounded,
} from "@mui/icons-material";
import type {
  NetworkRequest,
  RequestFilter,
  ScanOptions,
  ScanTask,
  TaskEvent,
} from "../types";
import {
  active,
  diagnosticDetails,
  modeNames,
  pageNames,
  reasonNames,
  statusNames,
  time,
  tipText,
} from "../utils/format";
import { copy } from "../services/api";
interface Props {
  matchContent?: ReactNode;
  task?: ScanTask;
  options: ScanOptions;
  browserManaged: boolean;
  connection?: string;
  syncingResults?: boolean;
  requests: NetworkRequest[];
  total: number;
  filter: RequestFilter;
  setFilter: (f: RequestFilter) => void;
  logs: TaskEvent[];
  tab: number;
  setTab: (v: number) => void;
  logLevel: string;
  notify: (s: string) => void;
}

type ScanNotice = {
  message: string;
  details: string;
  tone: "info" | "warning" | "error";
};

function scanNotices(t?: ScanTask): ScanNotice[] {
  if (!t) return [];
  const notices: ScanNotice[] = [];
  const reason = t.end_reason ? reasonNames[t.end_reason] || t.end_reason : "";
  const message = tipText(t.diagnostic?.message || t.error || reason);
  if (message) {
    notices.push({
      message,
      details: [
        reason ? `${reason}。本次扫描仅代表实际访问和观察范围` : message,
        reason && message !== reason && message,
        t.diagnostic?.hint && tipText(t.diagnostic.hint),
        t.diagnostic && diagnosticDetails(t.diagnostic),
      ]
        .filter(Boolean)
        .join("\n"),
      tone:
        t.status === "failed" || t.error
          ? "error"
          : t.diagnostic || t.status === "partial" || t.status === "timed_out"
            ? "warning"
            : "info",
    });
  }
  if (
    !active(t) &&
    t.summary &&
    (t.summary.failed_pages ||
      t.summary.blocked_pages ||
      t.summary.pending_pages)
  ) {
    notices.push({
      message: "页面覆盖不完整",
      details: `访问失败 ${t.summary.failed_pages}，受阻 ${t.summary.blocked_pages}，未访问 ${t.summary.pending_pages}。观察域名可用于排障，网站可用性还需结合请求结果判断`,
      tone: "warning",
    });
  }
  if (t.test_mode) {
    notices.push({
      message: "已启用测试白名单",
      details: "当前任务的测试白名单仅用于本地验收站",
      tone: "warning",
    });
  }
  return notices;
}
const levels: Record<string, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const requestFailedLabel = "请求失败";
const depthColumnWidth = 104;

function describeScan(options: ScanOptions, browser: string, managed: boolean) {
  const selected = (options.browser_path || "").split(/[\\/]/).at(-1);
  const name =
    browser || (managed ? "服务端指定浏览器" : selected || "自动检测浏览器");
  const limit =
    options.max_seconds > 0 ? `${options.max_seconds}s 上限` : "时长未记录";
  return `${modeNames[options.mode] || "扫描"} · ${limit} · ${name} · 独立临时 Profile`;
}

export default function AnalysisPanel(p: Props) {
  const [detail, setDetail] = useState<NetworkRequest>();
  const [detailOpen, setDetailOpen] = useState(false);
  function openDetail(request: NetworkRequest) {
    setDetail(request);
    setDetailOpen(true);
  }
  const [logFilter, setLogFilter] = useState("");
  const [cleared, setCleared] = useState(0);
  const [pageLimit, setPageLimit] = useState(20);
  const t = p.task;
  const running = active(t);
  const recordingPaused = t?.status === "running" && t.recording_paused;
  const notices = scanNotices(t);
  if (p.connection) {
    notices.push({
      message: "实时连接暂不可用",
      details: tipText(p.connection),
      tone: "warning",
    });
  } else if (p.syncingResults) {
    notices.push({
      message: "正在补取最终采集结果…",
      details: "补取完成后将显示最终请求和域名",
      tone: "info",
    });
  }
  const recordedInfo = t
    ? `本次 · ${describeScan(t.options, t.browser || "", p.browserManaged)}${t.ip_count > 0 ? ` · 另有 ${t.ip_count} 个 IP 主机` : ""}`
    : "";
  const nextInfo = `下次 · ${describeScan(p.options, "", p.browserManaged)}`;
  const scanInfo = running ? recordedInfo : nextInfo;
  const filteredLogs = p.logs.filter(
    (l) =>
      l.id > cleared &&
      (logFilter
        ? l.level === logFilter
        : levels[l.level] >= levels[p.logLevel]),
  );
  const filter = (key: keyof RequestFilter, value: string) =>
    p.setFilter({ ...p.filter, page: 0, [key]: value });
  const stageEvents = p.logs.filter((l) =>
    [
      "created",
      "browser",
      "navigation",
      "page_loaded",
      "explore",
      "interactive",
      "recording_paused",
      "recording_resumed",
      "extract",
      "ended",
      "stopping",
    ].includes(l.kind),
  );
  const visited =
    t?.pages.filter((page) => page.status === "visited").length || 0;
  return (
    <Paper
      component="section"
      className="analysis-panel motion-surface"
      sx={{
        border: 1,
        borderColor: "divider",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box className="analysis-heading panel-heading">
        <Typography variant="h6">实时抓取与分析</Typography>
        <Chip
          className="analysis-status"
          role="status"
          size="small"
          variant="outlined"
          label={
            recordingPaused
              ? "记录已暂停"
              : t
                ? statusNames[t.status] || t.status
                : "就绪"
          }
          color={
            recordingPaused
              ? "warning"
              : running
                ? "primary"
                : t?.status === "failed"
                  ? "error"
                  : t?.status === "completed"
                    ? "success"
                    : t?.status === "timed_out" || t?.status === "partial"
                      ? "warning"
                      : "default"
          }
          icon={
            recordingPaused ? (
              <PauseRounded />
            ) : running ? (
              <RadioButtonCheckedRounded
                sx={{ animation: "pulse 1.5s infinite" }}
              />
            ) : t?.status === "completed" ? (
              <CheckCircleRounded />
            ) : t?.status === "failed" ||
              t?.status === "timed_out" ||
              t?.status === "partial" ? (
              <WarningAmberRounded />
            ) : (
              <StopCircleRounded />
            )
          }
        />
        {notices.length > 0 && (
          <Box className="analysis-notices" role="status">
            {notices.map(({ message, details, tone }) => (
              <Box className="analysis-notice" key={message}>
                <Typography
                  variant="body2"
                  color={tone === "info" ? "text.secondary" : tone + ".main"}
                >
                  {message}
                </Typography>
                <ContextHelp
                  label={`查看${message}详情`}
                  error={tone === "error"}
                  warning={tone === "warning"}
                  alignEnd
                >
                  {details}
                </ContextHelp>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box className="analysis-tab-row" sx={{ borderColor: "divider" }}>
        <Tabs
          aria-label="采集分析视图"
          value={p.tab}
          onChange={(_, value) => p.setTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            px: 1,
            "& .MuiTab-root": { px: 0.75, minWidth: 0 },
            "& .MuiTab-icon": { mr: 0.5 },
            "& .MuiTabs-scrollButtons": { width: 24 },
          }}
        >
          <Tab
            id="analysis-tab-flow"
            aria-controls="analysis-flow"
            icon={<RouteRounded sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label="抓取流程"
          />
          <Tab
            id="analysis-tab-requests"
            aria-controls="analysis-requests"
            icon={<HubRounded sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label={`网络请求${t ? ` (${t.request_count})` : ""}`}
          />
          <Tab
            id="analysis-tab-logs"
            aria-controls="analysis-logs"
            icon={<ArticleRounded sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label="运行日志"
          />
          <Tab
            id="analysis-tab-matches"
            aria-controls="analysis-matches"
            label={`规则命中${t ? ` (${t.matches.filter((m) => m.relation === "target").length})` : ""}`}
          />
        </Tabs>
        {scanInfo && (
          <Typography
            className="analysis-scan-info"
            variant="caption"
            color="text.secondary"
            title={
              !running && recordedInfo
                ? `${nextInfo}\n${recordedInfo}`
                : scanInfo
            }
          >
            {scanInfo}
          </Typography>
        )}
      </Box>
      {p.tab === 0 && (
        <Box
          className="analysis-body motion-panel"
          sx={{ p: 2 }}
          role="tabpanel"
          id="analysis-flow"
          aria-labelledby="analysis-tab-flow"
        >
          {!t ? (
            <Stack
              sx={{
                height: "100%",
                minHeight: 120,
                color: "text.secondary",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <DataObjectRounded
                sx={{
                  fontSize: 55,
                  color: "primary.main",
                  opacity: 0.5,
                  mb: 2,
                }}
              />
              <Typography variant="h6" color="text.primary">
                输入网址后开始采集
              </Typography>
            </Stack>
          ) : (
            <>
              <Box className="analysis-metrics">
                {[
                  ["观察域名", t.domain_count],
                  ["网络请求", t.request_count],
                  ...(t.summary
                    ? [
                        ["已取得响应", t.summary.responded],
                        [requestFailedLabel, t.summary.connection_failed],
                        ["HTTP 异常", t.summary.http_error],
                        ["未完成", t.summary.unfinished],
                      ]
                    : []),
                  ["已访问页面", visited],
                ].map(([label, value]) => (
                  <Box
                    key={label}
                    className="analysis-metric"
                    sx={{
                      bgcolor: "action.hover",
                    }}
                  >
                    <Typography variant="h5">{value}</Typography>
                    <Box className="analysis-metric-label">
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      {label === requestFailedLabel && (
                        <ContextHelp
                          className="analysis-inline-help"
                          label="查看请求失败统计说明"
                        >
                          「已取得响应」按是否收到 HTTP
                          状态码统计，「请求失败」按请求最终状态统计。收到响应后如果加载失败，同一条请求会同时计入这两项
                        </ContextHelp>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
              {running && <LinearProgress sx={{ borderRadius: 2, mb: 2 }} />}
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                <b>当前页面</b>　
                {t.current_page || scanTargetLabel(t.target_url)}
              </Typography>
              {t.page_title || t.main_status ? (
                <Typography
                  variant="body2"
                  sx={{ mt: 0.5, overflowWrap: "anywhere" }}
                >
                  {t.page_title}
                  {t.main_status ? ` · HTTP ${t.main_status}` : ""}
                </Typography>
              ) : null}
              <Stack
                role="region"
                aria-label="最近采集事件"
                tabIndex={0}
                className="scroll-region"
                sx={{ mt: 1, maxHeight: 180, overflow: "auto", gap: 1.2 }}
              >
                {stageEvents.slice(-15).map((e, index, arr) => (
                  <Stack
                    key={e.id}
                    direction="row"
                    sx={{ gap: 1.2, alignItems: "flex-start" }}
                  >
                    <Box
                      sx={{
                        mt: 0.5,
                        width: 8,
                        height: 8,
                        flexShrink: 0,
                        borderRadius: "50%",
                        bgcolor:
                          index === arr.length - 1 && running
                            ? "primary.main"
                            : "secondary.main",
                      }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {e.message}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {time(e.time)}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
              {t.pages.length > 0 && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Stack
                    direction="row"
                    sx={{
                      mb: 0.5,
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography variant="subtitle2">
                      页面覆盖记录 · {t.pages.length} 条
                    </Typography>
                    <Stack
                      direction="row"
                      sx={{
                        width: depthColumnWidth,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 0.25,
                      }}
                    >
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        探索深度
                      </Typography>
                      <ContextHelp
                        className="analysis-inline-help"
                        label="查看探索深度说明"
                        alignEnd
                      >
                        深度模式从起始页深度 0 开始，每跟随一层链接加
                        1。快速模式的起始页和自行交互的手动访问均记为 0
                      </ContextHelp>
                    </Stack>
                  </Stack>
                  <TableContainer sx={{ maxHeight: 220 }}>
                    <Table size="small" aria-label="页面覆盖记录">
                      <TableBody>
                        {t.pages.slice(0, pageLimit).map((page, i) => (
                          <TableRow key={i}>
                            <TableCell
                              sx={{ maxWidth: 360, overflowWrap: "anywhere" }}
                            >
                              <Typography variant="caption">
                                {page.url}
                              </Typography>
                              {page.reason && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: "block" }}
                                >
                                  {page.reason}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              <Chip
                                variant="outlined"
                                label={pageNames[page.status] || page.status}
                                color={
                                  page.status === "visited"
                                    ? "success"
                                    : "default"
                                }
                              />
                            </TableCell>
                            <TableCell
                              align="center"
                              sx={{ width: depthColumnWidth, px: 0 }}
                              aria-label={`探索深度 ${page.depth}`}
                            >
                              {page.depth}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  {t.pages.length > pageLimit && (
                    <Button
                      size="small"
                      onClick={() => setPageLimit((v) => v + 50)}
                    >
                      显示更多页面
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      )}
      {p.tab === 1 && (
        <Box
          className="analysis-body requests-body motion-panel"
          role="tabpanel"
          id="analysis-requests"
          aria-labelledby="analysis-tab-requests"
        >
          <Stack direction="row" sx={{ p: 1.5, gap: 1, flexWrap: "wrap" }}>
            <TextField
              label={p.filter.exactHost ? "精确主机" : "域名过滤"}
              value={p.filter.host}
              onChange={(e) =>
                p.setFilter({
                  ...p.filter,
                  host: e.target.value,
                  exactHost: false,
                  page: 0,
                })
              }
              sx={{ flex: "2 1 140px", minWidth: 0 }}
            />
            <TextField
              select
              label="方法"
              value={p.filter.method}
              onChange={(e) => filter("method", e.target.value)}
              sx={{ flex: "1 1 95px", minWidth: 0 }}
            >
              {[
                "",
                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
                "OPTIONS",
                "HEAD",
              ].map((v) => (
                <MenuItem value={v} key={v}>
                  {v || "全部"}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="类型"
              value={p.filter.type}
              onChange={(e) => filter("type", e.target.value)}
              sx={{ flex: "1 1 115px", minWidth: 0 }}
            >
              {[
                "",
                "Document",
                "Fetch",
                "XHR",
                "Script",
                "Stylesheet",
                "Image",
                "Font",
                "WebSocket",
                "Media",
                "Other",
              ].map((v) => (
                <MenuItem value={v} key={v}>
                  {v || "全部"}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="状态"
              value={p.filter.status}
              onChange={(e) => filter("status", e.target.value)}
              sx={{ flex: "1 1 100px", minWidth: 0 }}
            >
              {[
                ["", "全部"],
                ["2", "2xx"],
                ["3", "3xx"],
                ["4", "4xx"],
                ["5", "5xx"],
                ["failed", requestFailedLabel],
              ].map(([v, label]) => (
                <MenuItem value={v} key={v}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TableContainer
            className="scroll-region"
            role="region"
            aria-label="网络请求列表"
            tabIndex={0}
            sx={{ flex: 1, minHeight: 120 }}
          >
            <Table
              stickyHeader
              size="small"
              sx={{ "& td": { py: 1.3, cursor: "pointer" } }}
            >
              <TableHead>
                <TableRow>
                  {["时间", "Method", "Host", "Type", "Status", "耗时"].map(
                    (label) => (
                      <TableCell key={label}>{label}</TableCell>
                    ),
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {p.requests.map((req) => (
                  <TableRow
                    className="motion-row"
                    hover
                    key={req.id}
                    onClick={() => openDetail(req)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail(req);
                      }
                    }}
                  >
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {time(req.time)}
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        color={
                          req.method === "GET"
                            ? "secondary.main"
                            : "primary.main"
                        }
                        sx={{ fontWeight: 700 }}
                      >
                        {req.method}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 240, overflowWrap: "anywhere" }}>
                      <span className="domain-name">{req.hostname}</span>
                    </TableCell>
                    <TableCell>{req.resource_type}</TableCell>
                    <TableCell
                      sx={{
                        color:
                          req.state === "failed" ||
                          (req.status_code || 0) >= 400
                            ? "error.main"
                            : "text.primary",
                      }}
                    >
                      {req.status_code ||
                        (req.state === "failed"
                          ? "失败"
                          : req.state === "interrupted"
                            ? "已中断"
                            : "等待")}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {req.duration_ms === undefined
                        ? "—"
                        : `${req.duration_ms.toFixed(0)} ms`}
                    </TableCell>
                  </TableRow>
                ))}
                {!p.requests.length && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      align="center"
                      sx={{ height: 250, color: "text.secondary" }}
                    >
                      暂无符合条件的请求
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            className="requests-pager"
            component="div"
            count={p.total}
            page={Math.min(
              p.filter.page,
              Math.max(0, Math.ceil(p.total / 50) - 1),
            )}
            onPageChange={(_, page) => p.setFilter({ ...p.filter, page })}
            rowsPerPage={50}
            rowsPerPageOptions={[50]}
            getItemAriaLabel={(direction) =>
              direction === "next" ? "下一页请求" : "上一页请求"
            }
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} / ${count} 条`
            }
          />
        </Box>
      )}
      {p.tab === 2 && (
        <Box
          className="analysis-body logs-body motion-panel"
          sx={{ p: 2 }}
          role="tabpanel"
          id="analysis-logs"
          aria-labelledby="analysis-tab-logs"
        >
          <Stack
            direction="row"
            sx={{ mb: 2, gap: 1, alignItems: "center", flexWrap: "wrap" }}
          >
            <TextField
              select
              label="日志级别"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              sx={{ width: 140, maxWidth: "100%" }}
            >
              <MenuItem value="">默认（{p.logLevel}+）</MenuItem>
              {["DEBUG", "INFO", "WARN", "ERROR"].map((l) => (
                <MenuItem value={l} key={l}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flex: 1 }}
            >
              当前 {filteredLogs.length.toLocaleString("zh-CN")} 条
            </Typography>
            <Tooltip title="清空当前显示">
              <IconButton
                aria-label="清空日志显示"
                onClick={() => setCleared(p.logs.at(-1)?.id || 0)}
              >
                <DeleteOutlineRounded />
              </IconButton>
            </Tooltip>
            <Tooltip title="复制当前日志">
              <IconButton
                aria-label="复制日志"
                onClick={() =>
                  void copy(
                    filteredLogs
                      .map((l) => `${l.time} [${l.level}] ${l.message}`)
                      .join("\n"),
                  )
                    .then(() => p.notify("日志已复制"))
                    .catch((e) => p.notify(String(e)))
                }
              >
                <ContentCopyRounded />
              </IconButton>
            </Tooltip>
          </Stack>
          <Box
            className="scroll-region analysis-log-list"
            tabIndex={0}
            role="region"
            aria-label="扫描日志列表"
            sx={{
              bgcolor: "action.hover",
              borderRadius: 2,
              p: 1.5,
              flex: 1,
              minHeight: 100,
              overflow: "auto",
            }}
          >
            {filteredLogs.length ? (
              filteredLogs.map((l) => (
                <Box key={l.id} className="analysis-log-entry">
                  <Box
                    component="span"
                    sx={{ flexShrink: 0, color: "text.secondary" }}
                  >
                    {time(l.time)}
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      flexShrink: 0,
                      width: 40,
                      color:
                        l.level === "ERROR"
                          ? "error.main"
                          : l.level === "WARN"
                            ? "warning.main"
                            : "secondary.main",
                    }}
                  >
                    {l.level}
                  </Box>
                  <Box component="span" className="analysis-log-message">
                    {l.message}
                  </Box>
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无日志
              </Typography>
            )}
          </Box>
        </Box>
      )}
      {p.tab === 3 && (
        <Box
          className="analysis-body motion-panel"
          role="tabpanel"
          id="analysis-matches"
          aria-labelledby="analysis-tab-matches"
        >
          {p.matchContent}
        </Box>
      )}
      <Dialog
        aria-labelledby="request-detail-title"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        slotProps={{
          transition: { onExited: () => !detailOpen && setDetail(undefined) },
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle id="request-detail-heading" className="dialog-heading">
          <span id="request-detail-title">请求详情</span>
          <IconButton
            aria-label="关闭请求详情"
            onClick={() => setDetailOpen(false)}
            sx={{ ml: "auto", flexShrink: 0 }}
          >
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            查询参数值已脱敏。不记录请求头、Cookie、认证信息或正文
          </Alert>
          {detail && (
            <Table size="small">
              <TableBody>
                {Object.entries({
                  "请求 ID": detail.id,
                  时间: detail.time,
                  "URL（脱敏）": detail.url,
                  方法: detail.method,
                  "域名 / 主机": detail.hostname,
                  协议: detail.protocol || detail.scheme,
                  类型: detail.resource_type,
                  状态码: detail.status_code || "未获取",
                  请求状态: detail.state,
                  耗时:
                    detail.duration_ms === undefined
                      ? "未完成或未提供"
                      : `${detail.duration_ms.toFixed(2)} ms`,
                  来源页面: detail.source_page || "未提供",
                  Initiator: detail.initiator || "未提供",
                  失败原因: detail.failure || "—",
                  "任务 ID": detail.task_id,
                }).map(([label, value]) => (
                  <TableRow key={label}>
                    <TableCell sx={{ width: "28%", maxWidth: 160 }}>
                      {label}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      <code>{value}</code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </Paper>
  );
}
