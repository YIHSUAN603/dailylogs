import { describe, it, expect } from "vitest";
import { extractCarryover } from "./carryover";

describe("extractCarryover（HTML）", () => {
  it("命中段落止於下一個同層標題", () => {
    const html =
      "<h2>完成</h2><ul><li>a</li></ul><h3>明日</h3><ul><li>b</li><li>c</li></ul><h3>其他</h3><ul><li>d</li></ul>";
    expect(extractCarryover(html)).toBe("<h3>明日</h3><ul><li>b</li><li>c</li></ul>");
  });

  it("命中段落包含巢狀子標題", () => {
    const html =
      "<h2>進行中</h2><h3>專案A</h3><ul><li>a</li></ul><h3>專案B</h3><ul><li>b</li></ul><h2>完成</h2><ul><li>c</li></ul>";
    expect(extractCarryover(html)).toBe(
      "<h2>進行中</h2><h3>專案A</h3><ul><li>a</li></ul><h3>專案B</h3><ul><li>b</li></ul>",
    );
  });

  it("多個命中段落以原順序串接", () => {
    const html =
      "<h3>進行中</h3><ul><li>a</li></ul><h3>完成</h3><ul><li>x</li></ul><h3>明日</h3><ul><li>b</li></ul>";
    expect(extractCarryover(html)).toBe(
      "<h3>進行中</h3><ul><li>a</li></ul><h3>明日</h3><ul><li>b</li></ul>",
    );
  });

  it("關鍵字不分大小寫", () => {
    expect(extractCarryover("<h2>TODO</h2><ul><li>a</li></ul>")).toBe(
      "<h2>TODO</h2><ul><li>a</li></ul>",
    );
  });

  it("沒有任何命中回傳 null", () => {
    expect(extractCarryover("<h2>完成</h2><ul><li>a</li></ul>")).toBeNull();
    expect(extractCarryover("<p>沒有標題的純文字</p>")).toBeNull();
  });

  it("空字串回傳 null", () => {
    expect(extractCarryover("")).toBeNull();
  });

  it("命中段落到文末仍會輸出", () => {
    expect(
      extractCarryover("<h2>完成</h2><ul><li>a</li></ul><h2>待辦</h2><ul><li>b</li><li>c</li></ul>"),
    ).toBe("<h2>待辦</h2><ul><li>b</li><li>c</li></ul>");
  });

  it("自訂關鍵字生效", () => {
    expect(extractCarryover("<h2>卡關</h2><ul><li>a</li></ul>", ["卡關"])).toBe(
      "<h2>卡關</h2><ul><li>a</li></ul>",
    );
    expect(extractCarryover("<h2>明日</h2><ul><li>a</li></ul>", ["卡關"])).toBeNull();
  });
});
