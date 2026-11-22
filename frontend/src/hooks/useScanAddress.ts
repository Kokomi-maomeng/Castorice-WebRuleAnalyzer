import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { ScanTarget } from "../types";
import { scanAddressIssue } from "../utils/scanAddress";

export function useScanAddress() {
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<ScanTarget>();
  const [issue, setIssue] = useState("");
  const [notice, setNotice] = useState("");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{
    value: string;
    controller: AbortController;
    result: Promise<ScanTarget | undefined>;
  } | null>(null);

  useEffect(
    () => () => {
      pending.current?.controller.abort();
      clearTimeout(timeout.current);
    },
    [],
  );

  function edit(nextValue: string, saved?: ScanTarget) {
    pending.current?.controller.abort();
    pending.current = null;
    clearTimeout(timeout.current);
    setValue(nextValue);
    setTarget(saved);
    setIssue("");
    setNotice("");
  }

  function prepare(raw: string, freshlyEdited = false) {
    if (!raw.trim()) return Promise.resolve(undefined);
    if (pending.current?.value === raw) return pending.current.result;
    if (!freshlyEdited && target?.host === raw) return Promise.resolve(target);
    pending.current?.controller.abort();
    const controller = new AbortController();
    const result = api<ScanTarget>(
      "/scans/target",
      "POST",
      { url: raw },
      {
        signal: controller.signal,
      },
    )
      .then((prepared) => {
        if (controller.signal.aborted) return;
        setTarget(prepared);
        setValue(prepared.host);
        setIssue("");
        const removed = [
          prepared.removed_prefix && "前缀",
          prepared.removed_suffix && "路径或参数",
        ].filter(Boolean);
        if (removed.length) {
          clearTimeout(timeout.current);
          setNotice(`已自动清除${removed.join("、")}`);
          timeout.current = setTimeout(() => setNotice(""), 3000);
        }
        return prepared;
      })
      .catch((error) => {
        if (!controller.signal.aborted) setIssue(scanAddressIssue(error));
        return undefined;
      })
      .finally(() => {
        if (pending.current?.controller === controller) pending.current = null;
      });
    pending.current = { value: raw, controller, result };
    return result;
  }

  return { value, target, issue, notice, edit, prepare, setIssue };
}
