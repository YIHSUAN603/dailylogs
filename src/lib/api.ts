import { invoke } from "@tauri-apps/api/core";
import type { Report, ReportMeta, SearchHit, Summary, SummaryMeta, Task } from "../types";

/** 取得所有日報（側欄用），依日期新到舊 */
export function listReports(): Promise<ReportMeta[]> {
  return invoke("list_reports");
}

/** 取得某日日報，不存在回傳 null */
export function getReport(date: string): Promise<Report | null> {
  return invoke("get_report", { date });
}

/** 關鍵字搜尋日報（內容 + 原始記事 + 標籤），依日期新到舊 */
export function searchReports(keyword: string): Promise<SearchHit[]> {
  return invoke("search_reports", { keyword });
}

/** 取得日期區間內（含頭尾）的所有日報 */
export function listReportsInRange(start: string, end: string): Promise<Report[]> {
  return invoke("list_reports_in_range", { start, end });
}

/** 新增/更新一份日報，回傳更新後的 updated_at */
export function saveReport(report: Report): Promise<string> {
  return invoke("save_report", { report });
}

/** 刪除某日日報 */
export function deleteReport(date: string): Promise<void> {
  return invoke("delete_report", { date });
}

/** 新增/更新一份彙整報告，回傳該筆 id */
export function saveSummary(summary: Summary): Promise<number> {
  return invoke("save_summary", { summary });
}

/** 取得所有彙整報告（清單用），依結束日期新到舊 */
export function listSummaries(): Promise<SummaryMeta[]> {
  return invoke("list_summaries");
}

/** 取得某份彙整報告，不存在回傳 null */
export function getSummary(id: number): Promise<Summary | null> {
  return invoke("get_summary", { id });
}

/** 刪除某份彙整報告 */
export function deleteSummary(id: number): Promise<void> {
  return invoke("delete_summary", { id });
}

/** 取得所有工作項目 */
export function listTasks(): Promise<Task[]> {
  return invoke("list_tasks");
}

/** 新增/更新一筆工作項目，回傳寫入後的完整 Task */
export function saveTask(task: Task): Promise<Task> {
  return invoke("save_task", { task });
}

/** 刪除某筆工作項目 */
export function deleteTask(id: number): Promise<void> {
  return invoke("delete_task", { id });
}

/** 讀取設定值 */
export function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}

/** 寫入設定值 */
export function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

/** 讀取 GitHub token（OS keychain 優先，退回 settings 表），沒有時回傳空字串 */
export function getGithubToken(): Promise<string> {
  return invoke("get_github_token");
}

/** 寫入 GitHub token（OS keychain 優先，退回 settings 表） */
export function setGithubToken(value: string): Promise<void> {
  return invoke("set_github_token", { value });
}

/** 取得某日標籤 */
export function getReportTags(date: string): Promise<string[]> {
  return invoke("get_report_tags", { date });
}

/** 設定某日標籤（整批覆蓋） */
export function setReportTags(date: string, tags: string[]): Promise<void> {
  return invoke("set_report_tags", { date, tags });
}

/** 呼叫 AI（prompt → CLI → 輸出文字） */
export function runAi(prompt: string): Promise<string> {
  return invoke("run_ai", { prompt });
}

/** 從 GitHub 取得某日該作者的 commit（組好的文字） */
export function githubCollectCommits(date: string): Promise<string> {
  return invoke("github_collect_commits", { date });
}

/** 測試 GitHub 連線，回傳所有 owner 的 repo 總數 */
export function githubTestConnection(): Promise<number> {
  return invoke("github_test_connection");
}

/** 列出所有 owner 的 repo 名稱（給工作面板匯入專案用） */
export function githubListRepos(): Promise<string[]> {
  return invoke("github_list_repos");
}

/** 讀取文字檔（路徑由前端的開檔對話框取得，給匯入用） */
export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

/** 匯出整個資料庫成 JSON 字串 */
export function exportAll(): Promise<string> {
  return invoke("export_all");
}

/** 從 JSON 字串匯入資料（以日期 upsert 合併），回傳匯入的日報份數 */
export function importAll(json: string): Promise<number> {
  return invoke("import_all", { json });
}

/** 設定 key */
export const AI_COMMAND_KEY = "ai_command";
export const AI_TIMEOUT_KEY = "ai_timeout_secs"; // AI 逾時秒數（正整數字串；須與 commands.rs 的 AI_TIMEOUT_KEY 一致）
export const REPORT_TEMPLATE_KEY = "report_template"; // 新建日報時預填的 Markdown 範本
export const GITHUB_API_URL_KEY = "github_api_url"; // GitHub REST API 位址（空＝預設 api.github.com）
export const GITHUB_OWNERS_KEY = "github_owners"; // owner（org 或使用者）JSON 字串陣列
export const GITHUB_AUTHOR_KEY = "github_author"; // 作者比對關鍵字（逗號分隔，包含比對 login/name/email）
export const GITHUB_REPOS_KEY = "github_repos"; // 匯入的 GitHub repo 名稱（JSON 陣列）
export const THEME_ACCENT_KEY = "theme_accent"; // 主色名稱（AccentName）
export const THEME_MODE_KEY = "theme_mode"; // 淺/深色模式（light | dark | system）
