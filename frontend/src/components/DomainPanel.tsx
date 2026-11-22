import { useMemo, useState } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ContentCopyRounded,
  DownloadRounded,
  SearchRounded,
  TravelExploreRounded,
} from "@mui/icons-material";
import type { DomainRecord, ScanTask } from "../types";
import { copy } from "../services/api";
import { isExportable, time } from "../utils/format";
import ExportScope from "./ExportScope";
interface Props {
  domains: DomainRecord[];
  task?: ScanTask;
  syncingResults?: boolean;
  excluded: Set<string>;
  toggle: (h: string) => void;
  mode: "observed" | "merged";
  setMode: (m: "observed" | "merged") => void;
  onExport: () => void;
  onRequests: (host: string) => void;
  notify: (s: string) => void;
}
export default function DomainPanel(p: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [limit, setLimit] = useState(100);
  const list = useMemo(
    () =>
      p.domains
        .filter((d) => d.hostname.includes(query.toLowerCase()))
        .sort((a, b) =>
          sort === "count"
            ? b.request_count - a.request_count
            : sort === "time"
              ? a.first_seen.localeCompare(b.first_seen)
              : a.hostname.localeCompare(b.hostname),
        ),
    [p.domains, query, sort],
  );
  const selected = p.domains.filter(
    (d) => isExportable(d) && !p.excluded.has(d.hostname),
  );
  const matched = new Set(
    p.task?.matches.flatMap((m) => m.matched_domains) || [],
  );
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
      <Box sx={{ p: 1.5, pb: 1 }}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Typography variant="h6">观察到的域名</Typography>
          <Chip
            label={`${p.task?.domain_count || 0} 个`}
            color="primary"
            variant="outlined"
          />
        </Stack>

        <Box className="domain-filters">
          <TextField
            placeholder="搜索域名"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(100);
            }}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { "aria-label": "搜索域名" },
            }}
          />
          <TextField
            select
            className="domain-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            slotProps={{
              select: { SelectDisplayProps: { "aria-label": "域名排序" } },
            }}
          >
            <MenuItem value="name">字母顺序</MenuItem>
            <MenuItem value="count">请求次数</MenuItem>
            <MenuItem value="time">发现时间</MenuItem>
          </TextField>
        </Box>
      </Box>
      <Divider />
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
              {query ? "没有匹配的域名" : "等待首次发现"}
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
                  onClick={() => p.onRequests(d.hostname)}
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
                    onChange={() => p.toggle(d.hostname)}
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
        <Box className="domain-export-controls">
          <ExportScope value={p.mode} onChange={p.setMode} />
          <Typography variant="caption" color="text.secondary">
            已选 {selected.length} 个域名
          </Typography>
        </Box>
        <Button
          variant="contained"
          fullWidth
          startIcon={<DownloadRounded />}
          disabled={!selected.length || p.syncingResults}
          onClick={p.onExport}
          sx={{ mt: 0.5 }}
        >
          预览与导出规则
        </Button>
      </Box>
    </Paper>
  );
}
