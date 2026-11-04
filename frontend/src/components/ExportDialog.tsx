import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  ClickAwayListener,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Pagination,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  CloseRounded,
  ContentCopyRounded,
  DownloadRounded,
  ExpandMoreRounded,
  InfoOutlined,
  RefreshRounded,
  TuneRounded,
} from "@mui/icons-material";
import type {
  DomainRecord,
  ExportFormat,
  ExportJob,
  ExportResult,
  RuleCategory,
  RuleSource,
  ScanTask,
  Settings,
} from "../types";
import { api, copy, download } from "../services/api";
import { errorMessage } from "../utils/format";

interface Props {
  open?: boolean;
  onExited?: () => void;
  task: ScanTask;
  domains: DomainRecord[];
  mode: "observed" | "merged";
  settings: Settings;
  onClose: () => void;
  notify: (s: string) => void;
  onRematch: () => void;
}
const suffixWarning =
  "已主动选择 DOMAIN-SUFFIX：这会包含观察 Hostname 的全部子域名，扩大匹配范围。";
const suffixHelp =
  "后缀匹配会包含观察域名的全部子域名；默认精确 DOMAIN 更保守。";

function Hint(p: { label: string; text: string; warning?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Tooltip
        title={p.text}
        arrow
        placement="bottom"
        open={open}
        slotProps={{
          tooltip: { sx: { whiteSpace: "pre-line", maxWidth: 360 } },
        }}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
      >
        <IconButton
          size="small"
          className="export-hint"
          color={p.warning ? "warning" : "default"}
          aria-label={p.label}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              e.stopPropagation();
            }
          }}
        >
          <InfoOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </ClickAwayListener>
  );
}
function Pager(p: {
  count: number;
  page: number;
  size: number;
  unit: string;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  return (
    <Stack
      direction="row"
      className="preview-pager"
      sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", py: 0.75 }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mr: "auto" }}>
        {p.count ? p.page * p.size + 1 : 0}–
        {Math.min((p.page + 1) * p.size, p.count)} / {p.count} {p.unit}
      </Typography>
      <TextField
        select
        label={`每页${p.unit === "行" ? "行数" : "条目"}`}
        value={p.size}
        onChange={(e) => p.onSize(Number(e.target.value))}
        sx={{ width: 100 }}
      >
        {(p.unit === "行" ? [100, 200, 500] : [30, 60, 100]).map((n) => (
          <MenuItem key={n} value={n}>
            {n}
          </MenuItem>
        ))}
      </TextField>
      <Pagination
        count={Math.max(1, Math.ceil(p.count / p.size))}
        page={p.page + 1}
        onChange={(_, value) => p.onPage(value - 1)}
        size="small"
        siblingCount={0}
        boundaryCount={1}
        getItemAriaLabel={(type, page) =>
          type === "page"
            ? `第 ${page} 页`
            : type === "next"
              ? "下一页"
              : type === "previous"
                ? "上一页"
                : type === "first"
                  ? "第一页"
                  : "最后一页"
        }
      />
    </Stack>
  );
}
export default function ExportDialog(p: Props) {
  const compact = useMediaQuery("(max-width:700px), (max-height:600px)");
  const [settingsOpen, setSettingsOpen] = useState(!compact);
  useEffect(() => {
    setSettingsOpen(!compact);
  }, [compact]);
  const [mode, setMode] = useState(p.mode);
  const [format, setFormat] = useState<ExportFormat>(p.settings.export_format);
  const [policy, setPolicy] = useState(p.settings.policy);
  const [filename, setFilename] = useState("castorice-rules");
  const [suffix, setSuffix] = useState(false);
  const [listOnly, setListOnly] = useState(false);
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [sources, setSources] = useState<RuleSource[]>([]);
  const [categoryIDs, setCategoryIDs] = useState<string[]>(
    p.task.matches.some(
      (m) =>
        m.category_id === p.task.recommended_category &&
        m.relation === "target" &&
        m.suitable,
    )
      ? [p.task.recommended_category!]
      : [],
  );
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{
    result: ExportResult;
    scope: string;
    key: string;
  }>();
  const [error, setError] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [contentPage, setContentPage] = useState(0);
  const [lineSize, setLineSize] = useState(200);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryRequest = useRef(0);
  const categoryLoading = useRef(false);
  const committedCategories = useRef(categoryIDs);
  const mounted = useRef(false);
  const entryScroll = useRef<HTMLDivElement>(null);
  const contentScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Poll while open: another window or automatic updating may populate an empty cache.
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const [c, s] = await Promise.all([
          api<RuleCategory[]>("/rules/categories"),
          api<RuleSource[]>("/rules/sources"),
        ]);
        if (!disposed) {
          // Preserve object identity when a poll has no actual cache changes.
          setCategories((old) =>
            JSON.stringify(old) === JSON.stringify(c) ? old : c,
          );
          setSources(s);
          setLibraryError("");
          setCategoryIDs((old) => {
            if (categoryLoading.current) return old;
            const next = old.every((id) => c.some((item) => item.id === id))
              ? old
              : old.filter((id) => c.some((item) => item.id === id));
            committedCategories.current = next;
            return next;
          });
        }
      } catch (e) {
        if (!disposed) setLibraryError(errorMessage(e));
      } finally {
        if (!disposed) setLoadingLibrary(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [reload]);

  const selectedCategories = useMemo(
    () => categories.filter((c) => categoryIDs.includes(c.id)),
    [categories, categoryIDs],
  );
  const needsCategory = mode === "merged" && !categoryIDs.length;
  const domainSnapshot = JSON.stringify(p.domains.map((d) => d.hostname));
  const categorySnapshot = JSON.stringify(
    Object.fromEntries(
      mode === "merged"
        ? categoryIDs.map((id) => {
            const c = categories.find((c) => c.id === id);
            return [
              id,
              c ? c.version + ":" + (c.content_hash || "") : "missing",
            ];
          })
        : [],
    ),
  );
  const job = useMemo<ExportJob>(
    () => ({
      task_id: p.task.id,
      mode: mode === "merged" && !categoryIDs.length ? "observed" : mode,
      category_ids: mode === "merged" ? categoryIDs : [],
      category_versions: JSON.parse(categorySnapshot) as Record<string, string>,
      format,
      policy,
      filename,
      list_only: listOnly,
      use_suffix: suffix,
      domains: JSON.parse(domainSnapshot) as string[],
      excluded: [...excluded],
    }),
    [
      p.task.id,
      domainSnapshot,
      mode,
      categoryIDs,
      categorySnapshot,
      format,
      policy,
      filename,
      listOnly,
      suffix,
      excluded,
    ],
  );
  const key = useMemo(() => JSON.stringify(job), [job]);
  const scope = useMemo(
    () =>
      JSON.stringify([
        job.task_id,
        job.mode,
        job.category_ids,
        job.use_suffix,
        job.domains,
      ]),
    [job],
  );
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    if (loadingCategory) return;
    const timer = setTimeout(() => {
      void api<ExportResult>("/export", "POST", job)
        .then((result) => {
          if (!disposed) setPreview({ result, scope, key });
        })
        .catch((e) => {
          if (!disposed) {
            setError(errorMessage(e));
            if (e instanceof Error && "status" in e && e.status === 409)
              setReload((v) => v + 1);
          }
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    }, 180);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [job, scope, key, loadingCategory]);

  async function syncLibrary() {
    setSyncing(true);
    setLibraryError("");
    const pending = sources.filter(
      (s) => !s.category_count && s.status !== "syncing",
    );
    const failures: string[] = [];
    // Source updates share one atomic cache writer; queue them instead of racing.
    for (const source of pending) {
      try {
        await api("/rules/sync", "POST", { source: source.id });
      } catch (e) {
        failures.push(`${source.id}：${errorMessage(e)}`);
      }
    }
    if (!mounted.current) return;
    setSyncing(false);
    setReload((v) => v + 1);
    if (failures.length) p.notify(failures.join("；"));
    else p.onRematch();
  }
  async function choose(values: RuleCategory[]) {
    const request = ++categoryRequest.current;
    categoryLoading.current = true;
    setCategoryIDs(values.map((c) => c.id));
    setCategoryQuery("");
    setCategoryOpen(false);
    setLoadingCategory(true);
    setLibraryError("");
    try {
      const resolved: RuleCategory[] = [];
      for (const c of values)
        resolved.push(
          c.loaded
            ? c
            : await api<RuleCategory>("/rules/load", "POST", { id: c.id }),
        );
      if (!mounted.current || categoryRequest.current !== request) return;
      committedCategories.current = resolved.map((c) => c.id);
      setExcluded(new Set());
      setPage(0);
      setCategories((old) =>
        old.map((c) => resolved.find((r) => r.id === c.id) || c),
      );
      p.onRematch();
    } catch (e) {
      if (mounted.current && categoryRequest.current === request) {
        setCategoryIDs(committedCategories.current);
        setLibraryError(errorMessage(e));
      }
    } finally {
      if (mounted.current && categoryRequest.current === request) {
        categoryLoading.current = false;
        setLoadingCategory(false);
      }
    }
  }

  // Keep the last list in place during recomputation; stale output cannot be saved.
  const result = preview?.result;
  const currentScope = preview?.scope === scope && !loadingCategory;
  const fresh =
    !loading &&
    !loadingCategory &&
    !needsCategory &&
    !error &&
    !(mode === "merged" && libraryError) &&
    preview?.key === key &&
    !!result;
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (
      result?.entries.filter((e) => {
        const observed =
          e.label === "本次抓取" ||
          e.label === "双方匹配" ||
          e.origins.some((o) => o.source === "observed");
        return (
          (stateFilter === "all" ||
            (stateFilter === "observed" && observed) ||
            (stateFilter === "library" && !observed) ||
            (stateFilter === "covered" && !!e.covered_by)) &&
          (!q ||
            `${e.rule_type},${e.rule_value} ${e.label} ${e.origins.map((o) => `${o.source}/${o.source_category}`).join(" ")}`
              .toLowerCase()
              .includes(q))
        );
      }) || []
    );
  }, [result, query, stateFilter]);
  const actualPage = Math.min(
    page,
    Math.max(0, Math.ceil(entries.length / pageSize) - 1),
  );
  const pageEntries = entries.slice(
    actualPage * pageSize,
    (actualPage + 1) * pageSize,
  );
  const pageSelected = pageEntries.filter(
    (e) => !excluded.has(`${e.rule_type},${e.rule_value}`),
  ).length;
  const lines = useMemo(
    () => result?.content.replace(/\n$/, "").split("\n") || [],
    [result?.content],
  );
  const actualContentPage = Math.min(
    contentPage,
    Math.max(0, Math.ceil(lines.length / lineSize) - 1),
  );
  useEffect(() => {
    if (page !== actualPage) setPage(actualPage);
  }, [page, actualPage]);
  useEffect(() => {
    entryScroll.current?.scrollTo?.(0, 0);
  }, [actualPage, pageSize, query, stateFilter]);
  useEffect(() => {
    setContentPage(0);
  }, [result?.content]);
  useEffect(() => {
    contentScroll.current?.scrollTo?.(0, 0);
  }, [actualContentPage, lineSize]);
  const updating = syncing || sources.some((s) => s.status === "syncing");
  const missingSources = sources.filter((s) => !s.category_count);
  const scopeWarnings = [
    ...(p.task.status !== "completed" ||
    (p.task.summary &&
      (p.task.summary.connection_failed > 0 ||
        p.task.summary.http_error > 0 ||
        p.task.summary.unfinished > 0))
      ? [
          "本次包含失败或未完成的请求。导出的是观察域名，可用于分流排障，不代表网站已成功访问或规则覆盖完整。",
        ]
      : []),
    ...(result?.warnings.filter((w) => w !== suffixWarning) || []),
  ];

  function useFreshResult(action: (result: ExportResult) => Promise<unknown>) {
    if (!fresh || !result) return;
    // Revalidate selected versions at the final action, including changes between polls.
    if (mode === "observed") {
      void action(result).catch((e) => p.notify(errorMessage(e)));
      return;
    }
    setLoading(true);
    void api<ExportResult>("/export", "POST", job)
      .then((current) => action(current))
      .catch((e) => {
        setError(errorMessage(e));
        setReload((v) => v + 1);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }

  return (
    <Dialog
      slotProps={{ transition: { onExited: p.onExited } }}
      open={p.open ?? true}
      onClose={p.onClose}
      maxWidth="lg"
      fullWidth
      className="export-dialog"
    >
      <DialogTitle className="export-title">
        <Box component="span">预览与导出规则</Box>
        {scopeWarnings.length > 0 && (
          <Hint
            label="查看抓取与范围提示"
            text={scopeWarnings.join("\n\n")}
            warning
          />
        )}
        <Button
          size="small"
          startIcon={<TuneRounded />}
          endIcon={
            <ExpandMoreRounded
              sx={{
                transform: settingsOpen ? "rotate(180deg)" : "none",
                transition: "transform 180ms",
              }}
            />
          }
          aria-expanded={settingsOpen}
          aria-controls="export-settings"
          sx={{ ml: "auto", flexShrink: 0 }}
          onClick={() => setSettingsOpen((v) => !v)}
        >
          导出设置
        </Button>
        <IconButton aria-label="关闭导出" onClick={p.onClose} size="small">
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        <Collapse in={settingsOpen} sx={{ flexShrink: 0 }}>
          <Box id="export-settings" className="export-settings">
            <Box className="export-options">
              <TextField
                select
                label="导出范围"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setStateFilter("all");
                  setExcluded(new Set());
                  setPage(0);
                }}
              >
                <MenuItem value="observed">仅抓取结果</MenuItem>
                <MenuItem value="merged">抓取 + 开源规则库</MenuItem>
              </TextField>
              <TextField
                select
                label="输出格式"
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
              >
                <MenuItem value="clash">Clash / Mihomo YAML</MenuItem>
                <MenuItem value="provider">Mihomo Rule Provider</MenuItem>
                <MenuItem value="singbox">sing-box Source Rule Set v3</MenuItem>
              </TextField>
              <TextField
                label="策略组名称"
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
                disabled={format !== "clash"}
              />
              <TextField
                label="文件名称（自动扩展名）"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
            </Box>
            {mode === "merged" && (
              <Box sx={{ mt: 1.25 }}>
                <Autocomplete
                  multiple
                  options={categories}
                  value={selectedCategories}
                  inputValue={categoryQuery}
                  onInputChange={(_, value, reason) => {
                    // MUI's reset on new option/value objects must not erase typing.
                    if (reason === "input" || reason === "clear")
                      setCategoryQuery(value);
                  }}
                  open={categoryOpen && !!categoryQuery.trim()}
                  onOpen={() => setCategoryOpen(true)}
                  onClose={() => setCategoryOpen(false)}
                  loading={loadingLibrary || loadingCategory}
                  loadingText={
                    loadingCategory
                      ? "正在下载并验证分类…"
                      : "正在读取规则分类…"
                  }
                  noOptionsText={
                    categories.length
                      ? "没有匹配的分类，请换个名称搜索"
                      : "尚未下载规则库，请点击下方下载按钮"
                  }
                  getOptionLabel={(c) => `${c.name} · ${c.source}`}
                  getOptionKey={(c) => c.id}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  filterOptions={(options, state) => {
                    const q = state.inputValue.trim().toLowerCase();
                    if (!q) return [];
                    return options
                      .filter((c) =>
                        `${c.name} ${c.source}`.toLowerCase().includes(q),
                      )
                      .sort(
                        (a, b) =>
                          Number(b.name.toLowerCase() === q) -
                            Number(a.name.toLowerCase() === q) ||
                          Number(b.name.toLowerCase().startsWith(q)) -
                            Number(a.name.toLowerCase().startsWith(q)),
                      )
                      .slice(0, 80);
                  }}
                  onChange={(_, values) => void choose(values)}
                  renderValue={(values, getItemProps) => (
                    <Box className="export-category-tags">
                      {values.map((c, index) => {
                        const { key, ...props } = getItemProps({ index });
                        return (
                          <Chip
                            key={key}
                            {...props}
                            label={`${c.name} · ${c.source}`}
                            title={`${c.name} · ${c.source}`}
                            size="small"
                          />
                        );
                      })}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="规则分类"
                      required
                      slotProps={{
                        ...params.slotProps,
                        htmlInput: {
                          ...params.slotProps.htmlInput,
                          "aria-label": "规则分类",
                        },
                      }}
                      placeholder="搜索分类名称，如 Facebook"
                    />
                  )}
                  renderOption={(props, option, state) => {
                    const { key, ...rest } = props;
                    return (
                      <li key={key} {...rest}>
                        <Checkbox
                          checked={state.selected}
                          size="small"
                          tabIndex={-1}
                          disableRipple
                          sx={{ pointerEvents: "none" }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {option.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {option.source} ·{" "}
                            {option.loaded
                              ? `${option.rule_count} 条`
                              : "按需下载"}
                            {option.broad ? " · 通用集合" : ""}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }}
                />
                {libraryError && (
                  <Alert
                    severity="error"
                    sx={{ mt: 1 }}
                    action={
                      <Button
                        onClick={() => {
                          setLoadingLibrary(true);
                          setReload((v) => v + 1);
                        }}
                      >
                        重试
                      </Button>
                    }
                  >
                    {libraryError}
                  </Alert>
                )}
                {(!categories.length ||
                  missingSources.length > 0 ||
                  updating) &&
                  !loadingLibrary && (
                    <Alert
                      severity="info"
                      sx={{ mt: 1 }}
                      action={
                        !updating && missingSources.length > 0 ? (
                          <Button onClick={() => void syncLibrary()}>
                            下载{categories.length ? "缺少的规则源" : "规则库"}
                          </Button>
                        ) : undefined
                      }
                    >
                      {updating
                        ? "正在下载规则库，完成后分类会自动显示。"
                        : categories.length
                          ? `${missingSources.map((s) => s.id).join("、")} 尚未下载，可补充此来源。`
                          : "两套开源规则库尚未下载。下载后可搜索分类并合并。"}
                      {updating && <LinearProgress sx={{ mt: 1 }} />}
                      {sources
                        .filter((s) => s.error)
                        .map((s) => (
                          <Typography
                            key={s.id}
                            variant="caption"
                            sx={{ display: "block" }}
                          >
                            {s.id}：{s.error}
                          </Typography>
                        ))}
                    </Alert>
                  )}
              </Box>
            )}
            <Stack direction="row" className="export-toggles">
              <Stack direction="row" sx={{ alignItems: "center" }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={suffix}
                      onChange={(_, checked) => {
                        setSuffix(checked);
                        setExcluded(new Set());
                        setPage(0);
                      }}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      观察域名使用 DOMAIN-SUFFIX
                    </Typography>
                  }
                />
                <Hint
                  label="查看 DOMAIN-SUFFIX 提示"
                  text={suffix ? `${suffixWarning} ${suffixHelp}` : suffixHelp}
                  warning={suffix}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={listOnly}
                    disabled={format !== "clash"}
                    onChange={(_, checked) => setListOnly(checked)}
                  />
                }
                label={
                  <Typography variant="body2">
                    只输出规则列表（不含 rules:）
                  </Typography>
                }
              />
            </Stack>
          </Box>
        </Collapse>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 1 }}
            action={
              <Button onClick={() => setExcluded(new Set())}>恢复选择</Button>
            }
          >
            {error}
          </Alert>
        )}
        {result && !error && (
          <Stack direction="row" className="export-summary">
            <Chip label={`抓取 ${result.observed_domains} 个域名`} />
            {mode === "merged" && (
              <Chip label={`规则库补充 ${result.added_rules} 条`} />
            )}
            <Chip label={`重复或覆盖 ${result.duplicate_or_covered} 条`} />
            <Chip label={`最终导出 ${result.final_rules} 条`} color="primary" />
          </Stack>
        )}
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          sx={{ borderBottom: 1, borderColor: "divider", flexShrink: 0 }}
        >
          <Tab
            label="条目与来源"
            id="export-entries-tab"
            aria-controls="export-entries"
          />
          <Tab
            label="文件内容"
            id="export-content-tab"
            aria-controls="export-content"
          />
        </Tabs>
        <Box sx={{ height: 3, flexShrink: 0 }}>
          {loading && <LinearProgress aria-label="正在计算预览" />}
        </Box>
        {!result && (
          <Stack
            sx={{
              minHeight: 130,
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            <Typography color="text.secondary">
              {loading ? "正在计算合并与覆盖关系…" : "调整选择后查看预览"}
            </Typography>
            {loading && <CircularProgress size={20} />}
          </Stack>
        )}
        {result && tab === 0 && (
          <Box
            role="tabpanel"
            id="export-entries"
            aria-labelledby="export-entries-tab"
            className="preview-panel"
            aria-busy={loading}
          >
            <Stack direction="row" className="preview-toolbar">
              <TextField
                placeholder="搜索规则、域名或来源分类"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                slotProps={{ htmlInput: { "aria-label": "搜索预览条目" } }}
                sx={{ flex: 1, minWidth: 160 }}
              />
              <TextField
                select
                label="显示条目"
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 130 }}
              >
                <MenuItem value="all">全部条目</MenuItem>
                <MenuItem value="observed">本次抓取</MenuItem>
                <MenuItem value="covered">被覆盖</MenuItem>
                {mode === "merged" && (
                  <MenuItem value="library">规则库补充</MenuItem>
                )}
              </TextField>
              <Button
                size="small"
                startIcon={<RefreshRounded />}
                disabled={!excluded.size}
                onClick={() => setExcluded(new Set())}
              >
                恢复全选
              </Button>
            </Stack>
            <TableContainer ref={entryScroll} className="preview-scroll">
              <Table size="small" stickyHeader sx={{ tableLayout: "fixed" }}>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={
                          pageEntries.length > 0 &&
                          pageSelected === pageEntries.length
                        }
                        indeterminate={
                          pageSelected > 0 && pageSelected < pageEntries.length
                        }
                        disabled={!currentScope || !pageEntries.length}
                        size="small"
                        slotProps={{ input: { "aria-label": "选择本页" } }}
                        onChange={(_, checked) =>
                          setExcluded((old) => {
                            const next = new Set(old);
                            for (const e of pageEntries) {
                              const key = `${e.rule_type},${e.rule_value}`;
                              if (checked) next.delete(key);
                              else next.add(key);
                            }
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell sx={{ width: "46%" }}>类型 / 域名</TableCell>
                    <TableCell>来源与覆盖关系</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody
                  key={`${actualPage}:${pageSize}`}
                  className="motion-panel"
                >
                  {pageEntries.map((entry) => {
                    const key = `${entry.rule_type},${entry.rule_value}`;
                    return (
                      <TableRow
                        key={key}
                        hover
                        className="preview-row"
                        data-selected={!excluded.has(key)}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            disabled={!currentScope}
                            checked={!excluded.has(key)}
                            slotProps={{
                              input: { "aria-label": `导出 ${key}` },
                            }}
                            onChange={(_, checked) =>
                              setExcluded((old) => {
                                const next = new Set(old);
                                if (checked) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell sx={{ overflowWrap: "anywhere" }}>
                          <code>{key}</code>
                          {entry.risk && (
                            <Typography
                              color="warning.main"
                              variant="caption"
                              sx={{ display: "block" }}
                            >
                              {entry.risk}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ overflowWrap: "anywhere" }}>
                          <Chip
                            label={entry.label}
                            color={
                              entry.label === "本次抓取"
                                ? "default"
                                : "secondary"
                            }
                            variant="outlined"
                          />
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 0.75 }}
                          >
                            {entry.origins
                              .filter((o) => o.source !== "observed")
                              .map(
                                (o) =>
                                  `${o.source}/${o.source_category} @ ${o.source_version.slice(0, 8)}`,
                              )
                              .join("；")}
                          </Typography>
                          {entry.covered_by && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              由 {entry.covered_by}{" "}
                              覆盖，不重复输出。取消上层规则后会恢复。
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!pageEntries.length && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ textAlign: "center", p: 3 }}>
                        没有符合筛选条件的条目
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <Pager
              count={entries.length}
              page={actualPage}
              size={pageSize}
              unit="条"
              onPage={setPage}
              onSize={(size) => {
                setPageSize(size);
                setPage(0);
              }}
            />
          </Box>
        )}
        {result && tab === 1 && (
          <Box
            role="tabpanel"
            id="export-content"
            aria-labelledby="export-content-tab"
            className="preview-panel"
          >
            <Typography variant="caption" color="text.secondary" sx={{ py: 1 }}>
              按行分页预览；复制与下载始终包含完整文件。
            </Typography>
            <Box
              ref={contentScroll}
              className="preview-scroll content-preview"
              sx={{ bgcolor: "action.hover", borderRadius: 1 }}
            >
              <Box
                component="pre"
                className="motion-panel"
                key={`${actualContentPage}:${lineSize}`}
                sx={{ p: 1.5, fontSize: 12 }}
              >
                {lines
                  .slice(
                    actualContentPage * lineSize,
                    (actualContentPage + 1) * lineSize,
                  )
                  .map((line, i) => (
                    <Box component="span" className="preview-line" key={i}>
                      <Box
                        component="span"
                        className="line-number"
                        aria-hidden="true"
                      >
                        {actualContentPage * lineSize + i + 1}
                      </Box>
                      <span>{line || "\u00a0"}</span>
                      {"\n"}
                    </Box>
                  ))}
              </Box>
            </Box>
            <Pager
              count={lines.length}
              page={actualContentPage}
              size={lineSize}
              unit="行"
              onPage={setContentPage}
              onSize={(size) => {
                setLineSize(size);
                setContentPage(0);
              }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions
        className="export-actions"
        sx={{ px: 2, py: 1.25, flexWrap: "wrap", gap: 0.5 }}
      >
        <Button onClick={p.onClose}>关闭</Button>
        {result?.attribution && (
          <Button
            disabled={!fresh}
            onClick={() =>
              useFreshResult((current) =>
                download(
                  current.attribution,
                  current.filename + ".sources.txt",
                  "text/plain",
                ).then((path) =>
                  p.notify(path ? "已保存至 " + path : "已生成来源说明"),
                ),
              )
            }
          >
            下载来源说明
          </Button>
        )}
        <Button
          startIcon={<ContentCopyRounded />}
          disabled={!fresh}
          onClick={() =>
            useFreshResult((current) =>
              copy(current.content).then(() => p.notify("完整规则已复制")),
            )
          }
        >
          复制内容
        </Button>
        <Button
          variant="contained"
          startIcon={<DownloadRounded />}
          disabled={!fresh}
          onClick={() =>
            useFreshResult((current) =>
              download(current.content, current.filename, current.mime).then(
                (path) =>
                  p.notify(
                    path ? `已保存至 ${path}` : `已生成 ${current.filename}`,
                  ),
              ),
            )
          }
        >
          {window.castoriceDesktop ? "保存到软件目录" : "下载文件"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
