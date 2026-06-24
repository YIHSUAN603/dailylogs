import { ASPECTS, emptyCategory, type AspectKey, type Category, type Report } from "../types";
import { groupByProject, reportToEditableText, toItems } from "./format";
import { runAi } from "./api";

/** 把目前的日報組成文字（給 AI 當輸入），含專案 > 子分類 > 面向 */
function draftText(report: Report): string {
  if (report.categories.length === 0) return "（目前沒有分類草稿）";
  return reportToEditableText(report).trim();
}

/** 要求 AI 嚴格輸出的「分類為主 + 面向條列」格式說明 */
const FORMAT_RULE = `請「只」輸出以「專案（大類）> 子分類 > 四面向」為結構的日報，格式如下，不要任何前言、結語或其他說明：

# 專案名稱（例如某系統、某客戶專案）
## 子分類（該專案下的主題或模組）
### 完成
- 項目一
- 項目二
### 進行中
- 項目
### 問題
- 無
### 明日
- 項目
## 另一個子分類
### 完成
- 項目

# 另一個專案
## 子分類
### 完成
- 項目

規則：
- 可以有多個專案（以「# 」開頭），每個專案底下可有多個子分類（以「## 」開頭）。
- 每個子分類都要包含「完成 / 進行中 / 問題 / 明日」四個 ### 小節；該面向沒有內容就寫「- 無」。
- 每個項目自成一行、以「- 」開頭，用語精簡專業。
- 依專案歸納；若實在無法判斷專案，可只用一個專案名涵蓋。`;

/** 解析 AI 回傳的「分類為主 + 面向條列」格式 → Category[] */
export function parseCategories(text: string): Category[] {
  const clean = text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/m, "")
    .trim();

  const cats: Category[] = [];
  let project = "";
  let cur: Category | null = null;
  let aspect: AspectKey | null = null;
  const hasAny = (c: Category) => !!(c.name || ASPECTS.some((a) => c[a.key]));
  const flush = () => {
    if (cur && hasAny(cur)) cats.push(cur);
    cur = null;
    aspect = null;
  };

  for (const raw of clean.split("\n")) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^###\s+(.+)$/))) {
      // 面向
      const label = m[1].trim();
      aspect = ASPECTS.find((a) => label.includes(a.label))?.key ?? null;
    } else if ((m = line.match(/^##\s+(.+)$/))) {
      // 子分類
      flush();
      cur = emptyCategory(m[1].trim());
      cur.project = project;
    } else if ((m = line.match(/^#\s+(.+)$/))) {
      // 專案（大類）
      flush();
      project = m[1].trim();
    } else if (cur && aspect && line) {
      // 條列項目
      const item = line.replace(/^[\s•・\-*]+/, "").trim();
      if (item && item !== "無" && item !== "-") {
        cur[aspect] = cur[aspect] ? `${cur[aspect]}\n${item}` : item;
      }
    }
  }
  flush();
  return cats;
}

/** 零散記事 + 草稿 → 分類為主的日報 */
export async function organizeReport(report: Report): Promise<Category[]> {
  const prompt = `你是協助工程師撰寫「對主管的工作日報」的助理。請根據下方「零散記事」與「目前草稿」，整理成專業、條列清楚、以分類為主的繁體中文日報。請依專案或主題歸納分類。

${FORMAT_RULE}

【零散記事】
${report.raw_notes.trim() || "（無）"}

【目前草稿】
${draftText(report)}`;
  return parseCategories(await runAi(prompt));
}

/** 潤稿：保留內容只修語氣與錯字 */
export async function polishReport(report: Report): Promise<Category[]> {
  const prompt = `請將以下「分類為主」的工作日報潤飾得更專業通順，修正錯字與語氣，但「保留原本的事實、分類與重點」，不要新增或刪除實質內容。

${FORMAT_RULE}

【目前日報】
${draftText(report)}`;
  return parseCategories(await runAi(prompt));
}

/** 由 git commit 清單草擬分類為主的日報（commit 已依專案分組） */
export async function draftFromCommits(commitsText: string): Promise<Category[]> {
  const prompt = `以下是我今天在各 git 儲存庫的 commit 紀錄（已依專案 [專案名] 分組）。請把每個專案當成一個分類，據此草擬一份專業的繁體中文工作日報，把技術性 commit 訊息轉成主管易懂的工作描述。每個 commit 盡量化成一個獨立項目。

${FORMAT_RULE}

【今日 commit】
${commitsText}`;
  return parseCategories(await runAi(prompt));
}

/** 把多份日報彙整成週報/月報（回傳 Markdown 文字） */
export async function summarizeRange(reports: Report[], rangeLabel: string): Promise<string> {
  const daily = reports
    .map((r) => {
      const body = groupByProject(r.categories)
        .map((g) => {
          const cats = g.cats
            .map((c) => {
              const blocks = ASPECTS.filter((a) => toItems(c[a.key]).length).map(
                (a) => `    ${a.label}：${toItems(c[a.key]).join("、")}`,
              );
              return `  - ${c.name || "未命名"}\n${blocks.join("\n")}`;
            })
            .join("\n");
          return g.name ? `# ${g.name}\n${cats}` : cats;
        })
        .join("\n");
      return `【${r.date}】\n${body || "（無內容）"}`;
    })
    .join("\n\n");

  const prompt = `以下是我在「${rangeLabel}」期間每天的工作日報。請彙整成一份給主管看的「工作週報/月報」。

要求：
- 以「專案或主題」分類；同一專案跨多天的事項歸併到同一個分類，不要按日期拆開。
- 每個分類下條列四個面向：本期完成重點、進行中、遇到的問題、下期計劃。
- 合併跨日重複或延續的事項，呈現整體進展而非流水帳；依重要性由高到低排序。
- 完成項用過去式、精簡專業地陳述成果（可量化就量化）；每個面向控制在 3-6 條，沒有內容的面向就省略。
- 用繁體中文、Markdown 格式（## 分類、**面向**、- 條列）。只輸出報告本身，不要前言或結語。

${daily}`;
  return (await runAi(prompt)).trim();
}

/** 自動產生 2-5 個分類標籤 */
export async function generateTags(report: Report): Promise<string[]> {
  const prompt = `根據以下工作日報內容，產生 2 到 5 個分類標籤（例如：專案名稱、使用技術、工作類型）。只輸出標籤，以半形逗號分隔，不要任何其他文字。

${draftText(report)}`;
  const out = await runAi(prompt);
  return out
    .split(/[,，\n]/)
    .map((t) => t.replace(/^[-#\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}
