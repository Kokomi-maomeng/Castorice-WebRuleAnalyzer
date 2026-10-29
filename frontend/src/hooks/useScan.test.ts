import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScan } from "./useScan";
import type { RequestFilter } from "../types";
const { mockAPI } = vi.hoisted(() => ({ mockAPI: vi.fn() }));
vi.mock("../services/api", () => ({ api: mockAPI }));
class FakeEventSource {
  static OPEN = 1;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen?: () => void;
  onerror?: () => void;
  listener?: (event: { data: string }) => void;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(_name: string, fn: (event: { data: string }) => void) {
    this.listener = fn;
  }
  close = vi.fn();
  emit(id: string) {
    this.listener?.({ data: JSON.stringify({ id, status: "running" }) });
  }
}
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  mockAPI.mockImplementation(async (path: string) =>
    path.includes("/requests?")
      ? { items: [], total: 0 }
      : /\/scans\/[^/]+$/.test(path)
        ? { id: path.split("/").at(-1), status: "running" }
        : [],
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("实时任务隔离", () => {
  it("切换历史任务后关闭旧连接，忽略迟到的旧任务事件", async () => {
    const filter: RequestFilter = {
      host: "",
      method: "",
      type: "",
      status: "",
      page: 0,
    };
    const { result, rerender } = renderHook(({ id }) => useScan(id, filter), {
      initialProps: { id: "one" },
    });
    await waitFor(() => expect(result.current.task?.id).toBe("one"));
    const old = FakeEventSource.instances[0];
    rerender({ id: "two" });
    await waitFor(() => expect(result.current.task?.id).toBe("two"));
    act(() => old.emit("one"));
    expect(result.current.task?.id).toBe("two");
    expect(old.close).toHaveBeenCalledOnce();
    act(() => FakeEventSource.instances[1].emit("two"));
    expect(result.current.task?.id).toBe("two");
  });
  it("实时断开时展示可恢复的连接状态", async () => {
    const filter: RequestFilter = {
      host: "example.com",
      method: "POST",
      type: "Fetch",
      status: "2",
      page: 1,
    };
    const { result } = renderHook(() => useScan("one", filter));
    await waitFor(() => expect(result.current.task?.id).toBe("one"));
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(result.current.connection).toContain("自动重连");
    expect(
      mockAPI.mock.calls.some(
        ([path]) => path.includes("offset=50") && path.includes("method=POST"),
      ),
    ).toBe(true);
  });
  it("清空任务后请求总数归零，迟到请求不能恢复旧计数", async () => {
    let resolveLate: ((value: unknown) => void) | undefined;
    const original = mockAPI.getMockImplementation()!;
    let requests = 0;
    mockAPI.mockImplementation((path: string) =>
      path.includes("/requests?")
        ? ++requests === 1
          ? Promise.resolve({ items: [], total: 57 })
          : new Promise((resolve) => {
              resolveLate = resolve;
            })
        : original(path),
    );
    const filter: RequestFilter = {
      host: "",
      method: "",
      type: "",
      status: "",
      page: 0,
    };
    const { result, rerender } = renderHook(({ id }) => useScan(id, filter), {
      initialProps: { id: "one" },
    });
    await waitFor(() => expect(resolveLate).toBeDefined());
    rerender({ id: "" });
    expect(result.current.total).toBe(0);
    await act(async () => resolveLate!({ items: [], total: 57 }));
    expect(result.current.total).toBe(0);
    expect(result.current.task).toBeUndefined();
    expect(result.current.domains).toEqual([]);
  });
});
