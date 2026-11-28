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
import { APIError } from "../services/api";
import type { ScanTask } from "../types";
const { mockAPI } = vi.hoisted(() => ({ mockAPI: vi.fn() }));
vi.mock("../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api")>()),
  api: mockAPI,
  copy: vi.fn(),
}));
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
  mockAPI.mockImplementation(
    async (path: string, method?: string, body?: { url: string }) => {
      if (path === "/settings")
        return method === "PUT" ? body : defaultSettings;
      if (path === "/health") return { visible_browser: true };
      if (path === "/scans/target" && body) {
        const input = new URL(
          /^https?:\/\//.test(body.url) ? body.url : "https://" + body.url,
        );
        return {
          host: input.hostname,
          url: input.origin + "/",
          removed_prefix: /^https?:\/\//.test(body.url),
          removed_suffix:
            input.pathname !== "/" || !!input.search || !!input.hash,
        };
      }
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
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("重置工作区", () => {
  it("打开历史和重置工作区均保留下次采集的设置", async () => {
    render(<App />);
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "软件设置" }));
    const dialog = await screen.findByRole("dialog", { name: "软件设置" });
    const modes = within(dialog).getByRole("tablist");
    expect(within(modes).getAllByRole("tab")).toHaveLength(3);
    expect(
      within(dialog).getByRole("spinbutton", { name: "每页观察 / 秒" }),
    ).toBeInTheDocument();
    fireEvent.click(within(modes).getByRole("tab", { name: "深度" }));
    expect(
      within(dialog).getByRole("spinbutton", { name: "探索深度" }),
    ).toBeInTheDocument();
    fireEvent.click(within(modes).getByRole("tab", { name: "自行交互" }));
    expect(
      within(dialog).queryByRole("spinbutton", { name: "每页观察 / 秒" }),
    ).toBeNull();
    fireEvent.change(
      within(dialog).getByRole("spinbutton", { name: "总时长 / 秒" }),
      {
        target: { value: 200 },
      },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const summary = await screen.findByText(/下次 · 自行交互 · 200s 上限/);
    expect(summary).toHaveAttribute(
      "title",
      expect.stringContaining(
        `本次 · 快速 · ${task.options.max_seconds}s 上限`,
      ),
    );
    await openHistory();
    expect(summary).toHaveTextContent(/下次 · 自行交互 · 200s 上限/);
    fireEvent.change(screen.getByRole("textbox", { name: "要分析的网站" }), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重置工作区" }));
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
    expect(screen.getByRole("radio", { name: "自行交互" })).toBeChecked();
    expect(summary).toHaveTextContent(/下次 · 自行交互 · 200s 上限/);
    fireEvent.click(screen.getByRole("button", { name: "软件设置" }));
    expect(
      await screen.findByRole("spinbutton", { name: "总时长 / 秒" }),
    ).toHaveValue(200);
  });

  async function openHistory() {
    fireEvent.click(screen.getByRole("button", { name: "扫描历史" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "打开历史 example.com" }),
    );
    return screen.findByRole("button", { name: "example.com" });
  }

  it("启动时忽略上一版保存的任务，历史仍可打开", async () => {
    localStorage.setItem("castorice.lastScan", task.id);
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重置工作区" })).toBeEnabled(),
    );
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
    expect(screen.getByText("等待首次发现")).toBeInTheDocument();
    expect(mockAPI).not.toHaveBeenCalledWith("/scans/saved");
    await openHistory();
  });

  it("旧版脱敏历史保留结果，输入框等待重新填写域名", async () => {
    const original = mockAPI.getMockImplementation()!;
    const old = {
      ...task,
      target_url: "https://example.com/path?item=%5BREDACTED%5D",
      target_redacted: true,
    };
    mockAPI.mockImplementation((path: string, ...args: unknown[]) =>
      path.startsWith("/scans/history?")
        ? Promise.resolve({ items: [old], total: 1, finished_count: 1 })
        : path === "/scans/saved"
          ? Promise.resolve(old)
          : original(path, ...args),
    );
    render(<App />);
    await openHistory();
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
    expect(screen.getByText(/历史域名 example.com/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始采集" })).toBeDisabled();
  });

  it("从输入框提示新地址的 DNS 错误并保留上次结果", async () => {
    const original = mockAPI.getMockImplementation()!;
    mockAPI.mockImplementation(
      (path: string, method?: string, ...args: unknown[]) => {
        if (path === "/scans" && method === "POST")
          return Promise.reject(
            new APIError("系统解析返回回环地址", 400, "dns_non_public", {
              code: "dns_non_public",
              stage: "safety",
              message: "系统解析返回回环地址",
              hint: "请运行网络诊断",
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
    fireEvent.submit(screen.getByRole("textbox", { name: "要分析的网站" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "查看地址问题" }),
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /解析到了非公网地址/,
    );
    expect(screen.queryByText("请运行网络诊断")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
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
    const buttons = await screen.findAllByRole("button", {
      name: "打开历史 example.com",
    });
    fireEvent.click(buttons[1]);
    await screen.findByRole("button", { name: "返回正在采集" });
    expect(screen.getByRole("button", { name: "重置工作区" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "停止采集" }));
    await waitFor(() =>
      expect(mockAPI).toHaveBeenCalledWith("/scans/live/stop", "POST"),
    );
  });
  it("清空结果、计数与筛选，忽略旧事件，刷新后仍为空且可打开保留的历史", async () => {
    const view = render(<App />);
    await openHistory();
    fireEvent.click(screen.getByRole("button", { name: "搜索域名" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索域名" }), {
      target: { value: "missing" },
    });
    const old = FakeEventSource.instances.at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "重置工作区" }));
    await screen.findByText("等待首次发现");
    expect(screen.getByRole("textbox", { name: "要分析的网站" })).toHaveValue(
      "",
    );
    expect(screen.queryByRole("textbox", { name: "搜索域名" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "搜索域名" }));
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
      expect(screen.getByRole("button", { name: "重置工作区" })).toBeEnabled(),
    );
    expect(screen.getByText("等待首次发现")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "扫描历史" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "打开历史 example.com" }),
    );
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
    expect(screen.getByRole("button", { name: "重置工作区" })).toBeDisabled();
  });
  it("启动请求完成时保留等待期间选择的分析面板", async () => {
    let respond: ((value: ScanTask) => void) | undefined;
    const pending = new Promise<ScanTask>((resolve) => {
      respond = resolve;
    });
    const original = mockAPI.getMockImplementation()!;
    mockAPI.mockImplementation(
      (path: string, method?: string, ...args: unknown[]) =>
        path === "/scans" && method === "POST"
          ? pending
          : original(path, method, ...args),
    );
    const view = render(<App />);
    const address = await screen.findByRole("textbox", {
      name: "要分析的网站",
    });
    fireEvent.change(address, { target: { value: "example.com" } });
    fireEvent.submit(address);
    await waitFor(() =>
      expect(
        mockAPI.mock.calls.some(
          ([path, method]) => path === "/scans" && method === "POST",
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "分析 / 规则命中" }));
    respond?.(task);
    await screen.findByText("扫描完成");
    expect(view.container.querySelector(".workspace")).toHaveAttribute(
      "data-mobile-panel",
      "analysis",
    );
  });
  it("已经处于空工作区时再次清空，也会重置新输入的面板搜索", async () => {
    localStorage.setItem("castorice.lastScan", "");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重置工作区" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索域名" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索域名" }), {
      target: { value: "temporary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重置工作区" }));
    expect(screen.queryByRole("textbox", { name: "搜索域名" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "搜索域名" }));
    expect(screen.getByRole("textbox", { name: "搜索域名" })).toHaveValue("");
    expect(screen.getByText("等待首次发现")).toBeInTheDocument();
  });
});

it("清理粘贴地址并保留实际连接协议和端口", async () => {
  const original = mockAPI.getMockImplementation()!;
  mockAPI.mockImplementation(
    (path: string, method?: string, ...args: unknown[]) =>
      path === "/scans" && method === "POST"
        ? Promise.resolve({
            ...task,
            target_url: "example.com",
            target_scheme: "http",
            target_port: "8080",
          })
        : original(path, method, ...args),
  );
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "要分析的网站" });
  fireEvent.paste(input, {
    clipboardData: { getData: () => "http://example.com:8080/path?test=value" },
  });
  await screen.findByText("已自动清除前缀、路径或参数");
  expect(input).toHaveValue("example.com");
  fireEvent.submit(input);
  await waitFor(() =>
    expect(mockAPI).toHaveBeenCalledWith("/scans", "POST", {
      url: "http://example.com:8080/",
      options: defaultSettings.scan,
      root_only: true,
    }),
  );
});

