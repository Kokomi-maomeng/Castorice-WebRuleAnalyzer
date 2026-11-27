import { useEffect, useRef, useState } from "react";
import { api, APIError } from "../services/api";
import type {
  DomainRecord,
  NetworkRequest,
  RequestFilter,
  ScanTask,
  TaskEvent,
} from "../types";
import { active, errorMessage } from "../utils/format";

export function useScan(id: string, filter: RequestFilter) {
  const [task, setTask] = useState<ScanTask>();
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [requests, setRequests] = useState<NetworkRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<TaskEvent[]>([]);
  const [connection, setConnection] = useState("");
  const [syncingResults, setSyncingResults] = useState(false);
  const query = new URLSearchParams({
    host: filter.host,
    exact_host: String(!!filter.exactHost),
    method: filter.method,
    type: filter.type,
    status: filter.status,
    offset: String(filter.page * 50),
    limit: "50",
  }).toString();
  const latestQuery = useRef(query);
  latestQuery.current = query;
  const filterChanged = useRef<() => void>(undefined);

  useEffect(() => {
    setLogs([]);
    setDomains([]);
    setRequests([]);
    setTotal(0);
    setTask(undefined);
    setConnection("");
    setSyncingResults(false);
    if (!id) return;

    const controller = new AbortController();
    const { signal } = controller;
    const get = <T>(path: string) => api<T>(path, "GET", undefined, { signal });
    const endpoint = `/scans/${id}`;
    const stream = new EventSource(`/api${endpoint}/events`);
    let cursor = 0;
    let terminal = false;
    let settled = false;
    let retry = false;
    let closed = false;
    let busy = false;
    let queued = false;
    let loadingStatus = false;
    let statusRevision = 0;
    let fetchedQuery = "";

    function closeStream() {
      if (!closed) {
        closed = true;
        stream.close();
      }
    }

    async function refresh() {
      if (signal.aborted || busy || !queued) return;
      busy = true;
      queued = false;
      const afterEnd = terminal;
      const requestQuery = latestQuery.current;
      fetchedQuery = requestQuery;
      try {
        const rows = get<{ items: NetworkRequest[]; total: number }>(
          `${endpoint}/requests?${requestQuery}`,
        );
        const [d, l, result] = await Promise.all([
          settled ? undefined : get<DomainRecord[]>(`${endpoint}/domains`),
          settled
            ? undefined
            : get<TaskEvent[]>(`${endpoint}/logs?after=${cursor}`),
          rows,
        ]);
        if (signal.aborted) return;
        if (d) setDomains(d);
        if (l?.length) {
          cursor = l[l.length - 1].id;
          setLogs((old) => [...old, ...l].slice(-2000));
        }
        if (requestQuery === latestQuery.current) {
          setRequests(result.items);
          setTotal(result.total);
          if (afterEnd) {
            settled = true;
            closeStream();
            setSyncingResults(false);
          }
        }
        retry = false;
        setConnection("");
      } catch (e) {
        if (!signal.aborted) {
          retry = true;
          setConnection(errorMessage(e));
        }
      } finally {
        busy = false;
        if (queued) void refresh();
      }
    }

    function requestRefresh() {
      queued = true;
      void refresh();
    }

    function update(t: ScanTask) {
      if (signal.aborted || terminal) return;
      statusRevision++;
      terminal = !active(t);
      setTask(t);
      setSyncingResults(terminal);
      requestRefresh();
    }

    async function loadStatus() {
      if (loadingStatus || terminal) return;
      loadingStatus = true;
      const revision = statusRevision;
      try {
        const t = await get<ScanTask>(endpoint);
        if (revision === statusRevision) update(t);
      } catch (e) {
        if (!signal.aborted) {
          setConnection(errorMessage(e));
          if (e instanceof APIError && e.status === 404) {
            terminal = true;
            settled = true;
            closeStream();
          }
        }
      } finally {
        loadingStatus = false;
      }
    }

    stream.addEventListener("update", (event) => {
      update(JSON.parse((event as MessageEvent).data) as ScanTask);
    });
    stream.onerror = () => {
      if (!signal.aborted && !terminal)
        setConnection("实时连接中断，正在自动重连并补取任务状态");
    };
    void loadStatus();
    filterChanged.current = () => {
      if (fetchedQuery && latestQuery.current !== fetchedQuery)
        requestRefresh();
    };
    const fallback = setInterval(() => {
      if (stream.readyState !== EventSource.OPEN) void loadStatus();
      if (retry) requestRefresh();
    }, 3000);
    return () => {
      controller.abort();
      closeStream();
      clearInterval(fallback);
      filterChanged.current = undefined;
    };
  }, [id]);

  useEffect(() => {
    filterChanged.current?.();
  }, [query]);

  return {
    task,
    setTask,
    domains,
    requests,
    total,
    logs,
    connection,
    syncingResults,
  };
}
