import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  ContentCopyRounded,
  DownloadRounded,
  RefreshRounded,
  SettingsRounded,
} from "@mui/icons-material";
import type { RuleCategory, RuleSource } from "../types";
import { api, copy, download } from "../services/api";
import { date, errorMessage } from "../utils/format";
interface Props {
  onClose: () => void;
  notify: (s: string) => void;
  onRematch: () => void;
  initialCategory?: string;
}
const names: Record<string, string> = {
  not_initialized: "未下载",
  syncing: "正在更新",
  ready: "本地可用",
  error: "更新失败",
  cached: "使用旧缓存",
  cache_invalid: "需重新更新",
};
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
  const [settings, setSettings] = useState(false);
  const [details, setDetails] = useState("");
  const [limit, setLimit] = useState(100);
  const editor = useRef<HTMLTextAreaElement>(null);
  const selectedVersion = sources.find(
    (s) => s.id === selected.split(":")[0],
  )?.version;
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      try {
        const [s, c] = await Promise.all([
          api<RuleSource[]>("/rules/sources"),
          api<RuleCategory[]>(
            "/rules/categories?q=" + encodeURIComponent(query.trim()),
          ),
        ]);
        if (!cancelled) {
          setSources(s);
          setCategories(c);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    }
    const timer = setTimeout(() => void reload(), 180);
    const interval = setInterval(() => void reload(), 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [query]);
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
          await api("/rules/load", "POST", { id: selected });
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
    operation: "sync" | "check" | "auto",
    enabled?: boolean,
  ) {
    setBusy(id);
    setError("");
    try {
      await api(
        "/rules/" + (operation === "auto" ? "auto-update" : operation),
        operation === "auto" ? "PUT" : "POST",
        { source: id, ...(operation === "auto" ? { enabled } : {}) },
      );
      setSources(await api<RuleSource[]>("/rules/sources"));
      setCategories(
        await api<RuleCategory[]>(
          "/rules/categories?q=" + encodeURIComponent(query.trim()),
        ),
      );
      if (operation === "sync") {
        p.notify("规则原文与索引已更新到本地");
        p.onRematch();
      }
      if (operation === "check") p.notify("已检查上游可达性与最新版本");
    } catch (e) {
      setError(errorMessage(e));
      setSources(
        await api<RuleSource[]>("/rules/sources").catch(() => sources),
      );
    } finally {
      setBusy("");
    }
  }
  const list = categories.filter(
    (c) => sourceFilter === "all" || c.source === sourceFilter,
  );
  const source = sources.find((s) => s.id === content?.source);
  const sourceURL =
    source && content
      ? source.repository + "/blob/" + content.version + "/" + content.path
      : "";
  return (
    <Dialog
      open
      fullWidth
      maxWidth={false}
      onClose={p.onClose}
      className="library-dialog"
    >
      <DialogTitle sx={{ py: 1, px: 2 }}>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            开源规则库
          </Typography>
          <Button
            size="small"
            startIcon={<SettingsRounded />}
            onClick={() => setSettings(true)}
          >
            规则库设置
          </Button>
          <IconButton aria-label="关闭规则库" onClick={p.onClose}>
            <CloseRounded />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          p: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Stack
          direction="row"
          className="library-toolbar"
          sx={{ gap: 1, px: 2, py: 1.5, flexShrink: 0 }}
        >
          <TextField
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(100);
            }}
            placeholder="搜索分类或规则域名，如 Facebook"
            slotProps={{ htmlInput: { "aria-label": "搜索规则分类" } }}
            sx={{ flex: 1 }}
          />
          <TextField
            select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            slotProps={{ htmlInput: { "aria-label": "规则来源筛选" } }}
            sx={{ minWidth: 130 }}
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
            {error}
          </Alert>
        )}
        <Box className="library-workspace">
          <Box
            className="category-list"
            role="navigation"
            aria-label="规则分类列表"
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
                    ? "规则库正在下载，完成后即可搜索。"
                    : sources.some((s) => s.category_count)
                      ? "没有匹配分类或域名"
                      : "尚未下载规则库"}
                </Typography>
                {!sources.some((s) => s.category_count) && (
                  <Button sx={{ mt: 1 }} onClick={() => setSettings(true)}>
                    下载 / 自动更新设置
                  </Button>
                )}
              </Box>
            )}
          </Box>
          <Box className="rule-reader">
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
                规则已更新，临时编辑已保留。可先复制编辑内容。
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
                <Stack
                  direction="row"
                  sx={{
                    gap: 1,
                    alignItems: "center",
                    flexWrap: "wrap",
                    p: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 100 }}>
                    <Typography sx={{ fontWeight: 650 }}>
                      {content.name}
                      {content.format === "yaml" ? ".yaml" : ""}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {content.source} · {content.version.slice(0, 8)}
                    </Typography>
                  </Box>
                  <Tooltip title="全选文本">
                    <Button
                      size="small"
                      onClick={() => {
                        editor.current?.focus();
                        editor.current?.select();
                      }}
                    >
                      全选
                    </Button>
                  </Tooltip>
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
                  <Button
                    size="small"
                    startIcon={<DownloadRounded />}
                    onClick={() =>
                      void download(
                        draft,
                        content.name.replace(/[<>:"/\\|?*]/g, "_") +
                          (content.format === "yaml" ? ".yaml" : ".txt"),
                        "text/plain;charset=utf-8",
                      )
                        .then(() => p.notify("规则文本已导出"))
                        .catch((e) => p.notify(errorMessage(e)))
                    }
                  >
                    下载
                  </Button>
                </Stack>
                <Box
                  component="textarea"
                  ref={editor}
                  className="rule-editor"
                  aria-label="规则原文编辑区"
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  sx={{ color: "text.primary", bgcolor: "background.default" }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ px: 1.5 }}
                >
                  临时编辑仅用于复制 / 下载，不改变匹配缓存
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
                  <Link
                    href={sourceURL}
                    target="_blank"
                    rel="noreferrer"
                    variant="caption"
                  >
                    上游原文件
                  </Link>
                  <Button size="small" onClick={() => setDetails("license")}>
                    许可证
                  </Button>
                  {!!content.warnings?.length && (
                    <Button size="small" onClick={() => setDetails("warnings")}>
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
                  ) : (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: "auto" }}
                    >
                      原文可完整选中、编辑、复制
                    </Typography>
                  )}
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
                  YAML 中的 IP、进程等规则也会原样保留。
                </Typography>
              </Stack>
            )}
          </Box>
        </Box>
      </DialogContent>
      <Dialog
        open={settings}
        onClose={() => setSettings(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>规则库设置</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            开启后立即下载到本地，运行期间每天检查更新。失败时保留旧缓存；关闭软件后不在后台运行。
          </Typography>
          {sources.map((s) => (
            <Box
              key={s.id}
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                p: 1.5,
                mb: 1.5,
              }}
            >
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  {s.name}
                </Typography>
                <Chip
                  size="small"
                  label={names[s.status] || s.status}
                  color={s.status === "ready" ? "success" : "default"}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={s.auto_update || false}
                    disabled={!!busy}
                    onChange={(_, checked) =>
                      void action(s.id, "auto", checked)
                    }
                  />
                }
                label="自动更新到本地"
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block" }}
              >
                {s.loaded_count} / {s.category_count} 分类 · 更新于{" "}
                {date(s.updated_at)} · {s.version.slice(0, 8) || "—"}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block" }}
              >
                检查于 {date(s.checked_at)}
                {s.remote_version && s.remote_version !== s.version
                  ? " · 有新版本可下载"
                  : s.remote_version
                    ? " · 已是当前上游版本"
                    : ""}
              </Typography>
              {s.error && (
                <Alert severity="warning" sx={{ my: 1 }}>
                  {s.error}
                </Alert>
              )}
              <Stack direction="row" sx={{ gap: 0.5, mt: 1 }}>
                <Button
                  size="small"
                  disabled={
                    !!busy || sources.some((v) => v.status === "syncing")
                  }
                  startIcon={
                    busy === s.id || s.status === "syncing" ? (
                      <CircularProgress size={14} />
                    ) : (
                      <RefreshRounded />
                    )
                  }
                  onClick={() => void action(s.id, "sync")}
                >
                  {s.version ? "立即更新" : "下载规则库"}
                </Button>
                <Button
                  size="small"
                  disabled={
                    !!busy || sources.some((v) => v.status === "syncing")
                  }
                  onClick={() => void action(s.id, "check")}
                >
                  检查更新
                </Button>
                <Link
                  sx={{ ml: "auto", alignSelf: "center" }}
                  variant="caption"
                  href={s.repository}
                  target="_blank"
                  rel="noreferrer"
                >
                  上游 · {s.license}
                </Link>
              </Stack>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettings(false)}>完成</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={!!details}
        onClose={() => setDetails("")}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {details === "license" ? "上游许可证" : "域名规则转换提示"}
        </DialogTitle>
        <DialogContent dividers>
          <Box component="pre" sx={{ fontSize: 12 }}>
            {details === "license"
              ? source?.license_text || "请更新来源以获取许可证。"
              : "以下条目不参与域名匹配或转换，原文件中仍完整保留。\n\n" +
                content?.warnings.join("\n")}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetails("")}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
