import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type Report } from "../types";
import { markdownToPlain } from "./format";

const CJK_FONT = "Microsoft JhengHei";

/** 複製純文字到剪貼簿（給通訊軟體貼上） */
export async function copyPlainText(report: Report): Promise<void> {
  await writeText(markdownToPlain(report.raw_notes));
}

/** 複製 Markdown 到剪貼簿 */
export async function copyMarkdown(report: Report): Promise<void> {
  await writeText(report.raw_notes);
}

/** 匯出 Markdown 檔 */
export async function exportMarkdown(report: Report): Promise<boolean> {
  const path = await save({
    defaultPath: `日報_${report.date}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await invoke("write_text_file", { path, contents: report.raw_notes });
  return true;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/** 把一行 Markdown 行內語法（**粗體**）拆成 docx TextRun[] */
function inlineRuns(text: string): TextRun[] {
  return text
    .split(/(\*\*.+?\*\*)/g)
    .filter(Boolean)
    .map((part) => {
      const bold = part.startsWith("**") && part.endsWith("**");
      return new TextRun({ text: bold ? part.slice(2, -2) : part, font: CJK_FONT, bold });
    });
}

/** 把 Markdown 原文逐行轉成 docx 段落 */
function markdownToParagraphs(md: string): Paragraph[] {
  const paras: Paragraph[] = [];
  for (const raw of md.split("\n")) {
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      paras.push(
        new Paragraph({ heading: HEADINGS[heading[1].length - 1], children: inlineRuns(heading[2]) }),
      );
      continue;
    }
    const bullet = raw.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      paras.push(
        new Paragraph({ bullet: { level: Math.floor(bullet[1].length / 2) }, children: inlineRuns(bullet[2]) }),
      );
      continue;
    }
    if (raw.trim()) paras.push(new Paragraph({ children: inlineRuns(raw) }));
  }
  return paras;
}

/** 匯出 Word (.docx)：由 Markdown 原文產生 */
export async function exportDocx(report: Report): Promise<boolean> {
  const doc = new Document({ sections: [{ children: markdownToParagraphs(report.raw_notes) }] });
  const blob = await Packer.toBlob(doc);
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));

  const path = await save({
    defaultPath: `日報_${report.date}.docx`,
    filters: [{ name: "Word", extensions: ["docx"] }],
  });
  if (!path) return false;
  await invoke("write_binary_file", { path, bytes });
  return true;
}

/** 共用樣式（PDF 列印用） */
const PRINT_STYLE = `
  body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; color:#1e293b; padding:32px; line-height:1.7; }
  h1 { font-size:22px; border-bottom:2px solid #0284c7; padding-bottom:8px; }
  h2 { font-size:16px; color:#0369a1; margin-top:20px; }
  h3 { font-size:14px; color:#0f172a; margin:12px 0 2px; }
  h4 { font-size:13px; color:#334155; margin:10px 0 2px; }
  ul { margin:2px 0 0; padding-left:20px; }
  li { margin:2px 0; }
  strong { color:#0369a1; }`;

/** 把一段 body HTML 丟進隱藏 iframe 並開系統列印對話框（可存成 PDF；繼承系統字型，中文不亂碼） */
export function printHtml(title: string, bodyHtml: string): void {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>${title}</title><style>${PRINT_STYLE}</style></head><body>${bodyHtml}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow!.focus();
  setTimeout(() => {
    iframe.contentWindow!.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 250);
}

/** 把 Markdown 原文轉成 HTML 後開系統列印對話框（可存成 PDF） */
export function printMarkdown(title: string, md: string): void {
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md),
  );
  printHtml(title, html);
}

/** 匯出 PDF：把 Markdown 原文轉成 HTML 後列印 */
export function exportPdf(report: Report): void {
  printMarkdown(`日報_${report.date}`, report.raw_notes);
}

/** 複製任意文字到剪貼簿 */
export async function copyText(text: string): Promise<void> {
  await writeText(text);
}

/** 把任意文字存成 Markdown 檔 */
export async function saveMarkdownText(text: string, defaultName: string): Promise<boolean> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await invoke("write_text_file", { path, contents: text });
  return true;
}
