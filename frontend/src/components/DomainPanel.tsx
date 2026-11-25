import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ArrowUpwardRounded,
  CloseRounded,
  ContentCopyRounded,
  DownloadRounded,
  SearchRounded,
  SwapVertRounded,
  TravelExploreRounded,
} from "@mui/icons-material";
import type { DomainRecord, ScanTask } from "../types";
import { copy } from "../services/api";
import useRangeSelection from "../hooks/useRangeSelection";
import { isExportable, time } from "../utils/format";
import "../styles/domains-v2.css";

const sortLabels = { name: "字母顺序", count: "请求次数", time: "发现时间" };
type Sort = keyof typeof sortLabels;
const directions = ["default", "ascending", "descending"] as const;

interface Props {
  domains: DomainRecord[];
  task?: Pick<ScanTask, "domain_count" | "matches">;
  syncingResults?: boolean;
  excluded: Set<string>;
  onSelect: (hosts: readonly string[], selected: boolean) => void;
  onExport: () => void;
  onRequests: (host: string) => void;
  notify: (s: string) => void;
}
export default function DomainPanel(p: Props) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("name");
  const [directionIndex, setDirectionIndex] = useState(0);
  const [limit, setLimit] = useState(100);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const filter = useDeferredValue(query.trim().toLowerCase());
  const direction = directions[directionIndex];
  const descending =
    direction === "descending" || (direction === "default" && sort === "count");
  const sorted = useMemo(
    () =>
      [...p.domains].sort((a, b) => {
        const order =
          sort === "count"
            ? a.request_count - b.request_count
            : sort === "time"
              ? Date.parse(a.first_seen) - Date.parse(b.first_seen)
              : a.hostname.localeCompare(b.hostname);
        return (
          (descending ? -order : order) || a.hostname.localeCompare(b.hostname)
        );
      }),
    [p.domains, sort, descending],
  );
  const list = useMemo(
    () => sorted.filter((d) => d.hostname.includes(filter)),
    [sorted, filter],
  );
  const selectableHosts = useMemo(
    () => p.domains.filter(isExportable).map((d) => d.hostname),
    [p.domains],
  );
  const selectableInView = useMemo(
    () => list.filter(isExportable).map((d) => d.hostname),
    [list],
  );
  const selectedCount = selectableHosts.filter(
    (host) => !p.excluded.has(host),
  ).length;
  const returnedDomainCount = useMemo(
    () => p.domains.filter((d) => d.kind === "domain").length,
    [p.domains],
  );
  const domainCount = Math.max(p.task?.domain_count ?? 0, returnedDomainCount);
  const allSelected =
    selectedCount > 0 && selectedCount === selectableHosts.length;
  const select = useRangeSelection({
    keys: selectableInView,
    isSelected: (host) => !p.excluded.has(host),
    onSelect: p.onSelect,
  });
  const matched = useMemo(
    () => new Set(p.task?.matches.flatMap((m) => m.matched_domains) || []),
    [p.task?.matches],
  );

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    setLimit(100);
    searchButton.current?.focus();
  }
  return (
    <Paper
      component="section"
      className="domain-panel motion-surface"
      sx={{
        border: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Box className="domain-heading">
        <Typography variant="h6">观察到的域名</Typography>
        <Box className="domain-search" data-open={searchOpen}>
          <Box className="domain-search-field" aria-hidden={!searchOpen}>
            <TextField
              id="domain-search"
              inputRef={searchInput}
              size="small"
              placeholder="搜索域名"
              value={query}
              disabled={!searchOpen}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(100);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeSearch();
                }
              }}
              fullWidth
              slotProps={{ htmlInput: { "aria-label": "搜索域名" } }}
            />
          </Box>
          <IconButton
            ref={searchButton}
            aria-label={searchOpen ? "关闭域名搜索" : "搜索域名"}
            aria-expanded={searchOpen}
            aria-controls="domain-search"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <SearchRounded className="domain-search-icon" />
            <CloseRounded className="domain-search-close" />
          </IconButton>
        </Box>
      </Box>
      <Divider />
      <Box className="domain-toolbar">
        <Checkbox
          className="domain-toolbar-select domain-row-action"
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          disabled={!selectableHosts.length}
          onChange={() => p.onSelect(selectableHosts, !allSelected)}
          slotProps={{
            input: {
              "aria-label": "全选域名",
              "aria-checked":
                selectedCount > 0 && !allSelected ? "mixed" : allSelected,
            },
          }}
        />
        <Box className="domain-toolbar-controls">
          <TextField
            select
            size="small"
            className="domain-sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setLimit(100);
            }}
            slotProps={{
              select: { SelectDisplayProps: { "aria-label": "域名排序" } },
            }}
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <IconButton
            className="domain-direction domain-row-action"
            aria-label="切换域名排序方向"
            title={`排序方向：${["默认", "升序", "降序"][directionIndex]}`}
            data-direction={direction}
            onClick={() => {
              setDirectionIndex((index) => (index + 1) % directions.length);
              setLimit(100);
            }}
          >
            <SwapVertRounded className="domain-direction-default" />
            <ArrowUpwardRounded className="domain-direction-arrow" />
          </IconButton>
          <Typography
            className="domain-count"
            variant="caption"
            component="span"
            title="已选域名 / 扫描域名"
            color="text.secondary"
          >
            {selectedCount} / {domainCount}
          </Typography>
        </Box>
      </Box>
      <Divider />
      <Box className="domain-results">
        {list.length === 0 ? (
          <Stack
            sx={{
              height: "100%",
              minHeight: 90,
              px: 2,
              color: "text.secondary",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Box
              sx={{ p: 2, borderRadius: "50%", bgcolor: "action.hover", mb: 2 }}
            >
              <TravelExploreRounded
                sx={{ fontSize: 35, color: "primary.main" }}
              />
            </Box>
            <Typography sx={{ fontWeight: 600 }}>
              {filter ? "没有匹配的域名" : "等待首次发现"}
            </Typography>
          </Stack>
        ) : (
          list.slice(0, limit).map((d) => {
            const exportable = isExportable(d);
            return (
              <Box
                key={d.hostname}
                className="domain-row motion-row"
                sx={{
                  borderBottom: 1,
                  borderColor: "divider",
                  "&:hover, &:focus-within": { bgcolor: "action.hover" },
                }}
              >
                <ButtonBase
                  className="domain-request"
                  aria-label={d.hostname}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                      if (exportable) select(d.hostname, e.shiftKey);
                      return;
                    }
                    p.onRequests(d.hostname);
                  }}
                >
                  <span className="domain-name">{d.hostname}</span>
                  <Stack
                    component="span"
                    direction="row"
                    sx={{ gap: 0.7, alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {d.request_count} 次 · {time(d.first_seen)}
                    </Typography>
                    {d.kind !== "domain" && (
                      <Chip
                        component="span"
                        size="small"
                        label={d.kind.toUpperCase()}
                      />
                    )}
                    {d.kind === "domain" && !exportable && (
                      <Chip
                        component="span"
                        size="small"
                        label="非完整域名，无法导出"
                      />
                    )}
                    {matched.has(d.hostname) && (
                      <Chip
                        component="span"
                        label="规则命中"
                        color="secondary"
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {d.resource_types.join(" · ")}
                  </Typography>
                </ButtonBase>
                <Box className="domain-select">
                  <Checkbox
                    className="domain-row-action"
                    checked={exportable && !p.excluded.has(d.hostname)}
                    disabled={!exportable}
                    onChange={(e) =>
                      select(
                        d.hostname,
                        e.nativeEvent instanceof MouseEvent &&
                          e.nativeEvent.shiftKey,
                      )
                    }
                    slotProps={{
                      input: { "aria-label": `选择 ${d.hostname}` },
                    }}
                  />
                </Box>
                <Tooltip title="复制域名">
                  <IconButton
                    className="domain-copy domain-row-action"
                    aria-label={`复制 ${d.hostname}`}
                    onClick={() =>
                      void copy(d.hostname)
                        .then(() => p.notify("域名已复制"))
                        .catch((e) => p.notify(String(e)))
                    }
                  >
                    <ContentCopyRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })
        )}
        {list.length > limit && (
          <Button fullWidth onClick={() => setLimit((l) => l + 100)}>
            继续显示（剩余 {list.length - limit} 条）
          </Button>
        )}
      </Box>
      <Divider />
      <Box className="domain-footer" sx={{ bgcolor: "action.hover" }}>
        <Button
          variant="contained"
          fullWidth
          startIcon={<DownloadRounded />}
          disabled={!selectedCount || p.syncingResults}
          onClick={p.onExport}
        >
          预览与导出规则
        </Button>
      </Box>
    </Paper>
  );
}
