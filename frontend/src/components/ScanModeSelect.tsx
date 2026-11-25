import { useId, useState } from "react";
import { Box, Button, FormControl, Popover, Stack } from "@mui/material";
import { ArrowDropDownRounded } from "@mui/icons-material";
import type { ScanOptions } from "../types";
import { modeNames } from "../utils/format";
import ContextHelp from "./ContextHelp";

type Mode = ScanOptions["mode"];
const descriptions: Record<Mode, string> = {
  quick: "加载一个页面，短暂观察它发出的网络请求，随后自动结束。",
  explore: "从起始页自动访问同源链接，按深度和页数限制采集，不提交表单。",
  interactive:
    "打开受控浏览器，由你在当前标签页中操作。点击停止采集或达到上限时结束。",
};

export default function ScanModeSelect({
  value,
  onChange,
  disabled,
  canShowBrowser,
}: {
  value: Mode;
  onChange: (value: Mode) => void;
  disabled: boolean;
  canShowBrowser: boolean;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <FormControl className="scan-mode">
      <Button
        variant="outlined"
        aria-label={`扫描模式，${modeNames[value]}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-controls={anchor ? id : undefined}
        disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget)}
        endIcon={<ArrowDropDownRounded />}
        sx={{
          "& .MuiButton-endIcon": {
            transform: anchor ? "rotate(180deg)" : "rotate(0deg)",
            transition: (theme) =>
              theme.transitions.create("transform", {
                duration: theme.transitions.duration.shorter,
              }),
          },
          justifyContent: "space-between",
          minHeight: 40,
          borderColor: "divider",
          color: "text.primary",
          whiteSpace: "nowrap",
        }}
      >
        {modeNames[value]}
      </Button>
      <Popover
        id={id}
        open={!!anchor && !disabled}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-label": "扫描模式",
            sx: { p: 0.5, mt: 0.5 },
          },
        }}
      >
        <Stack sx={{ gap: 0.25 }}>
          {(Object.keys(descriptions) as Mode[]).map((mode) => (
            <Box
              key={mode}
              sx={{ display: "flex", gap: 0.25, alignItems: "center" }}
            >
              <ContextHelp label={`${modeNames[mode]}说明`}>
                {mode === "interactive" && !canShowBrowser
                  ? `${descriptions[mode]} 需要服务端图形会话。`
                  : descriptions[mode]}
              </ContextHelp>
              <Button
                aria-pressed={mode === value}
                disabled={mode === "interactive" && !canShowBrowser}
                color={mode === value ? "primary" : "inherit"}
                onClick={() => {
                  onChange(mode);
                  setAnchor(null);
                }}
                sx={{ flex: 1, justifyContent: "flex-start", px: 1.5 }}
              >
                {modeNames[mode]}
              </Button>
            </Box>
          ))}
        </Stack>
      </Popover>
    </FormControl>
  );
}
