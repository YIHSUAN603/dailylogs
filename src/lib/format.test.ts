import { describe, it, expect } from "vitest";
import { toItems, markdownToPlain } from "./format";

describe("toItems", () => {
  it("去掉項目符號並過濾空行", () => {
    expect(toItems("- a\n• b\n\n  c ")).toEqual(["a", "b", "c"]);
  });
});

describe("markdownToPlain", () => {
  it("移除標題井號與行內粗體", () => {
    expect(markdownToPlain("# 標題\n**粗體**")).toBe("標題\n粗體");
  });
});
