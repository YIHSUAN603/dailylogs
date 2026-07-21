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
