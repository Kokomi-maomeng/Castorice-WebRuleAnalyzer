import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RuleLibrary from "./RuleLibrary";
const { mockAPI } = vi.hoisted(() => ({ mockAPI: vi.fn() }));
vi.mock("../services/api", () => ({
  api: mockAPI,
  copy: vi.fn(),
  download: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("其他来源更新不重载编辑区，同源更新保留草稿直到明确采用", async () => {
  let own = "one",
    other = "one";
  const category = () => ({
    id: "v2fly:app",
    source: "v2fly",
    name: "app",
    version: own,
    raw: "original " + own,
    warnings: [],
  });
  mockAPI.mockImplementation(async (path: string) => {
    if (path === "/rules/sources")
      return [
        { id: "v2fly", version: own },
        { id: "blackmatrix7", version: other },
      ];
    if (path.startsWith("/rules/categories")) return [category()];
    if (path.startsWith("/rules/content")) return category();
    throw new Error(path);
  });
  render(
    <RuleLibrary
      initialCategory="v2fly:app"
      onClose={vi.fn()}
      onRematch={vi.fn()}
      notify={vi.fn()}
    />,
  );
  const editor = await screen.findByRole("textbox", { name: "规则原文编辑区" });
  await waitFor(() => expect(editor).toHaveValue("original one"));
  fireEvent.change(editor, { target: { value: "my draft" } });
  const loads = mockAPI.mock.calls.filter(([path]) =>
    path.startsWith("/rules/content"),
  ).length;
  other = "two";
  fireEvent.change(screen.getByRole("textbox", { name: "搜索规则分类" }), {
    target: { value: "app" },
  });
  await waitFor(() =>
    expect(mockAPI).toHaveBeenCalledWith("/rules/categories?q=app"),
  );
  expect(editor).toHaveValue("my draft");
  expect(
    mockAPI.mock.calls.filter(([path]) => path.startsWith("/rules/content")),
  ).toHaveLength(loads);
  own = "two";
  fireEvent.change(screen.getByRole("textbox", { name: "搜索规则分类" }), {
    target: { value: "app2" },
  });
  const adopt = await screen.findByRole("button", { name: "采用新原文" });
  expect(screen.getByRole("textbox", { name: "规则原文编辑区" })).toHaveValue(
    "my draft",
  );
  fireEvent.click(adopt);
  expect(screen.getByRole("textbox", { name: "规则原文编辑区" })).toHaveValue(
    "original two",
  );
});
