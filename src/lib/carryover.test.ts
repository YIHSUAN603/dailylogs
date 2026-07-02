import { describe, it, expect } from "vitest";
import { extractCarryover } from "./carryover";

describe("extractCarryover", () => {
  it("命中段落止於下一個同層標題", () => {
    const md = "## 完成\n- a\n\n### 明日\n- b\n- c\n\n### 其他\n- d";
    expect(extractCarryover(md)).toBe("### 明日\n- b\n- c");
  });

  it("命中段落包含巢狀子標題", () => {
    const md = "## 進行中\n### 專案A\n- a\n### 專案B\n- b\n## 完成\n- c";
    expect(extractCarryover(md)).toBe("## 進行中\n### 專案A\n- a\n### 專案B\n- b");
  });

  it("多個命中段落以空行串接並保留原順序", () => {
    const md = "### 進行中\n- a\n### 完成\n- x\n### 明日\n- b";
    expect(extractCarryover(md)).toBe("### 進行中\n- a\n\n### 明日\n- b");
  });

  it("關鍵字不分大小寫", () => {
    expect(extractCarryover("## TODO\n- a")).toBe("## TODO\n- a");
  });

  it("沒有任何命中回傳 null", () => {
    expect(extractCarryover("## 完成\n- a")).toBeNull();
    expect(extractCarryover("沒有標題的純文字")).toBeNull();
  });

  it("空字串回傳 null", () => {
    expect(extractCarryover("")).toBeNull();
  });

  it("命中段落到文末仍會輸出", () => {
    expect(extractCarryover("## 完成\n- a\n## 待辦\n- b\n- c\n")).toBe("## 待辦\n- b\n- c");
  });

  it("自訂關鍵字生效", () => {
    expect(extractCarryover("## 卡關\n- a", ["卡關"])).toBe("## 卡關\n- a");
    expect(extractCarryover("## 明日\n- a", ["卡關"])).toBeNull();
  });
});
