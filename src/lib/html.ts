import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown → HTML：供舊資料遷移、AI 輸出（仍為 Markdown）轉回富文本編輯器可吃的 HTML */
export function markdownToHtml(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md),
  );
}

/** 內容看起來已經是 HTML（含區塊/行內標籤）？用來判斷舊 Markdown 資料是否需要遷移 */
export function looksLikeHtml(s: string): boolean {
  return /<(p|div|h[1-6]|ul|ol|li|img|table|br|strong|em|blockquote|pre|a|span)\b[^>]*>/i.test(s);
}

/** 區塊元素：serialize 時前後補換行 */
const BLOCK = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "BLOCKQUOTE", "PRE", "TR", "UL", "OL", "TABLE", "HR",
]);

function serialize(node: Node, out: string[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(child.textContent ?? "");
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (tag === "BR") {
      out.push("\n");
      return;
    }
    if (tag === "IMG") {
      out.push("[圖片]"); // 純文字情境不塞 base64，只標示有圖
      return;
    }
    const block = BLOCK.has(tag);
    if (block) out.push("\n");
    if (tag === "LI") out.push("• ");
    serialize(el, out);
    if (block) out.push("\n");
  });
}

/**
 * 清理 HTML 以便貼進團隊 Google Docs：保留標題（H2 專案／H3 功能）與巢狀清單結構，
 * 只移除會讓 Google Docs 產生「空白項目符號」的東西——
 * 拆掉 <li> 內的 <p> 包裝、刪除空的清單項與空段落。保留粗體/連結/行內程式碼/圖片（含尺寸）。
 */
export function cleanForDocs(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // 1. 拆掉 <li> 的直接子 <p>（Tiptap 會包 <p>，貼進 Docs 會多出空白項目）；多段以 <br> 相接
  doc.querySelectorAll("li").forEach((li) => {
    Array.from(li.children)
      .filter((c) => c.tagName === "P")
      .forEach((p, idx) => {
        if (idx > 0) li.insertBefore(doc.createElement("br"), p);
        while (p.firstChild) li.insertBefore(p.firstChild, p);
        p.remove();
      });
  });

  // 2. 移除空的清單項（沒有文字、圖片、也沒有子清單）
  doc.querySelectorAll("li").forEach((li) => {
    if (!li.textContent?.trim() && !li.querySelector("img, ul, ol, table")) li.remove();
  });

  // 3. 移除空段落與空標題
  doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6").forEach((el) => {
    if (!el.textContent?.trim() && !el.querySelector("img")) el.remove();
  });

  return doc.body.innerHTML;
}

/** HTML → 純文字：給純文字複製、AI 輸入、搜尋片段用（圖片以「[圖片]」標示，不含 base64） */
export function htmlToPlain(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  serialize(doc.body, out);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
