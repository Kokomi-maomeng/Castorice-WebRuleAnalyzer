import { useState, type ReactNode } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { InfoOutlined } from "@mui/icons-material";
import { tipText } from "../utils/format";

export default function ContextHelp({
  label,
  children,
  error = false,
  warning = false,
  className,
  alignEnd = error,
}: {
  label: string;
  children: ReactNode;
  error?: boolean;
  warning?: boolean;
  className?: string;
  alignEnd?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  function close() {
    setPinned(false);
    setOpen(false);
  }
  return (
    <Tooltip
      title={typeof children === "string" ? tipText(children) : children}
      describeChild
      disableInteractive
      open={open || pinned}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      placement={alignEnd ? "bottom-end" : "bottom-start"}
      slotProps={{
        tooltip: {
          sx: { fontSize: 12, maxWidth: 340, whiteSpace: "pre-line" },
        },
      }}
    >
      <IconButton
        size="small"
        type="button"
        className={className}
        color={error ? "error" : warning ? "warning" : "default"}
        aria-label={label}
        aria-pressed={pinned}
        onClick={() => (pinned ? close() : setPinned(true))}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === "Escape" && (open || pinned)) {
            e.stopPropagation();
            close();
          }
        }}
      >
        <InfoOutlined fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
