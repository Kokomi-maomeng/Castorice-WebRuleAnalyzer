import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
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
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  ContentCopyRounded,
  DownloadRounded,
  EditRounded,
  ExpandMoreRounded,
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
import useRangeSelection from "../hooks/useRangeSelection";
import { selectAllInList } from "../utils/selection";
import { errorMessage, ruleCatalogKey, tipText } from "../utils/format";
import ContextHelp from "./ContextHelp";
import SegmentedControl from "./SegmentedControl";
import NumberedTextEditor, { lineNumberText } from "./NumberedTextEditor";
import "../styles/export-v2.css";

interface Props {
  open?: boolean;
  onExited?: () => void;
  task: ScanTask;
  domains: DomainRecord[];
  settings: Settings;
  onClose: () => void;
  notify: (s: string) => void;
  onRematch: () => void;
}
const suffixWarning =
  "已主动选择 DOMAIN-SUFFIX：这会包含观察 Hostname 的全部子域名，扩大匹配范围。";
const suffixHelp =
  "后缀匹配会包含观察域名的全部子域名；默认精确 DOMAIN 更保守。";
const defaultFilename = "castorice-rules";
const scopes: { value: ExportJob["mode"]; label: string }[] = [
  { value: "observed", label: "抓取结果" },
  { value: "merged", label: "抓取结果+开源规则库" },
];
const formats: { value: ExportFormat; label: string }[] = [
  { value: "clash", label: "Clash / Mihomo YAML" },
  { value: "provider", label: "Mihomo Rule Provider" },
  { value: "singbox", label: "sing-box Source Rule Set v3" },
];
const ruleSourcesPath = "/rules/sources?compact=true";

function entryKey(entry: ExportResult["entries"][number]) {
  return `${entry.rule_type},${entry.rule_value}`;
}

type PageSize = number | "all";
const entryPageSizes = [30, 60, 100];
const contentPageSizes: PageSize[] = [100, 200, 500, "all"];

