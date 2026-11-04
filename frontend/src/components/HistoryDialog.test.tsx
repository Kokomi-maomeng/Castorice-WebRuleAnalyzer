import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HistoryDialog from "./HistoryDialog";
import { defaultSettings } from "../utils/format";
import type { ScanTask } from "../types";
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
  await screen.findAllByRole("button", { name: "打开" });
  expect(
    screen.getByRole("checkbox", { name: "选择历史 https://live.example/" }),
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
      name: "删除历史 https://example.com/",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findAllByText("历史暂时无法写入");
  expect(screen.getByText("https://example.com/")).toBeInTheDocument();
});
