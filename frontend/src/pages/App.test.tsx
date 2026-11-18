import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { defaultSettings } from "../test-settings";
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
    if (path.startsWith("/scans/history?"))
      return { items: [task], total: 1, finished_count: 1 };
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
  async function openHistory() {
    fireEvent.click(screen.getByRole("button", { name: "扫描历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开" }));
    return screen.findByRole("button", { name: "example.com" });
  }

  it("启动时忽略上一版保存的任务，历史仍可打开", async () => {
    localStorage.setItem("castorice.lastScan", task.id);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "清空工作区" })).toBeEnabled(),
    );
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
    expect(screen.getByText("等待首次发现")).toBeInTheDocument();
    expect(mockAPI).not.toHaveBeenCalledWith("/scans/saved");
    await openHistory();
  });

  it("新地址未启动时明确标识上一任务结果，不把旧结果当作新分析", async () => {
    const original = mockAPI.getMockImplementation()!;
    mockAPI.mockImplementation(
      (path: string, method?: string, ...args: unknown[]) => {
        if (path === "/scans" && method === "POST")
          return Promise.reject(
            Object.assign(new Error("系统解析返回回环地址"), {
              diagnostic: {
                code: "dns_non_public",
                stage: "safety",
                message: "系统解析返回回环地址",
                hint: "请运行网络诊断",
              },
            }),
          );
        return original(path, method, ...args);
      },
    );
    render(<App />);
    await openHistory();
    fireEvent.change(screen.getByRole("textbox", { name: "要分析的网站" }), {
      target: { value: "target.example.net" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始采集" }));
    await screen.findByText(/本次未启动；下方仍显示上一任务/);
    expect(screen.getByText("请运行网络诊断")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "example.com" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/结果来源：/)).not.toBeInTheDocument();
  });

  it("查看历史时仍可停止后台采集任务", async () => {
    const live = { ...task, id: "live", status: "running" };
    const original = mockAPI.getMockImplementation()!;
    mockAPI.mockImplementation((path: string, ...args: unknown[]) =>
      path.startsWith("/scans/history?")
        ? Promise.resolve({ items: [live, task], total: 2, finished_count: 1 })
        : path === "/scans"
          ? Promise.resolve([live, task])
          : path === "/scans/active" || path === "/scans/live"
            ? Promise.resolve(live)
            : original(path, ...args),
    );
    render(<App />);
    await screen.findByRole("button", { name: "停止采集" });
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
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
    await openHistory();
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
    await openHistory();
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
      path === "/scans/active"
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

it("按模式显示有效参数并从高级配置打开网络诊断", async () => {
  render(<App />);
  const advanced = await screen.findByRole("button", { name: "高级配置" });
  await waitFor(() => expect(advanced).toBeEnabled());
  expect(screen.queryByRole("button", { name: "网络诊断" })).toBeNull();
  fireEvent.click(advanced);
  const config = await screen.findByRole("dialog", { name: /高级配置/ });
  const panel = within(config);
  expect(panel.getByLabelText("每页观察 / 秒")).toBeInTheDocument();
  expect(panel.queryByLabelText("探索深度")).toBeNull();
  expect(panel.queryByLabelText("最多页面")).toBeNull();
  fireEvent.click(panel.getByRole("button", { name: "扫描模式，快速扫描" }));
  fireEvent.click(screen.getByRole("button", { name: "自动探索说明" }));
  expect(await screen.findByRole("tooltip")).toHaveTextContent("同源链接");
  fireEvent.click(screen.getByRole("button", { name: "自动探索" }));
  expect(panel.getByLabelText("探索深度")).toBeInTheDocument();
  expect(panel.getByLabelText("最多页面")).toBeInTheDocument();
  const pages = panel.getByLabelText("最多页面");
  fireEvent.change(pages, { target: { value: "" } });
  fireEvent.blur(pages);
  expect(pages).toBeInvalid();
  fireEvent.change(pages, { target: { value: "2" } });
  expect(pages).toBeValid();
  fireEvent.click(panel.getByRole("button", { name: "扫描模式，自动探索" }));
  fireEvent.click(screen.getByRole("button", { name: "辅助交互" }));
  expect(panel.getByLabelText("最多页面")).toBeInTheDocument();
  expect(panel.queryByLabelText("每页观察 / 秒")).toBeNull();
  expect(panel.queryByLabelText("显示受控浏览器")).toBeNull();
  fireEvent.click(panel.getByRole("button", { name: "网络诊断" }));
  await screen.findByRole("dialog", { name: /网络诊断/ });
  fireEvent.click(screen.getByRole("button", { name: "关闭网络诊断" }));
  expect(await screen.findByRole("dialog", { name: /高级配置/ })).toBe(config);
});

it("规则库以设置的子弹窗打开并保留未保存的设置", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "软件设置" }));
  const settings = await screen.findByRole("dialog", { name: /软件设置/ });
  const draft = within(settings).getByLabelText("默认策略组");
  fireEvent.change(draft, { target: { value: "临时草稿" } });
  fireEvent.click(
    within(settings).getByRole("button", { name: "管理 / 更新规则库" }),
  );
  await screen.findByRole("dialog", { name: /开源规则库/ });
  fireEvent.click(screen.getByRole("button", { name: "规则库术语说明" }));
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "include:分类名",
  );
  fireEvent.click(screen.getByRole("button", { name: "规则库设置" }));
  await screen.findByRole("dialog", { name: "规则库设置" });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(await screen.findByRole("button", { name: "关闭规则库" }));
  expect(await screen.findByRole("dialog", { name: /软件设置/ })).toBe(
    settings,
  );
  expect(draft).toHaveValue("临时草稿");
});
