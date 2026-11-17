import { useState, type ReactNode } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { HelpOutlineRounded } from "@mui/icons-material";

export default function ContextHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
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
      placement="bottom-start"
      slotProps={{ tooltip: { sx: { fontSize: 12, maxWidth: 340 } } }}
    >
      <IconButton
        size="small"
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
        <HelpOutlineRounded fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
