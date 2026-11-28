import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import NumberedTextEditor, { SelectAllTextButton } from "./NumberedTextEditor";
import RuleLibrarySettings, {
  type RuleSourceOperation,
} from "./RuleLibrarySettings";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  ContentCopyRounded,
  KeyboardDoubleArrowRightRounded,
  SettingsRounded,
} from "@mui/icons-material";
import type { RuleCategory, RuleSource } from "../types";
import { api, copy } from "../services/api";
import { errorMessage, ruleCatalogKey, tipText } from "../utils/format";
import "../styles/rule-library.css";
interface Props {
  open?: boolean;
  onExited?: () => void;
  onClose: () => void;
  notify: (s: string) => void;
  onRematch: () => void;
  initialCategory?: string;
  expectedVersion?: string;
  expectedPath?: string;
  zoom?: number;
}
export default function RuleLibrary(p: Props) {
  const [sources, setSources] = useState<RuleSource[]>([]);
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selected, setSelected] = useState(p.initialCategory || "");
  const [content, setContent] = useState<RuleCategory>();
  const [draft, setDraft] = useState("");
  const [incoming, setIncoming] = useState<RuleCategory>();
  const latest = useRef({ content, draft });
  latest.current = { content, draft };
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshCatalog, setRefreshCatalog] = useState(0);
  const [wide, setWide] = useState(true);
  const layoutIsWide = useRef(true);
  const [settingsOverride, setSettingsOverride] = useState<boolean>();
  const settingsOpen = settingsOverride ?? wide;
  const settingsID = useId();
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null);
  const settingsToggle = useRef<HTMLButtonElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState("");
  const [details, setDetails] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  function showDetails(kind: "license" | "warnings") {
    setDetails(kind);
    setDetailsOpen(true);
  }
  const [limit, setLimit] = useState(100);
  const editor = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!workspace) return;
    const resize = () => {
      const { clientWidth, clientHeight } = workspace;
      if (!clientWidth || !clientHeight) return;
      const isWide = clientWidth >= 1020 && clientHeight >= 330;
      if (isWide === layoutIsWide.current) return;
      if (
        !isWide &&
        document.getElementById(settingsID)?.contains(document.activeElement)
      )
        settingsToggle.current?.focus({ preventScroll: true });
      layoutIsWide.current = isWide;
      setWide(isWide);
      setSettingsOverride(undefined);
    };
    const frame = requestAnimationFrame(resize);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(resize);
    observer?.observe(workspace);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [workspace, settingsID, p.zoom]);
  const selectedVersion = sources.find(
    (s) => s.id === selected.split(":")[0],
  )?.version;
  useEffect(() => {
    const controller = new AbortController();
    let catalog = "";
    let pending = false;
    async function reload() {
      if (pending) return;
      pending = true;
      try {
        const request = { signal: controller.signal };
        const s = await api<RuleSource[]>(
          "/rules/sources",
          "GET",
          undefined,
          request,
        );
        if (controller.signal.aborted) return;
        setSources(s);
        const key = ruleCatalogKey(s);
        if (key === catalog) return;
        const c = await api<RuleCategory[]>(
          "/rules/categories?q=" + encodeURIComponent(query.trim()),
          "GET",
          undefined,
          request,
        );
        if (controller.signal.aborted) return;
        catalog = key;
        setCategories(c);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        pending = false;
      }
    }
    const timer = setTimeout(() => void reload(), 180);
    const interval = setInterval(() => void reload(), 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [query, refreshCatalog]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    if (latest.current.content?.id !== selected) {
      setContent(undefined);
      setDraft("");
      setIncoming(undefined);
    }
    async function open() {
      try {
        let c: RuleCategory;
        try {
          c = await api<RuleCategory>(
            "/rules/content?id=" + encodeURIComponent(selected),
          );
        } catch (e) {
          if (!(e instanceof Error) || !("status" in e) || e.status !== 409)
            throw e;
          await api(
            "/rules/load",
            "POST",
            { id: selected },
            { timeoutMs: 95_000 },
          );
          c = await api<RuleCategory>(
            "/rules/content?id=" + encodeURIComponent(selected),
          );
        }
        if (!cancelled) {
          const previous = latest.current;
          if (
            previous.content?.id === c.id &&
            previous.draft !== (previous.content.raw || "")
          ) {
            if (
              c.version !== previous.content.version ||
              c.raw !== previous.content.raw
            )
              setIncoming(c);
          } else {
            setContent(c);
            setDraft(c.raw || "");
            setIncoming(undefined);
          }
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, [selected, selectedVersion]);
  async function action(
    id: string,
    operation: RuleSourceOperation,
    enabled?: boolean,
  ) {
    setBusy(id);
    setError("");
    try {
      await api(
        "/rules/" + (operation === "auto" ? "auto-update" : operation),
        operation === "auto" ? "PUT" : "POST",
        { source: id, ...(operation === "auto" ? { enabled } : {}) },
        { timeoutMs: operation === "sync" ? 610_000 : 35_000 },
      );
      if (operation === "sync") {
        p.notify("规则原文与索引已更新到本地");
        p.onRematch();
      }
      if (operation === "check") p.notify("已检查上游可达性与最新版本");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshCatalog((previous) => previous + 1);
      setBusy("");
    }
  }
  async function clearLibrary() {
    setBusy("clear");
    setClearError("");
    try {
      await api("/rules/cache", "DELETE");
      setCategories([]);
      setSelected("");
      setContent(undefined);
      setDraft("");
      setIncoming(undefined);
      setLoading(false);
      setError("");
      setConfirmClear(false);
      p.notify("已清理本地规则库");
      p.onRematch();
    } catch (e) {
      setClearError(errorMessage(e));
    } finally {
      setRefreshCatalog((previous) => previous + 1);
      setBusy("");
    }
  }
  const list = categories.filter(
    (c) => sourceFilter === "all" || c.source === sourceFilter,
  );
  const source = sources.find((s) => s.id === content?.source);
  const sourceURL =
    source?.repository && content?.path
      ? source.repository +
        "/blob/" +
        content.version +
        "/" +
        content.path.split("/").map(encodeURIComponent).join("/")
      : "";
  const expectedVersion =
    selected === p.initialCategory ? p.expectedVersion : undefined;
  const historySource = sources.find((s) => s.id === selected.split(":")[0]);
  const expectedURL =
    expectedVersion && /^[a-f0-9]{40}$/i.test(expectedVersion) && historySource
      ? historySource.repository +
        (p.expectedPath
          ? "/blob/" +
            expectedVersion +
            "/" +
            p.expectedPath.split("/").map(encodeURIComponent).join("/")
          : "/tree/" + expectedVersion)
      : undefined;
  return (
    <Dialog
      aria-labelledby="rule-library-title"
      slotProps={{ transition: { onExited: p.onExited } }}
      open={p.open ?? true}
      fullWidth
      maxWidth={false}
      onClose={p.onClose}
      className="library-dialog"
    >
      <DialogTitle id="rule-library-heading" className="dialog-heading">
        <span id="rule-library-title">开源规则库</span>
        <IconButton
          aria-label="关闭规则库"
          onClick={p.onClose}
          sx={{ ml: "auto" }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers className="library-body">
        <Stack direction="row" className="library-toolbar">
          <TextField
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(100);
            }}
            placeholder="搜索分类或规则域名"
            slotProps={{ htmlInput: { "aria-label": "搜索规则分类" } }}
            className="library-query"
          />
          <TextField
            select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            slotProps={{
              select: { SelectDisplayProps: { "aria-label": "规则来源筛选" } },
            }}
            className="library-source-filter"
          >
            <MenuItem value="all">所有来源</MenuItem>
            {sources.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.id}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {error && (
          <Alert
            severity="error"
            onClose={() => setError("")}
            sx={{ mx: 2, mb: 1 }}
          >
            {tipText(error)}
          </Alert>
        )}
        <Box
          className="library-workspace"
          ref={setWorkspace}
          data-wide={wide}
          data-settings-open={settingsOpen}
        >
          <Box
            className="category-list scroll-region"
            role="navigation"
            aria-label="规则分类列表"
            tabIndex={0}
            sx={{ borderColor: "divider" }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", p: 1 }}
            >
              {list.length} 个分类 · 搜索本地缓存
            </Typography>
            {list.slice(0, limit).map((c) => (
              <Button
                key={c.id}
                onClick={() => setSelected(c.id)}
                aria-current={selected === c.id ? "true" : undefined}
                className="category-button"
                variant={selected === c.id ? "contained" : "text"}
                sx={{
                  width: "100%",
                  justifyContent: "flex-start",
                  textAlign: "left",
                  px: 1.5,
                  py: 1,
                  borderRadius: 1,
                  color: selected === c.id ? undefined : "text.primary",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{ overflowWrap: "anywhere", fontWeight: 650 }}
                  >
                    {c.name}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {c.source} ·{" "}
                    {c.loaded ? `${c.rule_count} 条域名规则` : "未缓存"}
                  </Typography>
                </Box>
              </Button>
            ))}
            {list.length > limit && (
              <Button fullWidth onClick={() => setLimit((v) => v + 100)}>
                显示更多
              </Button>
            )}
            {!list.length && (
              <Box sx={{ p: 2 }}>
                <Typography color="text.secondary">
                  {sources.some((s) => s.status === "syncing")
                    ? "规则库正在下载，完成后即可搜索"
                    : sources.some((s) => s.category_count)
                      ? "没有匹配分类或域名"
                      : "尚未下载规则库"}
                </Typography>
                {!sources.some((s) => s.category_count) && (
                  <Button
                    sx={{ mt: 1 }}
                    onClick={() => {
                      setSettingsOverride(true);
                      settingsToggle.current?.focus({ preventScroll: true });
                    }}
                  >
                    下载 / 自动更新设置
                  </Button>
                )}
              </Box>
            )}
          </Box>
          <Box className="rule-reader-toolbar" sx={{ borderColor: "divider" }}>
            <Box className="rule-reader-label">
              <Typography sx={{ fontWeight: 650 }}>
                {content
                  ? content.name + (content.format === "yaml" ? ".yaml" : "")
                  : "规则原文"}
              </Typography>
              {content && (
                <Typography variant="caption" color="text.secondary">
                  {content.source} · {content.version.slice(0, 8)}
                </Typography>
              )}
            </Box>
            {content && !loading && (wide || !settingsOpen) && (
              <Box className="rule-reader-actions">
                <SelectAllTextButton editorRef={editor} />
                <Button
                  size="small"
                  startIcon={<ContentCopyRounded />}
                  onClick={() =>
                    void copy(draft)
                      .then(() => p.notify("规则文本已复制"))
                      .catch((e) => p.notify(errorMessage(e)))
                  }
                >
                  复制
                </Button>
              </Box>
            )}
            <Tooltip title={settingsOpen ? "收起规则库设置" : "展开规则库设置"}>
              <IconButton
                size="small"
                ref={settingsToggle}
                className="rule-settings-toggle"
                color={settingsOpen ? "primary" : "default"}
                aria-label={settingsOpen ? "收起规则库设置" : "展开规则库设置"}
                aria-expanded={settingsOpen}
                aria-controls={settingsOpen ? settingsID : undefined}
                onClick={() => setSettingsOverride(!settingsOpen)}
              >
                {settingsOpen ? (
                  <KeyboardDoubleArrowRightRounded />
                ) : (
                  <SettingsRounded />
                )}
              </IconButton>
            </Tooltip>
          </Box>
          <Box className="rule-reader">
            {expectedVersion &&
              !loading &&
              content?.version !== expectedVersion && (
                <Alert severity="warning">
                  历史匹配版本 {expectedVersion.slice(0, 8)}。
                  {content
                    ? `下方为当前缓存 ${content.version.slice(0, 8)}`
                    : "该版本的分类原文在本地不可用"}
                  {expectedURL && (
                    <>
                      {" "}
                      <Link href={expectedURL} target="_blank" rel="noreferrer">
                        查看历史上游版本
                      </Link>
                    </>
                  )}
                </Alert>
              )}
            {incoming && (
              <Alert
                severity="info"
                action={
                  <Button
                    onClick={() => {
                      setContent(incoming);
                      setDraft(incoming.raw || "");
                      setIncoming(undefined);
                    }}
                  >
                    采用新原文
                  </Button>
                }
              >
                规则已更新，临时编辑已保留。可先复制编辑内容
              </Alert>
            )}
            {loading ? (
              <Stack
                sx={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                }}
              >
                <CircularProgress size={24} />
                <Typography>正在读取原文…</Typography>
              </Stack>
            ) : content ? (
              <>
                <NumberedTextEditor
                  editorRef={editor}
                  label="规则原文编辑区"
                  value={draft}
                  onChange={setDraft}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ px: 1.5 }}
                >
                  编辑后的文本可复制。规则匹配使用规则库原文
                </Typography>
                <Stack
                  direction="row"
                  sx={{
                    px: 1.5,
                    py: 0.8,
                    gap: 1.5,
                    alignItems: "center",
                    flexWrap: "wrap",
                    borderTop: 1,
                    borderColor: "divider",
                  }}
                >
                  {sourceURL && (
                    <Link
                      href={sourceURL}
                      target="_blank"
                      rel="noreferrer"
                      variant="caption"
                    >
                      上游原文件
                    </Link>
                  )}
                  <Button size="small" onClick={() => showDetails("license")}>
                    许可证
                  </Button>
                  {!!content.warnings?.length && (
                    <Button
                      size="small"
                      onClick={() => showDetails("warnings")}
                    >
                      {content.warnings.length} 项转换提示
                    </Button>
                  )}
                  {draft !== content.raw ? (
                    <Button
                      size="small"
                      onClick={() => setDraft(content.raw || "")}
                    >
                      恢复原文
                    </Button>
                  ) : null}
                </Stack>
              </>
            ) : (
              <Stack
                sx={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  px: 2,
                }}
              >
                <Typography color="text.secondary">
                  选择分类查看完整原文
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1 }}
                >
                  YAML 中的 IP、进程等规则也会原样保留
                </Typography>
              </Stack>
            )}
          </Box>
          {settingsOpen && (
            <RuleLibrarySettings
              id={settingsID}
              sources={sources}
              busy={busy}
              onSourceAction={(id, operation, enabled) =>
                void action(id, operation, enabled)
              }
              onClear={() => {
                setClearError("");
                setConfirmClear(true);
              }}
            />
          )}
        </Box>
      </DialogContent>
      <Dialog
        open={confirmClear}
        aria-labelledby="clear-library-title"
        aria-describedby="clear-library-description"
        onClose={() => {
          if (!busy) setConfirmClear(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id="clear-library-title">清理规则库</DialogTitle>
        <DialogContent dividers>
          <Typography id="clear-library-description" variant="body2">
            此操作会移除已下载的规则。自动更新开关会保留，已开启的来源会重新下载
          </Typography>
          {clearError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {tipText(clearError)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            autoFocus
            disabled={!!busy}
            onClick={() => setConfirmClear(false)}
          >
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={
              !!busy || sources.some((source) => source.status === "syncing")
            }
            onClick={() => void clearLibrary()}
          >
            {busy === "clear" ? "正在清理…" : "确认清理"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        slotProps={{
          transition: { onExited: () => !detailsOpen && setDetails("") },
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {details === "license" ? "上游许可证" : "域名规则转换提示"}
        </DialogTitle>
        <DialogContent dividers>
          <Box component="pre" sx={{ fontSize: 12 }}>
            {details === "license"
              ? source?.license_text || "请更新来源以获取许可证"
              : "以下条目不参与域名匹配或转换，原文件中仍完整保留\n\n" +
                (content?.warnings.map(tipText).join("\n") || "")}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
