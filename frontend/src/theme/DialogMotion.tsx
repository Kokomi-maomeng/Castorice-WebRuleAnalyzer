import { Fade } from "@mui/material";
import type { ComponentProps } from "react";

export default function DialogMotion({
  onEnter,
  onExit,
  ...props
}: ComponentProps<typeof Fade>) {
  return (
    <Fade
      {...props}
      onEnter={(node, appearing) => {
        node.dataset.dialogMotion = "enter";
        onEnter?.(node, appearing);
      }}
      onExit={(node) => {
        node.dataset.dialogMotion = "exit";
        onExit?.(node);
      }}
    />
  );
}
