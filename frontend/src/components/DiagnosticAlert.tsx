import { useState } from "react";
import { Alert, Box, Button, Collapse, Typography } from "@mui/material";
import type { Diagnostic } from "../types";
import { diagnosticDetails, tipText } from "../utils/format";

export default function DiagnosticAlert({
  diagnostic,
  severity = "error",
}: {
  diagnostic: Diagnostic;
  severity?: "error" | "warning" | "info";
}) {
  const [details, setDetails] = useState(false);
  const technical = diagnosticDetails(diagnostic);
  return (
    <Alert severity={severity} className="motion-panel" sx={{ mb: 1 }}>
      <Typography variant="body2">{tipText(diagnostic.message)}</Typography>
      {diagnostic.hint && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {tipText(diagnostic.hint)}
        </Typography>
      )}
      {technical && (
        <>
          <Button
            size="small"
            color="inherit"
            onClick={() => setDetails((v) => !v)}
            aria-expanded={details}
          >
            {details ? "收起诊断详情" : "查看诊断详情"}
          </Button>
          <Collapse in={details}>
            <Box
              component="pre"
              sx={{ fontSize: 12, mt: 0.5, overflowWrap: "anywhere" }}
            >
              {technical}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}
