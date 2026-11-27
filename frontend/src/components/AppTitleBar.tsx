import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CloseRounded,
  CropSquareRounded,
  AddRounded,
  HistoryRounded,
  HubRounded,
  MenuBookRounded,
  MinimizeRounded,
  NetworkCheckRounded,
  RemoveRounded,
  SettingsRounded,
  FilterNoneRounded,
} from "@mui/icons-material";
import { APP_VERSION } from "../version";

export default function AppTitleBar({
  zoom,
  minZoom,
  maxZoom,
  onZoom,
  onLibrary,
  onHistory,
  onNetwork,
  onSettings,
}: {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoom: (action: "in" | "out" | "reset") => void;
  onLibrary: () => void;
  onHistory: () => void;
  onNetwork: () => void;
  onSettings: () => void;
}) {
  const desktop = window.castoriceWindow;
  const [maximized, setMaximized] = useState(() => desktop?.maximized || false);
  const press = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!desktop) return;
    function changed(event: Event) {
      setMaximized((event as CustomEvent<boolean>).detail);
    }
    window.addEventListener("castorice-window-state", changed);
    return () => window.removeEventListener("castorice-window-state", changed);
  }, [desktop]);
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = press.current;
    if (!start || !(event.buttons & 1)) {
      press.current = null;
      return;
    }
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) {
      press.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      desktop?.command("move");
    }
  }
  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Toolbar
        disableGutters
        className={desktop ? "app-titlebar desktop-titlebar" : "app-titlebar"}
      >
        <Box
          className="titlebar-brand"
          data-window-drag={desktop ? "" : undefined}
          onPointerDown={(event) => {
            if (desktop && event.button === 0 && event.isPrimary) {
              press.current = { x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }
          }}
          onPointerMove={move}
          onPointerUp={() => {
            press.current = null;
          }}
          onPointerCancel={() => {
            press.current = null;
          }}
          onDoubleClick={() => desktop?.command("toggle-maximize")}
        >
          <HubRounded color="primary" fontSize="small" />
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 700 }}>
            <Box component="span" className="brand-full">
              Castorice-WebRuleAnalyzer
            </Box>
            <Box component="span" className="brand-short">
              Web规则分析器
            </Box>
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ ml: 0.75 }}
            >
              {APP_VERSION}
            </Typography>
          </Typography>
        </Box>
        <Box className="titlebar-zoom" role="group" aria-label="界面缩放">
          <IconButton
            size="small"
            aria-label="缩小"
            disabled={zoom === minZoom}
            onClick={() => onZoom("out")}
          >
            <RemoveRounded fontSize="small" />
          </IconButton>
          <Button
            className="titlebar-zoom-value"
            size="small"
            color="inherit"
            aria-label={`缩放 ${zoom}%，恢复默认缩放`}
            onClick={() => onZoom("reset")}
          >
            {zoom}%
          </Button>
          <IconButton
            size="small"
            aria-label="放大"
            disabled={zoom === maxZoom}
            onClick={() => onZoom("in")}
          >
            <AddRounded fontSize="small" />
          </IconButton>
        </Box>
        <Box className="titlebar-tools" role="group" aria-label="软件功能">
          <Tooltip title="开源规则库">
            <IconButton aria-label="开源规则库" onClick={onLibrary}>
              <MenuBookRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title="扫描历史">
            <IconButton aria-label="扫描历史" onClick={onHistory}>
              <HistoryRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title="网络诊断">
            <IconButton aria-label="网络诊断" onClick={onNetwork}>
              <NetworkCheckRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title="软件设置">
            <IconButton aria-label="软件设置" onClick={onSettings}>
              <SettingsRounded />
            </IconButton>
          </Tooltip>
        </Box>
        {desktop && (
          <Box className="window-buttons" sx={{ borderColor: "divider" }}>
            <IconButton
              title="最小化"
              aria-label="最小化"
              onClick={() => desktop.command("minimize")}
            >
              <MinimizeRounded
                sx={{ fontSize: 17, transform: "translateY(-3px)" }}
              />
            </IconButton>
            <IconButton
              title={maximized ? "还原" : "最大化"}
              aria-label={maximized ? "还原" : "最大化"}
              onClick={() => desktop.command("toggle-maximize")}
            >
              {maximized ? (
                <FilterNoneRounded sx={{ fontSize: 14 }} />
              ) : (
                <CropSquareRounded sx={{ fontSize: 18 }} />
              )}
            </IconButton>
            <IconButton
              className="window-close"
              title="关闭窗口"
              aria-label="关闭窗口"
              onClick={() => desktop.command("close")}
            >
              <CloseRounded sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
}
