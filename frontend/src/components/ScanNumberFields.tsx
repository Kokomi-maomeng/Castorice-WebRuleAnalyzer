import { TextField } from "@mui/material";
import type { ScanOptions } from "../types";

const fields = [
  { key: "max_seconds", label: "总时长 / 秒", min: 1, max: 3600 },
  { key: "navigation_seconds", label: "导航超时 / 秒", min: 1, max: 120 },
  {
    key: "observe_seconds",
    label: "每页观察 / 秒",
    min: 1,
    max: 300,
    modes: ["quick", "explore"],
  },
  {
    key: "quiet_millis",
    label: "静默等待 / 毫秒",
    min: 100,
    max: 30000,
    modes: ["quick", "explore"],
  },
  {
    key: "max_pages",
    label: "最多页面",
    min: 1,
    max: 200,
    modes: ["explore", "interactive"],
  },
  { key: "max_depth", label: "探索深度", min: 0, max: 8, modes: ["explore"] },
  {
    key: "interval_millis",
    label: "页面间隔 / 毫秒",
    min: 0,
    max: 30000,
    modes: ["explore"],
  },
] as const;

function valid(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function invalidScanField(options: ScanOptions) {
  return fields.find(({ key, min, max }) => !valid(options[key], min, max))
    ?.label;
}

export default function ScanNumberFields({
  options,
  change,
  disabled,
}: {
  options: ScanOptions;
  change: (options: ScanOptions) => void;
  disabled?: boolean;
}) {
  return fields.map((field) => {
    const { key, min, max, label } = field;
    const value = options[key];
    const error = !valid(value, min, max);
    if (
      !error &&
      "modes" in field &&
      !field.modes.some((mode) => mode === options.mode)
    )
      return null;
    return (
      <TextField
        key={key}
        label={label}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) =>
          change({
            ...options,
            [key]: e.target.value === "" ? NaN : Number(e.target.value),
          })
        }
        slotProps={{ htmlInput: { min, max, step: 1 } }}
        helperText={`${min}–${max}`}
        error={error}
        disabled={disabled}
        fullWidth
      />
    );
  });
}
