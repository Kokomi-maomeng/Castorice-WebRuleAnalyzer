import { useState } from "react";
import { Alert, Box, Button, Collapse, Typography } from "@mui/material";
import type { Diagnostic } from "../types";

export default function DiagnosticAlert({
  diagnostic,
  severity = "error",
}: {
  diagnostic: Diagnostic;
  severity?: "error" | "warning" | "info";
}) {
  const [details, setDetails] = useState(false);
  return (
    <Alert severity={severity} className="motion-panel" sx={{ mb: 1 }}>
      <Typography variant="body2">{diagnostic.message}</Typography>
      {diagnostic.hint && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {diagnostic.hint}
        </Typography>
      )}
      {diagnostic.detail || diagnostic.addresses?.length || diagnostic.host ? (
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
              {[
                `阶段：${
                  (
                    {
                      input: "地址输入",
                      browser: "采集浏览器",
                      storage: "保存结果",
                      dns: "DNS 解析",
                      safety: "地址安全检查",
                      proxy: "代理连接",
                      connection: "网络连接",
                      tls: "HTTPS",
                      http: "网站响应",
                      navigation: "页面加载",
                      scan: "扫描任务",
                      application: "应用",
                    } as Record<string, string>
                  )[diagnostic.stage] || diagnostic.stage
                }`,
                diagnostic.host && `目标：${diagnostic.host}`,
                diagnostic.addresses?.length &&
                  `解析地址：${diagnostic.addresses.join("、")}`,
                diagnostic.detail,
                `诊断代码：${diagnostic.code}`,
              ]
                .filter(Boolean)
                .join("\n")}
            </Box>
          </Collapse>
        </>
      ) : null}
    </Alert>
  );
}
