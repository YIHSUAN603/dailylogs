import { type Report, type Task, TASK_STATUS_LABELS } from "../types";
import { runAi } from "./api";

/** 取得目前日報的 Markdown 原文（給 AI 當輸入） */
function draftText(report: Report): string {
  return report.raw_notes.trim() || "（目前沒有內容）";
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
### 待辦
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

/** 零散記事 + 草稿 + 工作面板工項 → 分類為主的日報（回傳 Markdown 文字） */
export async function organizeReport(
  report: Report,
  tasks: Task[],
): Promise<string> {
  const doneToday = tasks.filter(
    (t) =>
      t.status === "done" &&
      (t.completed_at ?? "").slice(0, 10) === report.date,
  );
  const doing = tasks.filter((t) => t.status === "doing");

  if (
    !report.raw_notes.trim() &&
    doneToday.length === 0 &&
    doing.length === 0
  ) {
    throw new Error("沒有內容可整理（記事與工作項目都是空的）");
  }

  const taskBlock =
    doneToday.length || doing.length
      ? `

【工作面板：今天完成的項目】
${doneToday.length ? doneToday.map(taskLine).join("\n") : "（無）"}

【工作面板：進行中的項目】
${doing.length ? doing.map(taskLine).join("\n") : "（無）"}`
      : "";

  const prompt = `你是協助工程師撰寫「對主管的工作日報」的助理。請根據下方「零散記事」「目前草稿」與「工作面板的工作項目」，整理成專業、條列清楚、以分類為主的繁體中文日報，並讓主管讀了不會想追問或挑語病。請依專案或主題歸納分類。

整理時請特別注意：
- 用詞具體明確，避免「處理了一些」「做了相關調整」「優化了一下」這類含糊籠統的寫法；說清楚做了什麼、影響什麼。
- 據實陳述進度，不要把未完成的事寫得像已完成；完成的用肯定語氣，進行中的就標明在進行中。
- 移除「應該」「大概」「可能」等不確定語氣（除非確實是待確認事項，則明確標示為待確認）。
- 成果能量化就量化（數量、時間、版本、影響範圍），讓主管一眼看出價值。
- 精簡贅字與口語，語氣平實專業，不誇大也不卑微。
- 只根據提供的記事、草稿與工作項目整理，不要臆測或杜撰未提及的內容。
- 同一件事若同時出現在記事與工作項目，請歸併為一條、不要重複列。

${FORMAT_RULE}

【零散記事】
${report.raw_notes.trim() || "（無）"}

【目前草稿】
${draftText(report)}${taskBlock}`;
  return (await runAi(prompt)).trim();
}

/** 潤稿：保留內容只修語氣與錯字（回傳 Markdown 文字） */
export async function polishReport(report: Report): Promise<string> {
  const prompt = `請將以下「分類為主」的工作日報潤飾成一份「主管讀了不會想追問或挑語病」的版本。修正錯字與語氣，並在「保留原本的事實、分類與重點」的前提下調整用詞，不要新增或刪除實質內容。

潤飾時請特別注意：
- 用詞具體明確，避免「處理了一些」「做了相關調整」「優化了一下」這類含糊籠統的寫法；說清楚做了什麼、影響什麼。
- 據實陳述進度，不要把未完成的事寫得像已完成；完成的用肯定語氣，進行中的就標明在進行中。
- 移除「應該」「大概」「可能」等不確定語氣（除非確實是待確認事項，則明確標示為待確認）。
- 成果能量化就量化（數量、時間、版本、影響範圍），讓主管一眼看出價值。
- 精簡贅字與口語，語氣平實專業，不誇大也不卑微。

${FORMAT_RULE}

【目前日報】
${draftText(report)}`;
  return (await runAi(prompt)).trim();
}

/** 把多份日報彙整成週報/月報（回傳 Markdown 文字） */
export async function summarizeRange(
  reports: Report[],
  rangeLabel: string,
): Promise<string> {
  const daily = reports
    .map((r) => `【${r.date}】\n${r.raw_notes.trim() || "（無內容）"}`)
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

/** 把一筆工作項目組成給 AI 讀的一行描述 */
function taskLine(t: Task): string {
  const proj = t.project.trim() ? `[${t.project.trim()}] ` : "";
  const notes = t.notes.trim()
    ? `（細節：${t.notes.trim().replace(/\s+/g, " ")}）`
    : "";
  return `- ${proj}${t.title.trim()}（狀態：${TASK_STATUS_LABELS[t.status]}）${notes}`;
}

/** AI 拆解出的單筆工項草稿 */
export interface TaskDraft {
  title: string;
  notes: string;
}

/** 從 AI 回應中解析出工項草稿：先試 JSON 陣列，失敗則退回逐行抓條列 */
function parseTaskDrafts(raw: string): TaskDraft[] {
  // 容忍 ```json 包裹或多餘前後文：抓第一個 [ 到最後一個 ]
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(arr)) {
        const drafts = arr
          .map(
            (o): TaskDraft => ({
              title: typeof o?.title === "string" ? o.title.trim() : "",
              notes: typeof o?.notes === "string" ? o.notes.trim() : "",
            }),
          )
          .filter((d) => d.title);
        if (drafts.length) return drafts;
      }
    } catch {
      // 落到下方 fallback
    }
  }
  // Fallback：逐行抓以 - / * / 數字. 開頭的行當標題
  const drafts = raw
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map((title): TaskDraft => ({ title, notes: "" }));
  return drafts;
}

