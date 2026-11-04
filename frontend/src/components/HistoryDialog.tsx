import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TablePagination,
  TextField,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  DeleteOutlineRounded,
  OpenInNewRounded,
  RefreshRounded,
} from "@mui/icons-material";
import type { HistoryDeletion, HistoryPage, ScanTask } from "../types";
import { api } from "../services/api";
import {
  active,
  date,
  errorMessage,
  modeNames,
  statusNames,
} from "../utils/format";
interface Props {
  open?: boolean;
  onExited?: () => void;
  onClose: () => void;
  onOpen: (task: ScanTask) => void;
  onDeleted?: (result: HistoryDeletion) => void;
  notify?: (s: string) => void;
}
export default function HistoryDialog(p: Props) {
  const [history, setHistory] = useState<HistoryPage>({
    items: [],
    total: 0,
    finished_count: 0,
  });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<"selected" | "all" | string>("");
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const reload = useCallback(async () => {
    const g = ++generation.current;
    setLoading(true);
    try {
      const result = await api<HistoryPage>(
        `/scans/history?limit=30&offset=${page * 30}&q=${encodeURIComponent(query)}`,
      );
      if (g === generation.current) {
        setHistory(result);
        setError("");
        if (page > 0 && page * 30 >= result.total)
          setPage(Math.max(0, Math.ceil(result.total / 30) - 1));
      }
    } catch (e) {
      if (g === generation.current) setError(errorMessage(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, [page, query]);
  useEffect(() => {
    if (p.open === false) return;
    const timer = setTimeout(() => void reload(), 180);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [reload, p.open]);
  const selectedCount =
    confirm === "all"
      ? history.finished_count
      : confirm === "selected"
        ? selected.size
        : 1;
  async function remove() {
    setBusy(true);
    setError("");
    try {
      const result = await api<HistoryDeletion>(
        "/scans",
        "DELETE",
        confirm === "all"
          ? { all_finished: true }
          : { ids: confirm === "selected" ? [...selected] : [confirm] },
      );
      if (!mounted.current) return;
      setConfirm("");
      setSelected(new Set());
      p.onDeleted?.(result);
      p.notify?.(`已删除 ${result.deleted} 条历史`);
      await reload();
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        open={p.open ?? true}
        fullWidth
        maxWidth="md"
        onClose={busy ? undefined : p.onClose}
        slotProps={{ transition: { onExited: p.onExited } }}
      >
        <DialogTitle>
          扫描历史
          <IconButton
            aria-label="刷新历史"
            onClick={() => void reload()}
            disabled={loading || busy}
            sx={{ ml: 1 }}
          >
            <RefreshRounded />
          </IconButton>
          <IconButton
            aria-label="关闭历史"
            onClick={p.onClose}
            disabled={busy}
            sx={{ float: "right" }}
          >
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          <Stack
            direction="row"
            sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1.5 }}
          >
            <TextField
              label="搜索历史地址"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <Button
              startIcon={<DeleteOutlineRounded />}
              disabled={!selected.size || busy}
              onClick={() => setConfirm("selected")}
            >
              删除所选 ({selected.size})
            </Button>
            <Button
              color="error"
              disabled={!history.finished_count || busy}
              onClick={() => setConfirm("all")}
            >
              清空已结束历史
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            共 {history.total} 条匹配记录，{history.finished_count}{" "}
            条已结束历史。运行中的任务保留；清理不影响规则缓存、设置和已导出文件。
          </Typography>
          {loading && <CircularProgress size={18} sx={{ ml: 1 }} />}
          <Stack sx={{ mt: 2, gap: 1.5 }}>
            {history.items.map((t) => (
              <Stack
                className="motion-row"
                direction="row"
                key={t.id}
                sx={{
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 3,
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Checkbox
                  disabled={active(t) || busy}
                  checked={selected.has(t.id)}
                  slotProps={{
                    input: { "aria-label": `选择历史 ${t.target_url}` },
                  }}
                  onChange={() =>
                    setSelected((old) => {
                      const value = new Set(old);
                      if (value.has(t.id)) value.delete(t.id);
                      else value.add(t.id);
                      return value;
                    })
                  }
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{ overflowWrap: "anywhere", fontWeight: 600 }}
                  >
                    {t.target_url}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {date(t.started_at)} · {modeNames[t.options.mode]} ·{" "}
                    {t.domain_count} 个域名 · {t.request_count} 条请求
                  </Typography>
                  <Stack direction="row" sx={{ gap: 1, mt: 0.75 }}>
                    <Chip
                      label={statusNames[t.status] || t.status}
                      variant="outlined"
                    />
                    {t.recommended_category && (
                      <Chip
                        label={t.recommended_category}
                        color="secondary"
                        variant="outlined"
                      />
                    )}
                  </Stack>
                </Box>
                <Stack sx={{ gap: 0.5 }}>
                  <Button
                    size="small"
                    startIcon={<OpenInNewRounded />}
                    disabled={busy}
                    onClick={() => {
                      p.onOpen(t);
                      p.onClose();
                    }}
                  >
                    打开
                  </Button>
                  <IconButton
                    aria-label={`删除历史 ${t.target_url}`}
                    disabled={active(t) || busy}
                    onClick={() => setConfirm(t.id)}
                  >
                    <DeleteOutlineRounded />
                  </IconButton>
                </Stack>
              </Stack>
            ))}
            {!loading && !history.items.length && (
              <Typography
                color="text.secondary"
                sx={{ p: 5, textAlign: "center" }}
              >
                {query ? "没有匹配的历史" : "还没有扫描历史"}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <TablePagination
          component="div"
          getItemAriaLabel={(type) =>
            type === "previous"
              ? "上一页历史"
              : type === "next"
                ? "下一页历史"
                : type === "first"
                  ? "首页历史"
                  : "末页历史"
          }
          count={history.total}
          page={page}
          rowsPerPage={30}
          rowsPerPageOptions={[30]}
          onPageChange={(_, value) => setPage(value)}
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} / ${count}`
          }
        />
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={busy ? undefined : () => setConfirm("")}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>确认删除历史</DialogTitle>
        <DialogContent>
          <Typography>
            将永久删除{confirm === "all" ? "全部已结束的 " : "所选的 "}
            {selectedCount} 条扫描记录及关联请求、域名和日志。
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            正在运行的任务、规则缓存、设置及已导出文件保留。
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm("")}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "正在删除…" : "确认删除"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
