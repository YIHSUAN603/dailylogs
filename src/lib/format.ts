import { ASPECTS, type Category, type Report } from "../types";

/** Date → YYYY-MM-DD（本地時區，避免 UTC 偏移） */
export function dateStr(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 取得本地時區的今天 YYYY-MM-DD */
export function todayStr(): string {
  return dateStr(new Date());
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

/** Markdown → 純文字（給通訊軟體貼上）：去標題 #、清單符號、行內粗體，保留文字與縮排 */
export function markdownToPlain(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/^(\s*)#{1,6}\s+/, "$1").replace(/^(\s*)[-*]\s+/, "$1• "))
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}

/** 日報 → 可編輯文字（# 專案 / ## 子分類 / ### 面向 / - 條列）。供舊 categories 資料遷移為 Markdown 用 */
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

/**
 * 從 commits 區塊（# 專案 外層標頭 + [repo] 子標頭 + "- 標題" 條列）中，
 * 去掉「條列文字已出現在 existing 內任一 "- " 條列」的項目。
 * 某專案 / repo 底下全被去除時，連同其標頭一起略過。沒有新項目時回傳空字串。
 */
export function dedupeCommits(existing: string, commits: string): string {
  const seen = new Set(
    existing
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim()),
  );
  const out: string[] = [];
  let pendingProject: string | null = null; // # 專案 標頭暫存
  let pendingRepo: string | null = null; // [repo] 標頭暫存
  for (const line of commits.split("\n")) {
    const t = line.trim();
    if (t.startsWith("# ")) {
      pendingProject = line; // 換專案，重置 repo 標頭
      pendingRepo = null;
    } else if (t.startsWith("[") && t.endsWith("]")) {
      pendingRepo = line; // 標頭暫存，底下有新 commit 才寫入
    } else if (t.startsWith("- ")) {
      const body = t.slice(2).trim();
      if (seen.has(body)) continue; // 已存在 → 跳過
      seen.add(body); // 同次附加內也不重覆
      if (pendingProject !== null) {
        if (out.length > 0) out.push(""); // 專案間空行，維持 format_commits 排版
        out.push(pendingProject);
        pendingProject = null;
      }
      if (pendingRepo !== null) {
        out.push(pendingRepo);
        pendingRepo = null;
      }
      out.push(line);
    }
  }
  return out.join("\n");
}
