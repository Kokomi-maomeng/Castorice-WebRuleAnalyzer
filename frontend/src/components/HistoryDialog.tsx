import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  TablePagination,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  CloseRounded,
  DeleteOutlineRounded,
  RefreshRounded,
} from "@mui/icons-material";
import useRangeSelection from "../hooks/useRangeSelection";
import type { HistoryDeletion, HistoryPage, ScanTask } from "../types";
import { api } from "../services/api";
import {
  active,
  date,
  errorMessage,
  modeNames,
  statusNames,
} from "../utils/format";
import { scanTargetLabel } from "../utils/scanAddress";
import "../styles/history-v2.css";

const pageSize = 30;
const emptyHistory: HistoryPage = { items: [], total: 0, finished_count: 0 };
type DeletionRequest = { all_finished: true } | { ids: string[] };

interface Props {
  open?: boolean;
  onExited?: () => void;
  onClose: () => void;
  onOpen: (task: ScanTask) => void;
  onDeleted?: (result: HistoryDeletion) => void;
  notify?: (s: string) => void;
}
export default function HistoryDialog(p: Props) {
  const [result, setResult] = useState<{
    history: HistoryPage;
    page: number;
    query: string;
  }>();
  const history = result?.history ?? emptyHistory;
  const [search, setSearch] = useState("");
  const query = search.trim();
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletion, setDeletion] = useState<{
    request: DeletionRequest;
    count: number;
  }>();
  const [deletionError, setDeletionError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const requestedQuery = useRef("");
  const mounted = useRef(true);
  const { transitions } = useTheme();
  const select = useRangeSelection({
    keys: history.items.filter((task) => !active(task)).map((task) => task.id),
    scope: `${result?.page ?? 0}:${result?.query ?? ""}`,
    isSelected: (key) => selected.has(key),
    onSelect: (keys, checked) => {
      setSelected((old) => {
        const updated = new Set(old);
        for (const key of keys) {
          if (checked) updated.add(key);
          else updated.delete(key);
        }
        return updated;
      });
    },
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (p.open === false) return;
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);

    async function fetchHistory() {
      requestedQuery.current = query;
      try {
        const history = await api<HistoryPage>(
          `/scans/history?limit=${pageSize}&offset=${page * pageSize}&q=${encodeURIComponent(query)}`,
          "GET",
          undefined,
          { signal },
        );
        if (signal.aborted) return;
        const lastPage = Math.max(0, Math.ceil(history.total / pageSize) - 1);
        if (page > lastPage) setPage(lastPage);
        else setResult({ history, query, page });
        setError("");
      } catch (e) {
        if (!signal.aborted) setError(errorMessage(e));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }

    const timer = setTimeout(
      () => void fetchHistory(),
      query === requestedQuery.current ? 0 : 140,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, query, refresh, p.open]);
  useEffect(() => {
    if (p.open === false) return;
    setShowProgress(false);
    if (!loading) return;
    const timer = setTimeout(() => setShowProgress(true), 280);
    return () => clearTimeout(timer);
  }, [loading, p.open]);
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    if (result?.page === undefined || transitions.duration.short === 0) return;
    const animation = results.current?.animate?.(
      [
        { opacity: 0.78, transform: "translateY(3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: transitions.duration.short,
        easing: transitions.easing.easeOut,
      },
    );
    return () => animation?.cancel();
  }, [result?.page, result?.query, transitions]);
  function confirmRemoval(request: DeletionRequest, count: number) {
    setDeletion({ request, count });
    setDeletionError("");
    setConfirmOpen(true);
  }
  async function remove() {
    if (!deletion) return;
    setBusy(true);
    setDeletionError("");
    try {
      const result = await api<HistoryDeletion>(
        "/scans",
        "DELETE",
        deletion.request,
      );
      if (!mounted.current) return;
      setConfirmOpen(false);
      setSelected(new Set());
      p.onDeleted?.(result);
      p.notify?.(`已删除 ${result.deleted} 条历史`);
      setRefresh((count) => count + 1);
    } catch (e) {
      if (mounted.current) setDeletionError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        open={p.open ?? true}
        aria-labelledby="history-title"
        fullWidth
        maxWidth="md"
        onClose={busy ? undefined : p.onClose}
        slotProps={{
          paper: { className: "history-paper" },
          transition: { onExited: p.onExited },
        }}
      >
        <DialogTitle id="history-title" className="history-title">
          扫描历史
          <IconButton
            aria-label="刷新历史"
            onClick={() => setRefresh((count) => count + 1)}
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
        <DialogContent dividers className="history-body">
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          <div className="history-toolbar">
            <TextField
              label="搜索历史地址"
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                setSearch(value);
                if (value.trim() !== query) setPage(0);
              }}
            />
            <Button
              startIcon={<DeleteOutlineRounded />}
              disabled={!selected.size || busy}
              onClick={() =>
                confirmRemoval({ ids: [...selected] }, selected.size)
              }
            >
              删除所选 ({selected.size})
            </Button>
            <Button
              color="error"
              disabled={!history.finished_count || busy}
              onClick={() =>
                confirmRemoval({ all_finished: true }, history.finished_count)
              }
            >
              清空已结束历史
            </Button>
          </div>
          <div className="history-list-body">
            {showProgress && (
              <LinearProgress className="history-progress" aria-hidden />
            )}
            <div
              ref={list}
              className="history-content scroll-region"
              role="region"
              tabIndex={0}
              aria-label="历史列表"
              aria-busy={loading}
            >
              <div ref={results} className="history-results">
                {history.items.map((t) => {
                  const host = scanTargetLabel(t.target_url);
                  const completed = t.status === "completed";
                  const selectable = !active(t) && !busy;
                  return (
                    <Box
                      className="history-record"
                      key={t.id}
                      sx={{
                        border: 1,
                        borderColor: "divider",
                        backgroundColor: selected.has(t.id)
                          ? "action.selected"
                          : "transparent",
                      }}
                    >
                      <Checkbox
                        className="history-select history-row-action"
                        disabled={!selectable}
                        checked={selected.has(t.id)}
                        slotProps={{
                          input: { "aria-label": `选择历史 ${host}` },
                        }}
                        onClick={(event) => {
                          if (selectable) select(t.id, event.shiftKey);
                        }}
                      />
                      <ButtonBase
                        className="history-open"
                        aria-label={`打开历史 ${host}`}
                        aria-describedby={`history-details-${t.id}`}
                        disabled={busy || p.open === false}
                        sx={{ "&:hover": { backgroundColor: "action.hover" } }}
                        onClick={(event) => {
                          if (
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey
                          ) {
                            if (selectable) select(t.id, event.shiftKey);
                          } else p.onOpen(t);
                        }}
                      >
                        <Typography component="span" className="history-host">
                          {host}
                        </Typography>
                        <span
                          id={`history-details-${t.id}`}
                          className="history-details"
                        >
                          <Chip
                            component="span"
                            label={statusNames[t.status] || t.status}
                            color={completed ? "primary" : "default"}
                            variant={completed ? "filled" : "outlined"}
                          />
                          <Typography
                            component="time"
                            dateTime={t.started_at}
                            variant="caption"
                            color="text.secondary"
                          >
                            {date(t.started_at)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {`${modeNames[t.options.mode]} · ${t.domain_count} 个域名 · ${t.request_count} 条请求`}
                          </Typography>
                          {t.recommended_category && (
                            <Chip
                              component="span"
                              label={t.recommended_category}
                              color="secondary"
                              variant="outlined"
                            />
                          )}
                        </span>
                      </ButtonBase>
                      <IconButton
                        className="history-delete history-row-action"
                        aria-label={`删除历史 ${host}`}
                        disabled={!selectable}
                        onClick={() => confirmRemoval({ ids: [t.id] }, 1)}
                      >
                        <DeleteOutlineRounded />
                      </IconButton>
                    </Box>
                  );
                })}
                {result && !history.items.length && (
                  <Typography color="text.secondary" className="history-empty">
                    {result.query ? "没有匹配的历史" : "还没有扫描历史"}
                  </Typography>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
        <Box className="history-footer">
          <Typography
            variant="caption"
            color="text.secondary"
            aria-live="polite"
          >
            共 {history.total} 条匹配 · {history.finished_count} 条已结束
          </Typography>
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
            page={result?.page ?? 0}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[pageSize]}
            onPageChange={(_, value) => {
              if (value !== page) setPage(value);
              else if (!loading) setRefresh((count) => count + 1);
            }}
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} / ${count}`
            }
          />
        </Box>
      </Dialog>
      <Dialog
        open={confirmOpen}
        onClose={busy ? undefined : () => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>确认删除历史</DialogTitle>
        <DialogContent>
          <Typography>
            将永久删除
            {deletion && "all_finished" in deletion.request
              ? "全部已结束的 "
              : "所选的 "}
            {deletion?.count} 条扫描记录及关联请求、域名和日志。
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            正在运行的任务、规则缓存、设置及已导出文件保留。
          </Typography>
          {deletionError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {deletionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirmOpen(false)}>
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
