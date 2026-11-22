import { useState, type ReactNode } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { ErrorOutlineRounded, HelpOutlineRounded } from "@mui/icons-material";

export default function ContextHelp({
  label,
  children,
  error = false,
}: {
  label: string;
  children: ReactNode;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  function close() {
    setPinned(false);
    setOpen(false);
  }
  return (
    <Tooltip
      title={children}
      describeChild
      disableInteractive
      open={open || pinned}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      placement={error ? "bottom-end" : "bottom-start"}
      arrow={error}
      slotProps={{
        tooltip: { sx: { fontSize: error ? 13 : 12, maxWidth: 340 } },
      }}
    >
      <IconButton
        size="small"
        type="button"
        color={error ? "error" : "default"}
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
        {error ? (
          <ErrorOutlineRounded fontSize="small" />
        ) : (
          <HelpOutlineRounded fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
}
