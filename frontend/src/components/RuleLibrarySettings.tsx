import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Link,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { DeleteOutlineRounded, RefreshRounded } from "@mui/icons-material";
import type { RuleSource } from "../types";
import { date, tipText } from "../utils/format";

export type RuleSourceOperation = "sync" | "check" | "auto";

const sourceStatuses: Record<string, string> = {
  not_initialized: "未下载",
  syncing: "正在更新",
  ready: "本地可用",
  error: "更新失败",
  cached: "使用旧缓存",
  cache_invalid: "需重新更新",
};

export default function RuleLibrarySettings({
  id,
  sources,
  busy,
  onSourceAction,
  onClear,
}: {
  id: string;
  sources: RuleSource[];
  busy: string;
  onSourceAction: (
    source: string,
    operation: RuleSourceOperation,
    enabled?: boolean,
  ) => void;
  onClear: () => void;
}) {
  const disabled =
    !!busy || sources.some((source) => source.status === "syncing");
  return (
    <Box
      component="aside"
      id={id}
      className="library-settings scroll-region"
      tabIndex={0}
      aria-labelledby={`${id}-title`}
      sx={{ borderColor: "divider", bgcolor: "background.paper" }}
    >
      <Typography
        variant="subtitle1"
        id={`${id}-title`}
        sx={{ fontWeight: 650 }}
      >
        规则库设置
      </Typography>
      <Typography variant="body2" color="text.secondary">
        开启自动更新会立即下载，之后每天检查更新。失败时保留已有规则。下载使用服务端的系统网络和代理设置
      </Typography>
      {sources.map((source) => (
        <Stack
          key={source.id}
          className="library-source"
          sx={{ borderColor: "divider" }}
        >
          <Stack direction="row" className="library-source-heading">
            <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
              {source.name}
            </Typography>
            <Chip
              size="small"
              label={sourceStatuses[source.status] || source.status}
              color={source.status === "ready" ? "success" : "default"}
              variant="outlined"
            />
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={source.auto_update || false}
                disabled={disabled}
                onChange={(_, checked) =>
                  onSourceAction(source.id, "auto", checked)
                }
              />
            }
            label="自动更新到本地"
          />
          <Typography variant="caption" color="text.secondary">
            {source.loaded_count} / {source.category_count} 分类 · 更新于{" "}
            {date(source.updated_at)} · {source.version.slice(0, 8) || "—"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            检查于 {date(source.checked_at)}
            {source.remote_version &&
              (source.remote_version === source.version
                ? " · 已是当前上游版本"
                : " · 有新版本可下载")}
          </Typography>
          {source.error && (
            <Alert severity="warning" sx={{ my: 1 }}>
              {tipText(source.error)}
            </Alert>
          )}
          <Stack direction="row" className="library-source-actions">
            <Button
              size="small"
              disabled={disabled}
              startIcon={
                busy === source.id || source.status === "syncing" ? (
                  <CircularProgress size={14} />
                ) : (
                  <RefreshRounded />
                )
              }
              onClick={() => onSourceAction(source.id, "sync")}
            >
              {source.version ? "立即更新" : "下载规则库"}
            </Button>
            <Button
              size="small"
              disabled={disabled}
              onClick={() => onSourceAction(source.id, "check")}
            >
              检查更新
            </Button>
            <Link
              variant="caption"
              href={source.repository}
              target="_blank"
              rel="noreferrer"
            >
              上游 · {source.license}
            </Link>
          </Stack>
        </Stack>
      ))}
      <Button
        sx={{ alignSelf: "start" }}
        color="error"
        disabled={disabled || !sources.length}
        startIcon={<DeleteOutlineRounded />}
        onClick={onClear}
      >
        清理规则库
      </Button>
    </Box>
  );
}