it("在软件设置切换各模式参数，从标题栏单独打开网络诊断", async () => {
  render(<App />);
  expect(screen.queryByRole("button", { name: "高级配置" })).toBeNull();
  const modes = within(
    await screen.findByRole("radiogroup", { name: "扫描模式" }),
  );
  const quick = modes.getByRole("radio", { name: "快速" });
  const depth = modes.getByRole("radio", { name: "深度" });
  expect(modes.getAllByRole("radio")).toHaveLength(3);
  expect(quick).toBeChecked();
  fireEvent.click(depth);
  expect(quick).not.toBeChecked();
  expect(depth).toBeChecked();
  fireEvent.click(quick);
  const settings = await screen.findByRole("button", { name: "软件设置" });
  const networkButton = screen.getByRole("button", { name: "网络诊断" });
  expect(networkButton.nextElementSibling).toBe(settings);
  fireEvent.click(settings);
  const config = await screen.findByRole("dialog", { name: "软件设置" });
  const panel = within(config);
  expect(panel.queryByRole("button", { name: "网络诊断" })).toBeNull();
  expect(panel.getByLabelText("每页观察 / 秒")).toBeInTheDocument();
  expect(panel.queryByLabelText("探索深度")).toBeNull();
  expect(panel.queryByLabelText("最多页面")).toBeNull();
  const browserHelp = panel.getByRole("button", {
    name: "查看显示受控浏览器说明",
  });
  fireEvent.mouseOver(browserHelp);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent("自行交互始终显示窗口");
  expect(tooltip.querySelector(".MuiTooltip-arrow")).toBeNull();
  fireEvent.mouseLeave(browserHelp);
  fireEvent.click(panel.getByRole("tab", { name: "深度" }));
  expect(panel.getByRole("tabpanel", { name: "深度" })).toHaveTextContent(
    "同源链接",
  );
  expect(panel.getByLabelText("探索深度")).toBeInTheDocument();
  expect(panel.getByLabelText("最多页面")).toBeInTheDocument();
  const pages = panel.getByLabelText("最多页面");
  fireEvent.change(pages, { target: { value: "" } });
  fireEvent.blur(pages);
  expect(pages).toBeInvalid();
  fireEvent.change(pages, { target: { value: "2" } });
  expect(pages).toBeValid();
  fireEvent.click(panel.getByRole("tab", { name: "自行交互" }));
  expect(panel.getByLabelText("最多页面")).toBeInTheDocument();
  expect(panel.queryByLabelText("每页观察 / 秒")).toBeNull();
  expect(panel.queryByLabelText("显示受控浏览器")).toBeNull();
  expect(
    panel.queryByRole("button", { name: "查看显示受控浏览器说明" }),
  ).toBeNull();
  fireEvent.click(panel.getByRole("button", { name: "关闭设置" }));
  await waitFor(() => expect(config).not.toBeInTheDocument());
  fireEvent.click(networkButton);
  const network = await screen.findByRole("dialog", { name: "网络诊断" });
  expect(
    within(network).getByRole("button", { name: "用于下次扫描" }),
  ).toBeEnabled();
  fireEvent.click(
    within(network).getByRole("button", { name: "关闭网络诊断" }),
  );
  await waitFor(() => expect(network).not.toBeInTheDocument());
});

it("开源规则库在同一弹窗内展开设置，软件设置没有规则库入口", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "软件设置" }));
  const settings = await screen.findByRole("dialog", { name: /软件设置/ });
  const browserHeading = within(settings).getByText("浏览器与会话");
  expect(
    browserHeading.compareDocumentPosition(
      within(settings).getByText("扫描参数"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    within(settings).queryByRole("button", { name: /规则库|规则缓存/ }),
  ).toBeNull();
  fireEvent.click(within(settings).getByRole("button", { name: "关闭设置" }));
  await waitFor(() => expect(settings).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "开源规则库" }));
  const library = await screen.findByRole("dialog", { name: "开源规则库" });
  const panel = within(library);
  fireEvent.click(panel.getByRole("button", { name: "收起规则库设置" }));
  expect(panel.queryByRole("button", { name: "清理规则库" })).toBeNull();
  fireEvent.click(panel.getByRole("button", { name: "展开规则库设置" }));
  expect(
    panel.getByRole("complementary", { name: "规则库设置" }),
  ).toContainElement(panel.getByRole("button", { name: "清理规则库" }));
  expect(screen.queryByRole("dialog", { name: "规则库设置" })).toBeNull();
});
