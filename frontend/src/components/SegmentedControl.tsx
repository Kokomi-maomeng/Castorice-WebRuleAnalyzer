import { useId, type CSSProperties } from "react";
import { Box } from "@mui/material";
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
  return (
    <Box
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
      {options.map((option) => (
        <label
          key={option.value}
          className="segmented-option"
          title={option.hint}
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
      ))}
    </Box>
  );
}
