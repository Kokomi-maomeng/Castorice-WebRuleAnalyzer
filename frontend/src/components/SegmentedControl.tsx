import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Box, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";

interface Option<T> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  const name = useId();
  const group = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<{ value: T; pinned: boolean }>();
  const pinned = hint?.pinned;
  useEffect(() => {
    if (!pinned) return;
    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !group.current?.contains(event.target)
      )
        setHint(undefined);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setHint(undefined);
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [pinned]);
  return (
    <Box
      ref={group}
      role="radiogroup"
      aria-label={label}
      className={
        className ? `segmented-control ${className}` : "segmented-control"
      }
      style={
        {
          "--segment-count": options.length,
          "--segment-index": options.findIndex(
            (option) => option.value === value,
          ),
        } as CSSProperties
      }
      sx={(theme) => ({
        borderColor: "divider",
        bgcolor: "action.hover",
        "--segment-active": alpha(
          theme.palette.primary.main,
          theme.palette.mode === "dark" ? 0.23 : 0.15,
        ),
        "--segment-color": theme.palette.primary.main,
        "--segment-hover": theme.palette.action.hover,
        "--segment-disabled": theme.palette.text.disabled,
      })}
    >
      {options.map((option) => {
        const label = (
          <label
            key={option.value}
            className="segmented-option"
            onClick={
              option.hint
                ? () => setHint({ value: option.value, pinned: true })
                : undefined
            }
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={disabled || option.disabled}
              aria-description={option.hint}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        );
        return option.hint ? (
          <Tooltip
            key={option.value}
            title={<span>{option.hint}</span>}
            placement="bottom-start"
            enterDelay={350}
            describeChild
            disableInteractive
            disableTouchListener
            open={hint?.value === option.value}
            onOpen={() =>
              setHint((previous) =>
                previous?.value === option.value
                  ? previous
                  : { value: option.value, pinned: false },
              )
            }
            onClose={() =>
              setHint((previous) =>
                previous?.value === option.value && !previous.pinned
                  ? undefined
                  : previous,
              )
            }
          >
            {label}
          </Tooltip>
        ) : (
          label
        );
      })}
    </Box>
  );
}