/**
 * 把一段工作描述/文件內容拆成多筆可獨立執行的工項（每筆含標題 + 細節），
 * 回傳草稿陣列。AI 輸出無法解析或為空則丟出錯誤。
 */
export async function breakdownToTasks(input: string): Promise<TaskDraft[]> {
  const prompt = `請把以下這段工作描述（可能是一個大任務，或一份文件/筆記）拆解成數筆「可以各自獨立執行、追蹤的工作項目」。

要求：
- 每筆工項給一個精簡具體的「標題」，與一段「細節說明」（notes，可含要做的步驟、驗收要點或注意事項）。
- 依執行先後或重要性排序；粒度適中，不要細到瑣碎、也不要籠統到無法執行。
- 只根據提供的內容拆解，不要臆測或杜撰未提及的工作。
- 用繁體中文。
- 「只」輸出一個 JSON 陣列，格式為 [{"title": "...", "notes": "..."}]，不要任何前言、結語、說明或程式碼框（不要 \`\`\`）。

【工作描述】
${input.trim()}`;
  const out = await runAi(prompt);
  const drafts = parseTaskDrafts(out);
  if (!drafts.length) throw new Error("AI 沒有拆出可用的工項");
  return drafts;
}

/** 把某專案的所有工作項目彙整成進度報告，回傳 Markdown 文字 */
export async function summarizeProject(
  tasks: Task[],
  projectName: string,
): Promise<string> {
  const list = tasks.map(taskLine).join("\n");
  const label = projectName.trim() || "（未分類）";
  const prompt = `以下是「${label}」這個專案目前的所有工作項目（含狀態）。請彙整成一份給主管看的「專案進度報告」。

要求：
- 開頭用一兩句話總結整體進度。
- 條列：已完成重點、進行中、待辦/後續計劃、遇到的問題或風險（沒有的面向就省略）。
- 合併相關項目，呈現整體進展而非逐項流水帳；依重要性排序。
- 用繁體中文、Markdown 格式。只輸出報告本身，不要前言或結語。

【工作項目】
${list}`;
  return (await runAi(prompt)).trim();
}

/** 把 AI 回應切成乾淨的標籤陣列（去符號、去空、最多 5 個） */
function parseTags(out: string): string[] {
  return out
    .split(/[,，\n]/)
    .map((t) => t.replace(/^[-#\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** 自動產生 2-5 個分類標籤 */
export async function generateTags(report: Report): Promise<string[]> {
  const prompt = `根據以下工作日報內容，產生 2 到 5 個分類標籤（例如：專案名稱、使用技術、工作類型）。只輸出標籤，以半形逗號分隔，不要任何其他文字。

${draftText(report)}`;
  return parseTags(await runAi(prompt));
}

/** 為單筆工作項目自動產生 2-5 個分類標籤 */
export async function generateTaskTags(task: Task): Promise<string[]> {
  const proj = task.project.trim() ? `\n專案：${task.project.trim()}` : "";
  const notes = task.notes.trim() ? `\n細節：${task.notes.trim()}` : "";
  const prompt = `根據以下工作項目，產生 2 到 5 個分類標籤（例如：專案名稱、使用技術、工作類型）。只輸出標籤，以半形逗號分隔，不要任何其他文字。

標題：${task.title.trim() || "（無標題）"}${proj}${notes}`;
  return parseTags(await runAi(prompt));
}
