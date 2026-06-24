import { ASPECTS, type Category, type Report } from "../types";

/** 取得本地時區的今天 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** 把面向欄位（一行一項）拆成項目陣列，去掉既有的項目符號 */
export function toItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[\s•・\-*]+/, "").trim())
    .filter(Boolean);
}

/** 分類是否有任何內容（名稱或任一面向） */
function hasContent(c: Category): boolean {
  return !!(c.name.trim() || ASPECTS.some((a) => c[a.key].trim()));
}

/** 依專案（大類）分群；同名專案歸一組，保留首次出現順序。空專案名為一組（name: ""） */
export function groupByProject(cats: Category[]): { name: string; cats: Category[] }[] {
  const groups: { name: string; cats: Category[] }[] = [];
  for (const c of cats) {
    const key = c.project.trim();
    let g = groups.find((x) => x.name === key);
    if (!g) {
      g = { name: key, cats: [] };
      groups.push(g);
    }
    g.cats.push(c);
  }
  return groups;
}

/** 日報 → Markdown（專案 > 子分類 > 面向）。標題 #、專案 ##、子分類 ###、面向粗體 */
export function reportToMarkdown(report: Report): string {
  const lines: string[] = [`# 工作日報 ${report.date}`, ""];
  for (const g of groupByProject(report.categories)) {
    const cats = g.cats.filter(hasContent);
    if (cats.length === 0) continue;
    const sub = g.name ? "###" : "##"; // 有專案才縮一層
    if (g.name) lines.push(`## ${g.name}`, "");
    for (const c of cats) {
      lines.push(`${sub} ${c.name.trim() || "未命名分類"}`, "");
      for (const a of ASPECTS) {
        const items = toItems(c[a.key]);
        if (items.length === 0) continue;
        lines.push(`**${a.label}**`);
        lines.push(...items.map((it) => `- ${it}`), "");
      }
    }
  }
  return lines.join("\n").trim() + "\n";
}

/** 日報 → 可編輯文字（# 專案 / ## 子分類 / ### 面向 / - 條列，與 parseCategories 互為逆轉換） */
export function reportToEditableText(report: Report): string {
  const lines: string[] = [];
  for (const g of groupByProject(report.categories)) {
    const cats = g.cats.filter(hasContent);
    if (cats.length === 0) continue;
    if (g.name) lines.push(`# ${g.name}`);
    for (const c of cats) {
      lines.push(`## ${c.name.trim() || "未命名分類"}`);
      for (const a of ASPECTS) {
        lines.push(`### ${a.label}`);
        const items = toItems(c[a.key]);
        lines.push(...(items.length ? items.map((it) => `- ${it}`) : ["- 無"]));
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim() + "\n";
}

/** 日報 → 純文字（給通訊軟體貼上）。專案 ◆、子分類 ▸、面向 [標籤] */
export function reportToPlainText(report: Report): string {
  const lines: string[] = [`【工作日報 ${report.date}】`, ""];
  for (const g of groupByProject(report.categories)) {
    const cats = g.cats.filter(hasContent);
    if (cats.length === 0) continue;
    if (g.name) lines.push(`◆ ${g.name}`);
    for (const c of cats) {
      lines.push(g.name ? `  ▸ ${c.name.trim() || "未命名分類"}` : `◆ ${c.name.trim() || "未命名分類"}`);
      for (const a of ASPECTS) {
        const items = toItems(c[a.key]);
        if (items.length === 0) continue;
        lines.push(`[${a.label}]`);
        lines.push(...items.map((it) => `  - ${it}`));
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
