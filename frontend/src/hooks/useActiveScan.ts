import { useEffect, useState } from "react";
import type { ScanTask } from "../types";
import { api } from "../services/api";
import { active } from "../utils/format";

export function useActiveScan(viewed?: ScanTask) {
  const [task, setTask] = useState<ScanTask>();
  useEffect(() => {
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const current = await api<ScanTask | null>("/scans/active");
        if (!disposed)
          setTask(current && active(current) ? current : undefined);
      } catch {
        /* Keep the last known active task through temporary disconnections. */
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (viewed)
      setTask((old) =>
        active(viewed) ? viewed : old?.id === viewed.id ? undefined : old,
      );
  }, [viewed]);
  return { activeTask: task, rememberActive: setTask };
}