function Pager(p: {
  count: number;
  filteredCount?: number;
  page: number;
  size: PageSize;
  selected?: number;
  onPage: (page: number) => void;
  onSize: (size: PageSize) => void;
}) {
  const isContent = p.selected === undefined;
  const label = isContent ? "每页行数" : "每页条目";
  const pages =
    p.size === "all" ? 0 : Math.ceil((p.filteredCount ?? p.count) / p.size);
  return (
    <Stack direction="row" className="preview-pager">
      {pages > 1 && (
        // MUI Pagination reports page numbers starting at one.
        <Pagination
          count={pages}
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
      )}
      <Stack direction="row" className="preview-page-options">
        <Typography
          variant="caption"
          color="text.secondary"
          className="preview-total"
          aria-label={isContent ? "总行数" : "选中条目数 / 总条目数"}
        >
          {isContent ? p.count : `${p.selected} / ${p.count}`}
        </Typography>
        <TextField
          select
          label={label}
          value={p.size}
          onChange={(e) =>
            p.onSize(e.target.value === "all" ? "all" : Number(e.target.value))
          }
        >
          {(isContent ? contentPageSizes : entryPageSizes).map((size) => (
            <MenuItem key={size} value={size}>
              {size === "all" ? "完整显示" : size}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  );
}
export default function ExportDialog(p: Props) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [mode, setMode] = useState<ExportJob["mode"]>("observed");
  const [format, setFormat] = useState<ExportFormat>(p.settings.export_format);
  const [policy, setPolicy] = useState(p.settings.policy);
  const [filename, setFilename] = useState(defaultFilename);
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
  const [syncError, setSyncError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reload, setReload] = useState(0);
  const [copyPreview, setCopyPreview] = useState<{
    key: string;
    content: string;
  }>();
  const [manualCopy, setManualCopy] = useState(false);
  const [editingKey, setEditingKey] = useState<string>();
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [contentPage, setContentPage] = useState(0);
  const [lineSize, setLineSize] = useState<PageSize>(200);
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
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyCategories = useCallback((items: RuleCategory[]) => {
    setCategories(items);
    setCategoryIDs((old) => {
      if (categoryLoading.current) return old;
      const next = old.filter((id) => items.some((item) => item.id === id));
      committedCategories.current = next;
      return next.length === old.length ? old : next;
    });
  }, []);

  // Poll while open: another window or automatic updating may populate an empty cache.
  useEffect(() => {
    if (syncing) return;
    const controller = new AbortController();
    let pending = false;
    let catalog = "";
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const request = { signal: controller.signal };
        const sources = await api<RuleSource[]>(
          ruleSourcesPath,
          "GET",
          undefined,
          request,
        );
        if (controller.signal.aborted) return;
        setSources(sources);
        const nextCatalog = ruleCatalogKey(sources);
        if (catalog !== nextCatalog) {
          const c = await api<RuleCategory[]>(
            "/rules/categories",
            "GET",
            undefined,
            request,
          );
          if (controller.signal.aborted) return;
          catalog = nextCatalog;
          applyCategories(c);
        }
        setLibraryError("");
      } catch (e) {
        if (!controller.signal.aborted) setLibraryError(errorMessage(e));
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoadingLibrary(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [applyCategories, reload, syncing]);

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
  const filenameForExport = filename.trim() || defaultFilename;
  const job = useMemo<ExportJob>(
    () => ({
      task_id: p.task.id,
      mode: mode === "merged" && !categoryIDs.length ? "observed" : mode,
      category_ids: mode === "merged" ? categoryIDs : [],
      category_versions: JSON.parse(categorySnapshot) as Record<string, string>,
      format,
      policy,
      filename: filenameForExport,
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
      filenameForExport,
      listOnly,
      suffix,
      excluded,
    ],
  );
  const key = useMemo(() => JSON.stringify(job), [job]);
  // Renaming the destination preserves the edit to the same generated content.
  const draftKey = useMemo(
    () => JSON.stringify({ ...job, filename: undefined }),
    [job],
  );
  const draft = drafts.get(draftKey);
  const editing = editingKey === draftKey;
  function updateDraft(content: string) {
    setDrafts((previous) => new Map(previous).set(draftKey, content));
  }
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
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (loadingCategory) return;
    const timer = setTimeout(() => {
      void api<ExportResult>("/export", "POST", job, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setPreview({ result, scope, key });
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(errorMessage(e));
            if (e instanceof Error && "status" in e && e.status === 409)
              setReload((v) => v + 1);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job, scope, key, loadingCategory]);

  async function syncLibrary() {
    setSyncing(true);
    setLibraryError("");
    setSyncError("");
    const failures: string[] = [];
    // The cache has one writer. Keep the download active through all sources and the refresh.
    for (const source of sources) {
      try {
        await api(
          "/rules/sync",
          "POST",
          { source: source.id },
          { timeoutMs: 610_000 },
        );
      } catch (e) {
        failures.push(`${source.id}：${errorMessage(e)}`);
      }
    }
    try {
      if (!mounted.current) return;
      const [latestSources, latestCategories] = await Promise.all([
        api<RuleSource[]>(ruleSourcesPath),
        api<RuleCategory[]>("/rules/categories"),
      ]);
      if (!mounted.current) return;
      setSources(latestSources);
      applyCategories(latestCategories);
      if (latestCategories.length) p.onRematch();
    } catch (e) {
      failures.push(errorMessage(e));
    } finally {
      if (mounted.current) {
        setSyncError(failures.join("。"));
        setSyncing(false);
      }
    }
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
            : await api<RuleCategory>(
                "/rules/load",
                "POST",
                { id: c.id },
                { timeoutMs: 95_000 },
              ),
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
    (e) => !excluded.has(entryKey(e)),
  ).length;
  const totalEntries = result?.entries.length ?? 0;
  const totalSelected = useMemo(() => {
    if (!excluded.size) return totalEntries;
    return (
      result?.entries.reduce(
        (count, entry) => count + Number(!excluded.has(entryKey(entry))),
        0,
      ) ?? 0
    );
  }, [result?.entries, totalEntries, excluded]);
  const entryKeys = useMemo(() => entries.map(entryKey), [entries]);
  const setEntriesSelected = useCallback(
    (keys: readonly string[], selected: boolean) => {
      setExcluded((previous) => {
        const next = new Set(previous);
        for (const key of keys) {
          if (selected) next.delete(key);
          else next.add(key);
        }
        return next;
      });
    },
    [],
  );
  const selectEntry = useRangeSelection({
    keys: entryKeys,
    scope,
    isSelected: (key) => !excluded.has(key),
    onSelect: setEntriesSelected,
  });
  const content = draft ?? result?.content ?? "";
  const lines = useMemo(
    () =>
      tab === 1 && !editing && !manualCopy && content
        ? content.replace(/\n$/, "").split("\n")
        : [],
    [tab, editing, manualCopy, content],
  );
  const actualContentPage =
    lineSize === "all"
      ? 0
      : Math.min(
          contentPage,
          Math.max(0, Math.ceil(lines.length / lineSize) - 1),
        );
  const contentStart = lineSize === "all" ? 0 : actualContentPage * lineSize;
  const contentEnd =
    lineSize === "all"
      ? lines.length
      : Math.min(contentStart + lineSize, lines.length);
  const contentPageText = useMemo(
    () => (tab === 1 ? lines.slice(contentStart, contentEnd).join("\n") : ""),
    [tab, lines, contentStart, contentEnd],
  );
  // Two text nodes keep even a complete export scrollable and searchable.
  const contentLineNumbers = useMemo(
    () => (tab === 1 ? lineNumberText(contentStart, contentEnd) : ""),
    [tab, contentStart, contentEnd],
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
  const hasRuleCategories = categories.length > 0;
  const updating =
    syncing ||
    (!hasRuleCategories && sources.some((s) => s.status === "syncing"));
  const showLibraryControls =
    !loadingLibrary &&
    !libraryError &&
    !hasRuleCategories &&
    sources.length > 0;
  const downloadFailure = hasRuleCategories
    ? ""
    : syncError ||
      sources
        .flatMap((source) =>
          source.error ? [`${source.id}：${source.error}`] : [],
        )
        .join("。");
  const canSaveFile = fresh && (!window.castoriceDesktop || !!filename.trim());
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

  const verifiedCopy =
    copyPreview?.key === key ? copyPreview.content : undefined;
  function toggleEditing() {
    if (editing) {
      setEditingKey(undefined);
      return;
    }
    if (!fresh || !result) return;
    if (draft === undefined) updateDraft(result.content);
    setManualCopy(false);
    setEditingKey(draftKey);
  }
  function copyContent() {
    if (!fresh || !result) return;
    if (mode === "merged" && verifiedCopy === undefined) {
      useFreshResult(async (current) => {
        setCopyPreview({ key, content: current.content });
        p.notify("已核对规则版本，点击「复制内容」复制");
      });
      return;
    }
    void copy(draft ?? verifiedCopy ?? result.content)
      .then(() => p.notify("完整规则已复制"))
      .catch((e) => {
        setTab(1);
        setEditingKey(undefined);
        setManualCopy(true);
        p.notify(errorMessage(e));
      });
  }

  return (
    <Dialog
      aria-labelledby="export-dialog-title"
      slotProps={{ transition: { onExited: p.onExited } }}
      open={p.open ?? true}
      onClose={p.onClose}
      maxWidth="lg"
      fullWidth
      className="export-dialog"
    >
      <DialogTitle id="export-dialog-heading" className="export-title">
        <Box component="span" id="export-dialog-title">
          预览与导出规则
        </Box>
        {scopeWarnings.length > 0 && (
          <ContextHelp
            label="查看抓取与范围提示"
            className="export-hint"
            warning
          >
            {scopeWarnings.map(tipText).join("\n\n")}
          </ContextHelp>
        )}
        <Button
          size="small"
          startIcon={<TuneRounded />}
          endIcon={
            <ExpandMoreRounded
              sx={{
                transform: settingsOpen ? "rotate(180deg)" : "none",
                transition: (theme) =>
                  theme.transitions.create("transform", {
                    duration: theme.transitions.duration.short,
                  }),
              }}
            />
          }
          aria-expanded={settingsOpen}
          aria-controls="export-settings"
          sx={{ ml: "auto", flexShrink: 0 }}
          onClick={() => {
            if (settingsOpen) setCategoryOpen(false);
            setSettingsOpen(!settingsOpen);
          }}
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
        <Collapse
          in={settingsOpen}
          className="export-settings-collapse"
          slotProps={{
            root: { id: "export-settings", inert: !settingsOpen },
            wrapperInner: { className: "export-settings" },
          }}
        >
          <Box className="export-primary-controls">
            <SegmentedControl
              label="导出范围"
              className="export-scope"
              options={scopes}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setStateFilter("all");
                setExcluded(new Set());
                setPage(0);
              }}
            />
            <SegmentedControl
              label="输出格式"
              className="export-format"
              options={formats}
              value={format}
              onChange={setFormat}
            />
            <TextField
              className="export-policy"
              label="策略组名称"
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              disabled={format !== "clash"}
              slotProps={{
                input: {
                  endAdornment: format === "clash" && (
                    <ContextHelp label="查看策略组说明" className="export-hint">
                      在 Clash 或 Mihomo 客户端配置的 proxy-groups
                      中找到已有的名称，再将它填入这里
                    </ContextHelp>
                  ),
                },
              }}
            />
          </Box>
          {(mode === "merged" || syncing) && (
            <Box className="export-library">
              <Box className="export-library-controls">
                <Box
                  className="export-library-field"
                  data-downloading={updating || undefined}
                >
                  <Autocomplete
                    multiple
                    size="small"
                    disabled={mode !== "merged"}
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
                      hasRuleCategories
                        ? "没有匹配的分类，请换个名称搜索"
                        : libraryError
                          ? "暂时无法读取分类，可重试"
                          : "本地暂无可用的规则分类"
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
                        error={showLibraryControls}
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
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
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
                  {updating && (
                    <LinearProgress
                      aria-label="正在下载规则库"
                      className="export-library-progress"
                    />
                  )}
                </Box>
                {showLibraryControls && (
                  <Stack direction="row" className="export-library-actions">
                    <Button
                      variant="outlined"
                      startIcon={<DownloadRounded />}
                      disabled={updating}
                      onClick={() => void syncLibrary()}
                    >
                      下载规则库
                    </Button>
                    <ContextHelp label="查看规则库下载提示" error>
                      本地暂无可用的规则分类，下载后可搜索并合并
                    </ContextHelp>
                  </Stack>
                )}
              </Box>
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
                  {tipText(libraryError)}
                </Alert>
              )}
              {!updating && downloadFailure && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {tipText(downloadFailure)}
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
              <ContextHelp
                label="查看 DOMAIN-SUFFIX 提示"
                className="export-hint"
                warning={suffix}
              >
                {suffix ? `${suffixWarning} ${suffixHelp}` : suffixHelp}
              </ContextHelp>
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
        </Collapse>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 1 }}
            action={
              <Button onClick={() => setExcluded(new Set())}>恢复选择</Button>
            }
          >
            {tipText(error)}
          </Alert>
        )}
        <Box className="export-preview-header" sx={{ borderColor: "divider" }}>
          <Box className="export-preview-tabs">
            <Tabs
              value={tab}
              onChange={(_, value) => {
                setTab(value);
                setEditingKey(undefined);
                setManualCopy(false);
              }}
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
            {tab === 1 && (
              <IconButton
                size="small"
                aria-label="编辑文件内容"
                aria-pressed={editing}
                aria-controls="export-content"
                title={editing ? "退出编辑" : "编辑文件内容"}
                color={editing ? "primary" : "default"}
                disabled={!editing && !fresh}
                onClick={toggleEditing}
              >
                <EditRounded fontSize="small" />
              </IconButton>
            )}
          </Box>
          {result && !error && (
            <Stack direction="row" className="export-summary">
              <Chip label={`重复或覆盖 ${result.duplicate_or_covered} 条`} />
              <Chip
                label={`${draft !== undefined && draft !== result.content ? "原预览" : "最终导出"} ${result.final_rules} 条`}
                color="primary"
              />
            </Stack>
          )}
        </Box>
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
            onKeyDown={(event) =>
              selectAllInList(event, () => {
                if (currentScope) setEntriesSelected(entryKeys, true);
              })
            }
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
            <TableContainer
              ref={entryScroll}
              className="preview-scroll scroll-region"
              role="region"
              aria-label="预览条目列表"
              tabIndex={0}
            >
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
                          setEntriesSelected(pageEntries.map(entryKey), checked)
                        }
                      />
                    </TableCell>
                    <TableCell sx={{ width: "46%" }}>类型 / 域名</TableCell>
                    <TableCell>来源与覆盖关系</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageEntries.map((entry) => {
                    const key = entryKey(entry);
                    return (
                      <TableRow
                        key={key}
                        hover={currentScope}
                        className="preview-row"
                        data-selectable={currentScope}
                        data-selected={!excluded.has(key)}
                        tabIndex={-1}
                        onMouseDown={(event) => {
                          if (event.shiftKey) event.preventDefault();
                        }}
                        onClick={(event) => {
                          if (!currentScope) return;
                          if (
                            !event.currentTarget.contains(
                              document.activeElement,
                            )
                          )
                            event.currentTarget.focus({ preventScroll: true });
                          selectEntry(key, event.shiftKey);
                        }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            disabled={!currentScope}
                            checked={!excluded.has(key)}
                            slotProps={{
                              input: { "aria-label": `导出 ${key}` },
                            }}
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
                              覆盖，不重复输出。取消上层规则后会恢复
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
              count={totalEntries}
              filteredCount={entries.length}
              page={actualPage}
              size={pageSize}
              selected={totalSelected}
              onPage={setPage}
              onSize={(size) => {
                if (size === "all") return;
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
            {manualCopy ? (
              <>
                <NumberedTextEditor
                  editorRef={editor}
                  label="可手动复制的完整规则"
                  value={fresh ? (draft ?? verifiedCopy ?? result.content) : ""}
                  autoFocus
                />
                <Button size="small" onClick={() => setManualCopy(false)}>
                  返回文件预览
                </Button>
              </>
            ) : editing ? (
              <NumberedTextEditor
                editorRef={editor}
                label="规则文件内容编辑区"
                value={content}
                onChange={updateDraft}
                autoFocus
              />
            ) : (
              <>
                <Box
                  ref={contentScroll}
                  className="preview-scroll content-preview"
                  tabIndex={0}
                  role="region"
                  aria-label="规则文件预览"
                  sx={{ bgcolor: "action.hover", borderRadius: 1 }}
                >
                  <Box className="preview-text-grid">
                    <pre className="line-number" aria-hidden="true">
                      {contentLineNumbers}
                    </pre>
                    <pre className="preview-file-text">{contentPageText}</pre>
                  </Box>
                </Box>
                <Pager
                  count={lines.length}
                  page={actualContentPage}
                  size={lineSize}
                  onPage={setContentPage}
                  onSize={(size) => {
                    setLineSize(size);
                    setContentPage(0);
                  }}
                />
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions
        className="export-actions"
        disableSpacing
        sx={{ px: 2, py: 1.25, flexWrap: "wrap", gap: 0.5 }}
      >
        {result?.attribution && (
          <Button
            disabled={!canSaveFile}
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
        <Box className="export-save-controls">
          <Button
            className="export-copy-action"
            startIcon={<ContentCopyRounded />}
            disabled={!fresh}
            onClick={copyContent}
          >
            {mode === "merged" && verifiedCopy === undefined
              ? "校验并准备复制"
              : "复制内容"}
          </Button>
          <TextField
            className="export-filename"
            label="文件名称"
            placeholder={defaultFilename}
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
          <Button
            variant="contained"
            startIcon={<DownloadRounded />}
            disabled={!canSaveFile}
            onClick={() =>
              useFreshResult((current) =>
                download(
                  draft ?? current.content,
                  current.filename,
                  current.mime,
                ).then((path) =>
                  p.notify(
                    path ? `已保存至 ${path}` : `已生成 ${current.filename}`,
                  ),
                ),
              )
            }
          >
            {window.castoriceDesktop ? "保存到软件目录" : "下载文件"}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
