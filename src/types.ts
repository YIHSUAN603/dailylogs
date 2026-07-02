export type ReportStatus = "draft" | "final";

/** 一個分類底下的四個面向 */
export interface Category {
  project: string; // 專案（大類）；可為空（舊資料）
  name: string;
  done: string;
  doing: string;
  blockers: string;
  tomorrow: string;
}

/** 日報：以分類為主結構 */
export interface Report {
  date: string; // YYYY-MM-DD
  status: ReportStatus;
  categories: Category[];
  raw_notes: string;
  updated_at: string;
}

/** 側欄精簡資訊 */
export interface ReportMeta {
  date: string;
  status: ReportStatus;
  updated_at: string;
}

/** 關鍵字搜尋的單筆結果 */
export interface SearchHit {
  date: string;
  status: ReportStatus;
  snippet: string;
}

/** 彙整報告的種類 */
export type SummaryKind = "weekly" | "monthly" | "custom";

/** 一份彙整報告（週報/月報/自訂區間） */
export interface Summary {
  id?: number; // 新建時不帶，後端回傳 id
  kind: SummaryKind;
  start_date: string;
  end_date: string;
  title: string;
  content: string; // Markdown
  updated_at?: string;
}

/** 彙整報告清單用的精簡資訊 */
export interface SummaryMeta {
  id: number;
  kind: SummaryKind;
  start_date: string;
  end_date: string;
  title: string;
  updated_at: string;
}

/** 分類底下的四個面向（順序即顯示順序） */
export const ASPECTS = [
  { key: "done", label: "完成" },
  { key: "doing", label: "進行中" },
  { key: "blockers", label: "問題" },
  { key: "tomorrow", label: "明日" },
] as const;

export function emptyReport(date: string): Report {
  return {
    date,
    status: "draft",
    categories: [],
    raw_notes: "",
    updated_at: "",
  };
}

/** 工作項目狀態 */
export type TaskStatus = "todo" | "doing" | "done" | "hold";

/** 工作項目優先序 */
export type TaskPriority = "low" | "normal" | "high";

/** 一筆工作項目（持續任務，跨多天存在） */
export interface Task {
  id?: number; // 新建時不帶，後端回傳 id
  title: string;
  status: TaskStatus;
  project: string;
  priority: TaskPriority;
  due_date: string | null; // YYYY-MM-DD 或 null
  notes: string; // Markdown
  tags: string[];
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** 狀態顯示順序與標籤 */
export const TASK_STATUSES = [
  { key: "todo", label: "待辦" },
  { key: "doing", label: "進行中" },
  { key: "done", label: "完成" },
  { key: "hold", label: "擱置" },
] as const;

/** 優先序顯示順序與標籤（由高到低） */
export const TASK_PRIORITIES = [
  { key: "high", label: "高" },
  { key: "normal", label: "中" },
  { key: "low", label: "低" },
] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待辦",
  doing: "進行中",
  done: "完成",
  hold: "擱置",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "高",
  normal: "中",
  low: "低",
};

export function emptyTask(): Task {
  return {
    title: "",
    status: "todo",
    project: "",
    priority: "normal",
    due_date: null,
    notes: "",
    tags: [],
    completed_at: null,
  };
}
