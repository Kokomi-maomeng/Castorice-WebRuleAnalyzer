import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DomainPanel from "./DomainPanel";
import type { DomainRecord } from "../types";

afterEach(cleanup);
const domains: DomainRecord[] = [
  {
    hostname: "app.example.com",
    kind: "domain",
    first_seen: "2026-10-21T00:00:00Z",
    request_count: 3,
    resource_types: ["Document", "Fetch"],
    request_ids: ["a", "b", "c"],
    source: "browser-observed",
  },
  {
    hostname: "cdn.thirdparty.com",
    kind: "domain",
    first_seen: "2026-10-21T00:00:01Z",
    request_count: 1,
    resource_types: ["Image"],
    request_ids: ["d"],
    source: "browser-observed",
  },
  {
    hostname: "8.8.8.8",
    kind: "ipv4",
    first_seen: "2026-10-21T00:00:02Z",
    request_count: 1,
    resource_types: ["Fetch"],
    request_ids: ["e"],
    source: "browser-observed",
  },
];
const { mockCopy } = vi.hoisted(() => ({
  mockCopy: vi.fn(async () => {}),
}));
vi.mock("../services/api", () => ({ copy: mockCopy }));

function renderPanel(
  initialExcluded: string[] = [],
  records = domains,
  reportedCount?: number,
) {
  const onRequests = vi.fn();
  const onSelect = vi.fn();
  function Panel() {
    const [excluded, setExcluded] = useState(() => new Set(initialExcluded));
    return (
      <DomainPanel
        domains={records}
        task={
          reportedCount === undefined
            ? undefined
            : { domain_count: reportedCount, matches: [] }
        }
        excluded={excluded}
        onSelect={(hosts, selected) => {
          onSelect(hosts, selected);
          setExcluded((old) => {
            const next = new Set(old);
            for (const host of hosts) {
              if (selected) next.delete(host);
              else next.add(host);
            }
            return next;
          });
        }}
        onExport={vi.fn()}
        onRequests={onRequests}
        notify={vi.fn()}
      />
    );
  }
  const view = render(<Panel />);
  return { ...view, onRequests, onSelect };
}

describe("观察域名面板", () => {
  it("保留第三方观察域名，IP 不可作为普通域名导出", () => {
    const { onSelect } = renderPanel();
    expect(screen.getByText("cdn.thirdparty.com")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "选择 8.8.8.8" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 cdn.thirdparty.com" }),
    );
    expect(onSelect).toHaveBeenCalledWith(["cdn.thirdparty.com"], false);
  });

  it("状态事件和结果返回顺序不同步时保留已知的完整域名计数", () => {
    const { unmount } = renderPanel([], domains, 1);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    unmount();
    renderPanel([], domains, 5);
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  it("点整行打开关联请求，勾选和复制各自独立", () => {
    const { onRequests } = renderPanel(["cdn.thirdparty.com"]);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Document · Fetch"));
    expect(onRequests).toHaveBeenCalledWith("app.example.com");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 app.example.com" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "复制 app.example.com" }),
    );
    expect(mockCopy).toHaveBeenCalledWith("app.example.com");
    expect(onRequests).toHaveBeenCalledTimes(1);
  });

  it("由标题右侧展开搜索，按 Escape 关闭并重设筛选", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "搜索域名" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "搜索域名" })).toBeNull();
    fireEvent.click(toggle);
    const input = screen.getByRole("textbox", { name: "搜索域名" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveFocus();
    fireEvent.change(input, {
      target: { value: "missing" },
    });
    expect(screen.getByText("没有匹配的域名")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    expect(screen.getByText("cdn.thirdparty.com")).toBeInTheDocument();
  });

  it("Ctrl 切换单行，Shift 按当前顺序选中范围，页头切换全选", () => {
    const between = { ...domains[0], hostname: "beta.example.com" };
    const { onRequests, onSelect } = renderPanel(
      ["app.example.com", between.hostname, "cdn.thirdparty.com"],
      [...domains, between],
    );
    const all = screen.getByRole("checkbox", { name: "全选域名" });
    const row = (name: string) => screen.getByRole("button", { name });
    const checkbox = (name: string) =>
      screen.getByRole("checkbox", { name: `选择 ${name}` });
    fireEvent.click(row("cdn.thirdparty.com"), { ctrlKey: true });
    expect(checkbox("cdn.thirdparty.com")).toBeChecked();
    expect(all).toBePartiallyChecked();
    fireEvent.click(checkbox("app.example.com"), { shiftKey: true });
    expect(checkbox(between.hostname)).toBeChecked();
    expect(all).toBeChecked();
    expect(onRequests).not.toHaveBeenCalled();
    fireEvent.click(all);
    expect(screen.getByText("0 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜索域名" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索域名" }), {
      target: { value: "cdn" },
    });
    expect(screen.queryByText(between.hostname)).toBeNull();
    fireEvent.click(all);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(onSelect).toHaveBeenLastCalledWith(
      ["app.example.com", "cdn.thirdparty.com", between.hostname],
      true,
    );
  });

  it("按选择的字段排序，方向在默认、升序、降序间循环", () => {
    const { container } = renderPanel();
    const names = () =>
      [...container.querySelectorAll(".domain-name")].map(
        (row) => row.textContent,
      );
    expect(names()).toEqual([
      "8.8.8.8",
      "app.example.com",
      "cdn.thirdparty.com",
    ]);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "域名排序" }));
    fireEvent.click(screen.getByRole("option", { name: "请求次数" }));
    expect(names()[0]).toBe("app.example.com");
    const direction = screen.getByRole("button", { name: "切换域名排序方向" });
    fireEvent.click(direction);
    expect(direction).toHaveAttribute("data-direction", "ascending");
    expect(names().at(-1)).toBe("app.example.com");
    fireEvent.click(direction);
    expect(direction).toHaveAttribute("data-direction", "descending");
    expect(names()[0]).toBe("app.example.com");
    fireEvent.click(direction);
    expect(direction).toHaveAttribute("data-direction", "default");
    expect(names()[0]).toBe("app.example.com");
  });
});
