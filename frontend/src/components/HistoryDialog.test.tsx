import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HistoryDialog from "./HistoryDialog";
import { defaultSettings } from "../test-settings";
import type { HistoryPage, ScanTask } from "../types";
const { mockAPI } = vi.hoisted(() => ({ mockAPI: vi.fn() }));
vi.mock("../services/api", () => ({ api: mockAPI }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const done: ScanTask = {
  id: "done",
  target_url: "https://example.com/",
  status: "completed",
  started_at: "2026-11-03T00:00:00Z",
  options: defaultSettings.scan,
  domain_count: 1,
  request_count: 2,
  ip_count: 0,
  pages: [],
  matches: [],
};

it("清空覆盖全部已结束记录，确认前不删除，活动任务不可勾选", async () => {
  const deleted = vi.fn();
  let removed = false;
  mockAPI.mockImplementation(async (path: string, method?: string) => {
    if (method === "DELETE") {
      removed = true;
      return { deleted: 129, ids: ["done"] };
    }
    if (path.startsWith("/scans/history?"))
      return {
        items: removed
          ? []
          : [
              done,
              {
                ...done,
                id: "live",
                target_url: "https://live.example/",
                status: "running",
              },
            ],
        total: removed ? 1 : 130,
        finished_count: removed ? 0 : 129,
      };
    throw new Error(path);
  });
  render(
    <HistoryDialog onClose={vi.fn()} onOpen={vi.fn()} onDeleted={deleted} />,
  );
  await screen.findByRole("button", { name: "打开历史 example.com" });
  expect(
    screen.getByRole("checkbox", { name: "选择历史 live.example" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "清空已结束历史" }));
  expect(screen.getByText(/129 条扫描记录/)).toBeInTheDocument();
  expect(mockAPI.mock.calls.some(([, method]) => method === "DELETE")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(deleted).toHaveBeenCalledWith({ deleted: 129, ids: ["done"] }),
  );
  expect(mockAPI).toHaveBeenCalledWith("/scans", "DELETE", {
    all_finished: true,
  });
});

it("单条删除失败保留原记录并显示错误", async () => {
  mockAPI.mockImplementation(async (_path: string, method?: string) => {
    if (method === "DELETE") throw new Error("历史暂时无法写入");
    return { items: [done], total: 1, finished_count: 1 };
  });
  render(<HistoryDialog onClose={vi.fn()} onOpen={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "删除历史 example.com",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findAllByText("历史暂时无法写入");
  expect(screen.getByText("example.com")).toBeInTheDocument();
});

it("点击记录打开，Ctrl 切换勾选，Shift 连选可删除的记录", async () => {
  const onOpen = vi.fn();
  const rows = [
    done,
    {
      ...done,
      id: "live",
      target_url: "https://live.example/",
      status: "running" as const,
    },
    { ...done, id: "second", target_url: "https://second.example/" },
    { ...done, id: "last", target_url: "https://last.example/" },
  ];
  mockAPI.mockResolvedValue({ items: rows, total: 4, finished_count: 3 });
  render(<HistoryDialog onClose={vi.fn()} onOpen={onOpen} />);
  const first = await screen.findByRole("button", {
    name: "打开历史 example.com",
  });
  const last = screen.getByRole("button", { name: "打开历史 last.example" });
  fireEvent.click(first, { ctrlKey: true });
  fireEvent.click(last, { shiftKey: true });
  expect(onOpen).not.toHaveBeenCalled();
  expect(
    screen.getByRole("checkbox", { name: "选择历史 example.com" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "选择历史 live.example" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "选择历史 second.example" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "选择历史 last.example" }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "删除历史 example.com" }));
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "取消" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(last);
  expect(onOpen).toHaveBeenCalledWith(rows[3]);
});

it("搜索时保留当前记录，并忽略较早的搜索响应", async () => {
  let resolveOld: ((page: HistoryPage) => void) | undefined;
  const matching = { ...done, id: "new", target_url: "https://new.example/" };
  mockAPI.mockImplementation((path: string) => {
    const query = new URL(path, "https://example.test").searchParams.get("q");
    if (query === "old")
      return new Promise<HistoryPage>((resolve) => {
        resolveOld = resolve;
      });
    return Promise.resolve({
      items: [query ? matching : done],
      total: 1,
      finished_count: 1,
    });
  });
  render(<HistoryDialog onClose={vi.fn()} onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "打开历史 example.com" });
  const search = screen.getByRole("textbox", { name: "搜索历史地址" });
  fireEvent.change(search, { target: { value: "old" } });
  await waitFor(() => expect(resolveOld).toBeDefined());
  expect(
    screen.getByRole("button", { name: "打开历史 example.com" }),
  ).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "new" } });
  await screen.findByRole("button", { name: "打开历史 new.example" });
  await act(async () =>
    resolveOld?.({ items: [], total: 0, finished_count: 0 }),
  );
  expect(
    screen.getByRole("button", { name: "打开历史 new.example" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("没有匹配的历史")).not.toBeInTheDocument();
});
