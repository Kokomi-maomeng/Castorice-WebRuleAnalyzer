import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { DomainRecord, NetworkRequest, RequestFilter, ScanTask, TaskEvent } from '../types';
import { errorMessage } from '../utils/format';

export function useScan(id: string, filter: RequestFilter) {
 const [task, setTask] = useState<ScanTask>(); const [domains, setDomains] = useState<DomainRecord[]>([]); const [requests, setRequests] = useState<NetworkRequest[]>([]); const [total, setTotal] = useState(0); const [logs, setLogs] = useState<TaskEvent[]>([]); const [connection, setConnection] = useState('');
 const cursor = useRef(0); const generation = useRef(0); const busy = useRef(false); const requestGeneration = useRef(0);
 const refresh = useCallback(async () => {
  if (!id || busy.current) return; busy.current = true; const g = generation.current;
  try { const [d, l] = await Promise.all([api<DomainRecord[]>(`/scans/${id}/domains`), api<TaskEvent[]>(`/scans/${id}/logs?after=${cursor.current}`)]); if (g !== generation.current) return; setDomains(d); if (l.length) { cursor.current = l[l.length - 1].id; setLogs(old => [...old, ...l].slice(-2000)); } }
  catch (e) { if (g === generation.current) setConnection(errorMessage(e)); }
  finally { if (g === generation.current) busy.current = false; }
 }, [id]);
 const refreshRequests = useCallback(async () => {
  if (!id) return; const rg = ++requestGeneration.current; const g = generation.current;
  const query = new URLSearchParams({ host: filter.host, method: filter.method, type: filter.type, status: filter.status, offset: String(filter.page * 50), limit: '50' });
  try { const result = await api<{items: NetworkRequest[]; total: number}>(`/scans/${id}/requests?${query}`); if (g === generation.current && rg === requestGeneration.current) { setRequests(result.items); setTotal(result.total); } } catch (e) { if (g === generation.current) setConnection(errorMessage(e)); }
 }, [id, filter.host, filter.method, filter.type, filter.status, filter.page]);
 const callbacks = useRef({ refresh, refreshRequests }); callbacks.current = { refresh, refreshRequests };
 useEffect(() => { void refreshRequests(); }, [refreshRequests]);
 useEffect(() => {
  generation.current++; busy.current = false; cursor.current = 0; setLogs([]); setDomains([]); setRequests([]); setTotal(0); setTask(undefined); setConnection(''); if (!id) return;
  const current = generation.current;
  const load = async () => { try { const t = await api<ScanTask>(`/scans/${id}`); if (generation.current === current) setTask(t); } catch (e) { if (generation.current === current) setConnection(errorMessage(e)); } };
  void load(); void callbacks.current.refresh(); void callbacks.current.refreshRequests();
  const source = new EventSource(`/api/scans/${id}/events`);
  source.addEventListener('update', (event) => { if (generation.current !== current) return; setTask(JSON.parse((event as MessageEvent).data)); setConnection(''); void callbacks.current.refresh(); void callbacks.current.refreshRequests(); });
  source.onopen = () => { if (generation.current === current) setConnection(''); };
  source.onerror = () => { if (generation.current === current) setConnection('实时连接中断，正在自动重连；每 3 秒补取任务状态。'); };
  const fallback = setInterval(() => { if (source.readyState !== EventSource.OPEN) { void load(); void callbacks.current.refresh(); void callbacks.current.refreshRequests(); } }, 3000);
  return () => { generation.current++; source.close(); clearInterval(fallback); };
 }, [id]);
 return { task, setTask, domains, requests, total, logs, connection, refresh, refreshRequests };
}
