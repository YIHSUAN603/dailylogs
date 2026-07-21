import { describe, it, expect } from "vitest";
import { markdownToHtml, htmlToPlain, cleanForDocs, looksLikeHtml } from "./html";

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

describe("cleanForDocs", () => {
  it("保留 H2 專案 / H3 功能標題與巢狀清單結構", () => {
    const out = cleanForDocs(
      "<h2>GeoNames</h2><h3>登入功能</h3><ul><li><p>完成</p><ul><li><p>做了 A ✅</p></li></ul></li></ul>",
    );
    expect(out).toBe(
      "<h2>GeoNames</h2><h3>登入功能</h3><ul><li>完成<ul><li>做了 A ✅</li></ul></li></ul>",
    );
  });

  it("拆掉 <li> 內的 <p> 包裝（避免 Google Docs 產生空白項目）", () => {
    expect(cleanForDocs("<ul><li><p>甲</p></li><li><p>乙</p></li></ul>")).toBe(
      "<ul><li>甲</li><li>乙</li></ul>",
    );
  });

  it("移除空段落與空清單項", () => {
    expect(
      cleanForDocs("<p></p><ul><li>甲</li><li><p>  </p></li><li>乙</li></ul><p></p>"),
    ).toBe("<ul><li>甲</li><li>乙</li></ul>");
  });

  it("有子清單的父項即使自身無文字也保留（維持巢狀）", () => {
    expect(cleanForDocs("<ul><li><p>完成</p><ul><li>子</li></ul></li></ul>")).toBe(
      "<ul><li>完成<ul><li>子</li></ul></li></ul>",
    );
  });

  it("保留行內粗體、連結、行內程式碼與圖片（含尺寸）", () => {
    const out = cleanForDocs(
      '<ul><li><p>用 <code>npm</code> 與 <strong>粗</strong> <a href="https://x">連</a></p></li>' +
        '<li><p><img src="data:image/png;base64,AAAA" style="width: 200px; height: auto"></p></li></ul>',
    );
    expect(out).toContain("<code>npm</code>");
    expect(out).toContain("<strong>粗</strong>");
    expect(out).toContain('<a href="https://x">連</a>');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toContain("width: 200px");
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
