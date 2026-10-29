let token = "";
let session: Promise<void> | undefined;
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
async function authorize() {
  if (!session)
    session = fetch("/api/session")
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
): Promise<T> {
  if (method !== "GET") await authorize();
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method === "GET" ? {} : { "X-Castorice-Token": token }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("无法连接本地服务，请确认程序仍在运行。");
  }
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
    );
  }
  return result.data as T;
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
    throw new Error("当前浏览器不支持剪贴板，请使用文件下载。");
  await navigator.clipboard.writeText(content);
}
