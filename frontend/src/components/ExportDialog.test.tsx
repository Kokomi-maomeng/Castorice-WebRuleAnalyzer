import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportDialog from "./ExportDialog";
import { defaultSettings } from "../utils/format";
import type {
  DomainRecord,
  ExportJob,
  ExportResult,
  RuleCategory,
  ScanTask,
} from "../types";
const { mockAPI, mockCopy, mockDownload } = vi.hoisted(() => ({
  mockAPI: vi.fn(),
  mockCopy: vi.fn(async () => {}),
  mockDownload: vi.fn(async () => {}),
}));
vi.mock("../services/api", () => ({
  api: mockAPI,
  copy: mockCopy,
  download: mockDownload,
}));
const task: ScanTask = {
  id: "test",
  target_url: "https://example.com",
  status: "completed",
  options: defaultSettings.scan,
  started_at: "2026-10-21T00:00:00Z",
  domain_count: 1,
  ip_count: 0,
  request_count: 1,
  pages: [],
  matches: [],
};
const domains: DomainRecord[] = [
  {
    hostname: "example.com",
    kind: "domain",
    first_seen: task.started_at,
    request_count: 1,
    resource_types: ["Document"],
    request_ids: ["a"],
    source: "browser-observed",
  },
];
const output: ExportResult = {
  attribution: "",
  content: "rules:\n  - DOMAIN,example.com,dibao\n",
  filename: "rules.yaml",
  mime: "application/yaml",
  observed_domains: 1,
  added_rules: 0,
  duplicate_or_covered: 0,
  final_rules: 1,
  warnings: [],
  entries: [
    {
      rule_type: "DOMAIN",
      rule_value: "example.com",
      label: "本次抓取",
      selected: true,
      origins: [],
    },
  ],
};
const emptySources = ["blackmatrix7", "v2fly"].map((id) => ({
  id,
  category_count: 0,
  status: "not_initialized",
}));
beforeEach(() => {
  mockAPI.mockReset();
  mockCopy.mockClear();
  mockDownload.mockClear();
  mockAPI.mockImplementation(
    async (path: string, _method: string, body?: { excluded?: string[] }) => {
      if (path === "/rules/categories") return [];
      if (path === "/rules/sources") return emptySources;
      if (body?.excluded?.length) throw new Error("没有可导出的已选择域名规则");
      return output;
    },
  );
});
afterEach(cleanup);
describe("导出预览", () => {
  it("最终下载前拒绝已更新的分类，并刷新到新版本后才导出", async () => {
    let version = "one";
    const category = () => ({
      id: "v2fly:app",
      name: "app",
      source: "v2fly",
      version,
      content_hash: "hash",
      loaded: true,
      warnings: [],
      rule_count: 1,
    });
    mockAPI.mockImplementation(
      async (path: string, _method: string, body?: ExportJob) => {
        if (path === "/rules/categories") return [category()];
        if (path === "/rules/sources") return [];
        if (body?.category_versions?.["v2fly:app"] !== version + ":hash")
          throw Object.assign(new Error("规则已更新"), { status: 409 });
        return { ...output, content: version };
      },
    );
    render(
      <ExportDialog
        task={{
          ...task,
          recommended_category: "v2fly:app",
          matches: [
            {
              category_id: "v2fly:app",
              relation: "target",
              suitable: true,
            } as ScanTask["matches"][number],
          ],
        }}
        domains={domains}
        mode="merged"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "下载文件" });
    await waitFor(() => expect(button).toBeEnabled());
    version = "two";
    fireEvent.click(button);
    await waitFor(() =>
      expect(mockAPI).toHaveBeenCalledWith(
        "/export",
        "POST",
        expect.objectContaining({
          category_versions: { "v2fly:app": "two:hash" },
        }),
      ),
    );
    expect(mockDownload).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(mockDownload).toHaveBeenCalledWith(
        "two",
        output.filename,
        output.mime,
      ),
    );
  });
  it("全部取消后仍可恢复条目，错误时禁止下载旧内容", async () => {
    render(
      <ExportDialog
        task={task}
        domains={domains}
        mode="observed"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    const checkbox = await screen.findByRole("checkbox", {
      name: "导出 DOMAIN,example.com",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "下载文件" })).toBeEnabled(),
    );
    fireEvent.click(checkbox);
    await screen.findByText("没有可导出的已选择域名规则");
    expect(screen.getByRole("button", { name: "下载文件" })).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "下载文件" })).toBeEnabled(),
    );
    expect(checkbox).toBeChecked();
  });
  it("未下载规则库时保留观察预览，提供下载入口，不冒充合并结果", async () => {
    render(
      <ExportDialog
        task={task}
        domains={domains}
        mode="merged"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    expect(await screen.findByText(/尚未选择规则分类/)).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", { name: "导出 DOMAIN,example.com" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载规则库" })).toBeEnabled();
    expect(
      mockAPI.mock.calls
        .filter(([path]) => path === "/export")
        .every(
          ([, , job]) => job.mode === "observed" && !job.category_ids.length,
        ),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "下载文件" })).toBeDisabled();
  });
  it("导出页下载完成后立即显示可搜索分类，选择后使用真实合并请求", async () => {
    const category: RuleCategory = {
      id: "v2fly:example",
      name: "Example",
      source: "v2fly",
      version: "abc",
      path: "data/example",
      loaded: true,
      broad: false,
      rule_count: 1,
      warnings: [],
    };
    let downloaded = false;
    let updating = false;
    const syncCalls: string[] = [];
    mockAPI.mockImplementation(
      async (path: string, _method: string, body?: { source?: string }) => {
        if (path === "/rules/categories") return downloaded ? [category] : [];
        if (path === "/rules/sources")
          return downloaded
            ? emptySources.map((s) => ({
                ...s,
                category_count: 1,
                status: "ready",
              }))
            : emptySources;
        if (path === "/rules/sync") {
          if (updating) throw new Error("并发更新冲突");
          updating = true;
          syncCalls.push(body!.source!);
          await new Promise((resolve) => setTimeout(resolve, 10));
          downloaded = true;
          updating = false;
          return [];
        }
        return output;
      },
    );
    render(
      <ExportDialog
        task={task}
        domains={domains}
        mode="merged"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "下载规则库" }));
    await screen.findByText(/1 个本地分类/);
    expect(syncCalls).toEqual(["blackmatrix7", "v2fly"]);
    const input = screen.getByRole("combobox", { name: "规则分类" });
    fireEvent.change(input, { target: { value: "Exam" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Example/ }));
    await waitFor(() =>
      expect(
        mockAPI.mock.calls.some(
          ([path, , job]) =>
            path === "/export" &&
            job.mode === "merged" &&
            job.category_ids.includes(category.id),
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "下载文件" })).toBeEnabled(),
    );
  });
  it("分页只渲染30条，本页取消跨页保留，搜索分类可定位全部条目", async () => {
    const entries = Array.from({ length: 95 }, (_, i) => ({
      ...output.entries[0],
      rule_value: `d${String(i).padStart(3, "0")}.example.com`,
      origins: [
        {
          source: "v2fly",
          source_category: "example-app",
          source_version: "abc",
        },
      ],
    }));
    mockAPI.mockImplementation(async (path: string) =>
      path === "/rules/categories"
        ? []
        : path === "/rules/sources"
          ? emptySources
          : { ...output, entries },
    );
    render(
      <ExportDialog
        task={task}
        domains={domains}
        mode="observed"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    await screen.findByRole("checkbox", {
      name: "导出 DOMAIN,d000.example.com",
    });
    expect(
      screen.getAllByRole("checkbox", { name: /^导出 DOMAIN,/ }),
    ).toHaveLength(30);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择本页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(
      screen.getByRole("checkbox", { name: "导出 DOMAIN,d030.example.com" }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(
      screen.getByRole("checkbox", { name: "导出 DOMAIN,d000.example.com" }),
    ).not.toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索预览条目" }), {
      target: { value: "d094" },
    });
    expect(
      screen.getAllByRole("checkbox", { name: /^导出 DOMAIN,/ }),
    ).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索预览条目" }), {
      target: { value: "example-app" },
    });
    expect(
      screen.getAllByRole("checkbox", { name: /^导出 DOMAIN,/ }),
    ).toHaveLength(30);
    await waitFor(() =>
      expect(
        mockAPI.mock.calls.filter(([path]) => path === "/export").at(-1)?.[2]
          .excluded,
      ).toHaveLength(30),
    );
  });
  it("文件按行分页，复制下载完整文件，最后一行不丢失", async () => {
    const content =
      Array.from({ length: 451 }, (_, i) => `line-${i + 1}`).join("\n") + "\n";
    mockAPI.mockImplementation(async (path: string) =>
      path === "/rules/categories"
        ? []
        : path === "/rules/sources"
          ? emptySources
          : { ...output, content },
    );
    render(
      <ExportDialog
        task={task}
        domains={domains}
        mode="observed"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    await screen.findByRole("checkbox", { name: "导出 DOMAIN,example.com" });
    fireEvent.click(screen.getByRole("tab", { name: "文件内容" }));
    expect(screen.getByText("line-200")).toBeInTheDocument();
    expect(screen.queryByText("line-201")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "第 3 页" }));
    expect(screen.getByText("line-451")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制内容" }));
    fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
    expect(mockCopy).toHaveBeenCalledWith(content);
    expect(mockDownload).toHaveBeenCalledWith(
      content,
      output.filename,
      output.mime,
    );
  });
  it("计算失败和迟到的旧预览均不能下载，保留条目可恢复", async () => {
    let resolveOld: ((r: ExportResult) => void) | undefined;
    mockAPI.mockImplementation(
      async (path: string, _method: string, job?: ExportJob) => {
        if (path === "/rules/categories") return [];
        if (path === "/rules/sources") return emptySources;
        if (job?.policy === "old")
          return new Promise<ExportResult>((resolve) => {
            resolveOld = resolve;
          });
        if (job?.policy === "bad") throw new Error("策略无效");
        return output;
      },
    );
    render(
      <ExportDialog
        task={task}
        domains={domains}
        mode="observed"
        settings={defaultSettings}
        onClose={vi.fn()}
        notify={vi.fn()}
        onRematch={vi.fn()}
      />,
    );
    await screen.findByRole("checkbox", { name: "导出 DOMAIN,example.com" });
    fireEvent.change(screen.getByLabelText("策略组名称"), {
      target: { value: "old" },
    });
    await waitFor(() => expect(resolveOld).toBeDefined());
    fireEvent.change(screen.getByLabelText("策略组名称"), {
      target: { value: "bad" },
    });
    await screen.findByText("策略无效");
    resolveOld!(output);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "下载文件" })).toBeDisabled(),
    );
  });
});
