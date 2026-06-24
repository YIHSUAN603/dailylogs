import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { ASPECTS, type Category, type Report } from "../types";
import { groupByProject, reportToMarkdown, reportToPlainText, toItems } from "./format";

/** 分類中有內容的面向 */
function filledAspects(c: Category) {
  return ASPECTS.filter((a) => toItems(c[a.key]).length > 0);
}

/** 分類是否有任何內容 */
function hasContent(c: Category): boolean {
  return !!(c.name.trim() || filledAspects(c).length);
}

const CJK_FONT = "Microsoft JhengHei";

/** 複製純文字到剪貼簿（給通訊軟體貼上） */
export async function copyPlainText(report: Report): Promise<void> {
  await writeText(reportToPlainText(report));
}

/** 複製 Markdown 到剪貼簿 */
export async function copyMarkdown(report: Report): Promise<void> {
  await writeText(reportToMarkdown(report));
}

/** 匯出 Markdown 檔 */
export async function exportMarkdown(report: Report): Promise<boolean> {
  const path = await save({
    defaultPath: `日報_${report.date}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await invoke("write_text_file", { path, contents: reportToMarkdown(report) });
  return true;
}

/** 匯出 Word (.docx) */
export async function exportDocx(report: Report): Promise<boolean> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `工作日報 ${report.date}`, font: CJK_FONT, bold: true })],
    }),
  ];

  for (const g of groupByProject(report.categories)) {
    const cats = g.cats.filter(hasContent);
    if (cats.length === 0) continue;
    if (g.name) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: g.name, font: CJK_FONT, bold: true })],
        }),
      );
    }
    const subHeading = g.name ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2;
    for (const c of cats) {
      children.push(
        new Paragraph({
          heading: subHeading,
          children: [
            new TextRun({ text: c.name.trim() || "未命名分類", font: CJK_FONT, bold: true }),
          ],
        }),
      );
      for (const a of filledAspects(c)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: a.label, font: CJK_FONT, bold: true })],
          }),
        );
        for (const item of toItems(c[a.key])) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: item, font: CJK_FONT })],
            }),
          );
        }
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
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

/** 匯出 PDF：把日報組成 HTML 後列印 */
export function exportPdf(report: Report): void {
  const sections = groupByProject(report.categories)
    .map((g) => {
      const cats = g.cats.filter(hasContent);
      if (cats.length === 0) return "";
      // 有專案：子分類 h3、面向 h4；無專案：子分類 h2、面向 h3（維持舊樣）
      const subTag = g.name ? "h3" : "h2";
      const aspectTag = g.name ? "h4" : "h3";
      const body = cats
        .map((c) => {
          const aspects = filledAspects(c)
            .map((a) => {
              const items = toItems(c[a.key])
                .map((it) => `<li>${escapeHtml(it)}</li>`)
                .join("");
              return `<${aspectTag}>${a.label}</${aspectTag}><ul>${items}</ul>`;
            })
            .join("");
          return `<${subTag}>${escapeHtml(c.name.trim() || "未命名分類")}</${subTag}>${aspects}`;
        })
        .join("");
      return g.name ? `<h2>${escapeHtml(g.name)}</h2>${body}` : body;
    })
    .join("");
  printHtml(`日報_${report.date}`, `<h1>工作日報 ${report.date}</h1>${sections}`);
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
