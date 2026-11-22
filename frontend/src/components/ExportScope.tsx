import { FormControlLabel, Radio, RadioGroup } from "@mui/material";
import type { ExportJob } from "../types";

export default function ExportScope({
  value,
  onChange,
  missingLibrary = false,
}: {
  value: ExportJob["mode"];
  onChange: (mode: ExportJob["mode"]) => void;
  missingLibrary?: boolean;
}) {
  return (
    <RadioGroup
      row
      aria-label="导出范围"
      className="export-scope"
      value={value}
      onChange={(_, mode) => onChange(mode as ExportJob["mode"])}
    >
      <FormControlLabel
        value="observed"
        control={<Radio size="small" />}
        label="仅抓取结果"
      />
      <FormControlLabel
        value="merged"
        data-missing-library={missingLibrary || undefined}
        sx={
          missingLibrary
            ? { borderColor: "error.main", color: "error.main" }
            : undefined
        }
        control={
          <Radio size="small" color={missingLibrary ? "error" : "primary"} />
        }
        label="合并规则库"
      />
    </RadioGroup>
  );
}
