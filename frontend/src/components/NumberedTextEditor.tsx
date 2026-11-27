import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Box, Button } from "@mui/material";

type EditorRef = RefObject<HTMLTextAreaElement | null>;

export function lineNumberText(start: number, end: number) {
  return Array.from(
    { length: end - start },
    (_, index) => start + index + 1,
  ).join("\n");
}

export function SelectAllTextButton({ editorRef }: { editorRef: EditorRef }) {
  return (
    <Button
      size="small"
      onClick={() => {
        editorRef.current?.focus();
        editorRef.current?.select();
      }}
    >
      全选
    </Button>
  );
}

export default function NumberedTextEditor({
  editorRef,
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  editorRef: EditorRef;
  label: string;
  value: string;
  onChange?: (content: string) => void;
  autoFocus?: boolean;
}) {
  const gutter = useRef<HTMLPreElement>(null);
  const lineCount = useMemo(() => {
    let count = 1;
    for (
      let index = value.indexOf("\n");
      index !== -1;
      index = value.indexOf("\n", index + 1)
    ) {
      count++;
    }
    return count;
  }, [value]);
  const numbers = useMemo(() => lineNumberText(0, lineCount), [lineCount]);
  useLayoutEffect(() => {
    if (gutter.current && editorRef.current) {
      gutter.current.style.transform = `translateY(-${editorRef.current.scrollTop}px)`;
    }
  }, [editorRef, lineCount]);
  return (
    <Box
      className="numbered-editor"
      sx={{ color: "text.primary", bgcolor: "background.default" }}
    >
      <Box
        className="numbered-editor-gutter"
        aria-hidden="true"
        sx={{ borderColor: "divider" }}
      >
        <pre ref={gutter} className="line-number">
          {numbers}
        </pre>
      </Box>
      <textarea
        ref={editorRef}
        className="rule-editor"
        aria-label={label}
        autoFocus={autoFocus}
        wrap="off"
        spellCheck={false}
        readOnly={!onChange}
        value={value}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        onScroll={(event) => {
          if (gutter.current) {
            gutter.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
          }
        }}
      />
    </Box>
  );
}
