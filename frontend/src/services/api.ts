let token = "";
import type { Diagnostic } from "../types";
let session: Promise<void> | undefined;
type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public diagnostic?: Diagnostic,
  ) {
    super(message);
  }
}
async function authorize() {
  if (!session)
    session = fetch("/api/session", { signal: AbortSignal.timeout(30_000) })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error?.message || "无法连接本地服务");
        token = body.data.token;
      })
      .catch((e) => {
        session = undefined;
        throw e;
      });
  await session;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  if (method !== "GET") await authorize();
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );
  try {
    const response = await fetch("/api" + path, {
      method,
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method === "GET" ? {} : { "X-Castorice-Token": token }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 403) {
        token = "";
        session = undefined;
      }
      throw new APIError(
        result.error?.message || "操作失败",
        response.status,
        result.error?.code || "unknown",
        result.error?.diagnostic,
      );
    }
    return result.data as T;
  } catch (e) {
    if (e instanceof APIError || options.signal?.aborted) throw e;
    if (controller.signal.aborted)
      throw new Error("服务响应超时，请稍后重试。");
    if (e instanceof SyntaxError) throw new Error("服务返回了无法识别的数据。");
    throw new Error("无法连接本地服务，请确认程序仍在运行。");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
export async function download(
  content: string,
  filename: string,
  mime: string,
): Promise<string | undefined> {
  if (window.castoriceDesktop)
    return (
      await api<{ path: string }>("/desktop/export", "POST", {
        filename,
        content,
      })
    ).path;
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copy(content: string) {
  if (!navigator.clipboard)
    throw new Error("剪贴板不可用。可从文本预览手动复制，或保存文件。");
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    throw new Error(
      "浏览器拒绝了剪贴板操作。可从文本预览手动复制，或保存文件。",
    );
  }
}
