import { describe, it, expect } from "vitest";
import { toItems, markdownToPlain, dateStr, dedupeCommits } from "./format";

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

describe("dateStr", () => {
  it("以本地時區輸出 YYYY-MM-DD 並補零", () => {
    expect(dateStr(new Date(2026, 6, 2))).toBe("2026-07-02");
    expect(dateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("dedupeCommits", () => {
  it("已存在的條列會被去除，全空的標頭一併略過", () => {
    const existing = "# 專案A\n[repo1]\n- 修正登入";
    const commits = "# 專案A\n[repo1]\n- 修正登入\n- 新增註冊\n\n# 專案B\n[repo2]\n- 調整樣式";
    expect(dedupeCommits(existing, commits)).toBe("# 專案A\n[repo1]\n- 新增註冊\n\n# 專案B\n[repo2]\n- 調整樣式");
  });

  it("全部重複時回傳空字串", () => {
    const block = "# 專案A\n[repo1]\n- 修正登入";
    expect(dedupeCommits(block, block)).toBe("");
  });
});
