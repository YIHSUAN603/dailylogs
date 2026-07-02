import { describe, it, expect } from "vitest";
import { parseTaskDrafts, parseTags } from "./ai";

describe("parseTaskDrafts", () => {
  it("解析乾淨的 JSON 陣列", () => {
    const out = '[{"title": "做登入頁", "notes": "含驗證"}, {"title": "寫測試", "notes": ""}]';
    expect(parseTaskDrafts(out)).toEqual([
      { title: "做登入頁", notes: "含驗證" },
      { title: "寫測試", notes: "" },
    ]);
  });

  it("容忍 ```json 包裹與前後多餘文字", () => {
    const out = '好的，以下是拆解結果：\n```json\n[{"title": "A", "notes": "B"}]\n```\n希望有幫助';
    expect(parseTaskDrafts(out)).toEqual([{ title: "A", notes: "B" }]);
  });

  it("過濾掉沒有標題的項目", () => {
    const out = '[{"title": "", "notes": "x"}, {"title": "有效", "notes": ""}]';
    expect(parseTaskDrafts(out)).toEqual([{ title: "有效", notes: "" }]);
  });

  it("JSON 解析失敗時退回逐行抓條列", () => {
    const out = "- 第一項\n* 第二項\n1. 第三項\n";
    expect(parseTaskDrafts(out).map((d) => d.title)).toEqual(["第一項", "第二項", "第三項"]);
  });
});

describe("parseTags", () => {
  it("以逗號或換行切割並去掉符號", () => {
    expect(parseTags("# 前端, -測試\nTauri")).toEqual(["前端", "測試", "Tauri"]);
  });

  it("最多取 5 個", () => {
    expect(parseTags("a,b,c,d,e,f,g")).toHaveLength(5);
  });

  it("全形逗號也可切割", () => {
    expect(parseTags("前端，後端")).toEqual(["前端", "後端"]);
  });
});
