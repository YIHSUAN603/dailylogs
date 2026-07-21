import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { type Report } from "../types";
import { htmlToPlain, markdownToHtml } from "./html";

/** 複製純文字到剪貼簿（給通訊軟體貼上）：raw_notes 為 HTML，去標籤 */
export async function copyPlainText(report: Report): Promise<void> {
  await writeText(htmlToPlain(report.raw_notes));
}

/** 複製富文本（含格式與圖片）到剪貼簿：貼進 Google Docs / Word 會保留排版與圖片 */
export async function copyRich(report: Report): Promise<void> {
  const html = report.raw_notes;
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([htmlToPlain(html)], { type: "text/plain" }),
    }),
  ]);
}

/** 匯出自包含 HTML 檔（base64 圖片內嵌） */
export async function exportHtml(report: Report): Promise<boolean> {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>日報_${report.date}</title><style>${PRINT_STYLE}</style></head><body>${report.raw_notes}</body></html>`;
  const path = await save({
    defaultPath: `日報_${report.date}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return false;
  await invoke("write_text_file", { path, contents: html });
  return true;
}

/** 組出 Word 可開啟的 HTML 文件（保留排版與 base64 圖片） */
function wordHtml(title: string, bodyHtml: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${title}</title>
<style>@page { size: A4; margin: 2cm; }
body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; line-height:1.7; }
img { max-width:100%; }
table { border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 4px 8px; }</style></head>
<body>${bodyHtml}</body></html>`;
}

/** 匯出 Word：輸出 Word 相容 HTML（.doc），保留排版與內嵌圖片 */
export async function exportDocx(report: Report): Promise<boolean> {
  const path = await save({
    defaultPath: `日報_${report.date}.doc`,
    filters: [{ name: "Word", extensions: ["doc"] }],
  });
  if (!path) return false;
  await invoke("write_text_file", { path, contents: wordHtml(`日報_${report.date}`, report.raw_notes) });
  return true;
}

/** 共用樣式（HTML / PDF 列印用） */
const PRINT_STYLE = `
  body { font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif; color:#1e293b; padding:32px; line-height:1.7; }
  h1 { font-size:22px; border-bottom:2px solid #0284c7; padding-bottom:8px; }
  h2 { font-size:16px; color:#0369a1; margin-top:20px; }
  h3 { font-size:14px; color:#0f172a; margin:12px 0 2px; }
  h4 { font-size:13px; color:#334155; margin:10px 0 2px; }
  ul { margin:2px 0 0; padding-left:20px; }
  li { margin:2px 0; }
  strong { color:#0369a1; }
  img { max-width:100%; }
  table { border-collapse: collapse; }
  td, th { border:1px solid #cbd5e1; padding:4px 8px; }`;

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

/** 把 Markdown 原文轉成 HTML 後開系統列印對話框（給彙整報告用） */
export function printMarkdown(title: string, md: string): void {
  printHtml(title, markdownToHtml(md));
}

/** 匯出 PDF：raw_notes 本身即 HTML，直接列印 */
export function exportPdf(report: Report): void {
  printHtml(`日報_${report.date}`, report.raw_notes);
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
