import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { defaultSettings } from "../utils/format";
import type { ScanTask } from "../types";
const { mockAPI } = vi.hoisted(() => ({ mockAPI: vi.fn() }));
vi.mock("../services/api", () => ({ api: mockAPI, copy: vi.fn() }));
const task: ScanTask = {
  id: "saved",
  target_url: "https://example.com",
  status: "completed",
  options: defaultSettings.scan,
  started_at: "2026-10-27T00:00:00Z",
  request_count: 57,
  domain_count: 1,
  ip_count: 0,
  pages: [],
  matches: [],
};
class FakeEventSource {
  static OPEN = 1;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen?: () => void;
  onerror?: () => void;
  listener?: (event: { data: string }) => void;
  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener(_name: string, fn: (event: { data: string }) => void) {
    this.listener = fn;
  }
  close = vi.fn();
}
beforeEach(() => {
  localStorage.clear();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  mockAPI.mockImplementation(async (path: string) => {
    if (path === "/settings") return defaultSettings;
    if (path === "/health") return { visible_browser: true };
    if (path === "/scans") return [task];
    if (path === "/scans/saved") return task;
    if (path.endsWith("/domains"))
      return [
        {
          hostname: "example.com",
          kind: "domain",
          first_seen: task.started_at,
          request_count: 57,
          resource_types: ["Document"],
          request_ids: [],
          source: "browser-observed",
        },
      ];
    if (path.includes("/requests?")) return { items: [], total: 57 };
    return [];
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("清空工作区", () => {
  it("查看历史时仍可停止后台采集任务", async () => {
    const live = { ...task, id: "live", status: "running" };
    const original = mockAPI.getMockImplementation()!;
    mockAPI.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/scans"
        ? Promise.resolve([live, task])
        : path === "/scans/active" || path === "/scans/live"
          ? Promise.resolve(live)
          : original(path, ...args),
    );
    render(<App />);
    await screen.findByRole("button", { name: "停止采集" });
    fireEvent.click(screen.getByRole("button", { name: "扫描历史" }));
    const buttons = await screen.findAllByRole("button", { name: "打开" });
    fireEvent.click(buttons[1]);
    await screen.findByRole("button", { name: "返回正在采集" });
    expect(screen.getByRole("button", { name: "清空工作区" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "停止采集" }));
    await waitFor(() =>
      expect(mockAPI).toHaveBeenCalledWith("/scans/live/stop", "POST"),
    );
  });
  it("清空结果、计数与筛选，忽略旧事件，刷新后仍为空且可打开保留的历史", async () => {
    const view = render(<App />);
    await screen.findByRole("button", { name: "example.com" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索域名" }), {
      target: { value: "missing" },
    });
    const old = FakeEventSource.instances.at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "清空工作区" }));
    await screen.findByText("等待首次发现");
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
    expect(screen.getByRole("textbox", { name: "搜索域名" })).toHaveValue("");
    expect(screen.getByRole("tab", { name: "网络请求" })).toBeInTheDocument();
    expect(old.close).toHaveBeenCalledOnce();
    old.listener?.({ data: JSON.stringify(task) });
    expect(
      screen.getByRole("button", { name: "预览与导出规则" }),
    ).toBeDisabled();
    expect(localStorage.getItem("castorice.lastScan")).toBe("");
    view.unmount();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "清空工作区" })).toBeEnabled(),
    );
    expect(screen.getByText("等待首次发现")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "扫描历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开" }));
    await screen.findByRole("button", { name: "example.com" });
    expect(
      mockAPI.mock.calls.every(([, method]) => !method || method === "GET"),
    ).toBe(true);
  });
  it("清空输入框回车同样恢复初始页面", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "example.com" });
    const input = screen.getByRole("textbox", { name: "要分析的网站" });
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("等待首次发现");
    expect(input).toHaveValue("");
  });
  it("采集中禁止清空，以免丢失停止入口", async () => {
    const running = { ...task, status: "running" };
    const original = mockAPI.getMockImplementation()!;
    mockAPI.mockImplementation((path: string, ...args: unknown[]) =>
      path === "/scans"
        ? Promise.resolve([running])
        : path === "/scans/saved"
          ? Promise.resolve(running)
          : original(path, ...args),
    );
    render(<App />);
    await screen.findByRole("button", { name: "停止采集" });
    expect(screen.getByRole("button", { name: "清空工作区" })).toBeDisabled();
  });
  it("已经处于空工作区时再次清空，也会重置新输入的面板搜索", async () => {
    localStorage.setItem("castorice.lastScan", "");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "清空工作区" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "搜索域名" }), {
      target: { value: "temporary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "清空工作区" }));
    expect(screen.getByRole("textbox", { name: "搜索域名" })).toHaveValue("");
    expect(screen.getByText("等待首次发现")).toBeInTheDocument();
  });
});
