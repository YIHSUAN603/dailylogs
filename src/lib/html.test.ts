import { describe, it, expect } from "vitest";
import { markdownToHtml, htmlToPlain, looksLikeHtml } from "./html";

describe("markdownToHtml", () => {
  it("把 Markdown 標題與清單轉成 HTML", () => {
    const html = markdownToHtml("# 標題\n\n- a\n- b");
    expect(html).toContain("<h1>標題</h1>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b</li>");
  });
});

describe("htmlToPlain", () => {
  it("去標籤並保留清單項目、以換行分段", () => {
    const plain = htmlToPlain("<h2>標題</h2><ul><li>a</li><li>b</li></ul>");
    expect(plain).not.toContain("<");
    expect(plain).toContain("標題");
    expect(plain).toContain("• a");
    expect(plain).toContain("• b");
  });

  it("圖片以「[圖片]」標示，不含 base64", () => {
    const plain = htmlToPlain('<p>看圖<img src="data:image/png;base64,AAAA"></p>');
    expect(plain).toContain("看圖");
    expect(plain).toContain("[圖片]");
    expect(plain).not.toContain("base64");
  });
});

describe("looksLikeHtml", () => {
  it("HTML 內容回傳 true", () => {
    expect(looksLikeHtml("<p>你好</p>")).toBe(true);
    expect(looksLikeHtml("<h2>標題</h2>")).toBe(true);
  });

  it("Markdown / 純文字回傳 false", () => {
    expect(looksLikeHtml("# 標題\n- a")).toBe(false);
    expect(looksLikeHtml("純文字")).toBe(false);
  });
});
