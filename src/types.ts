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

export type AspectKey = (typeof ASPECTS)[number]["key"];

export function emptyCategory(name = ""): Category {
  return { project: "", name, done: "", doing: "", blockers: "", tomorrow: "" };
}

export function emptyReport(date: string): Report {
  return {
    date,
    status: "draft",
    categories: [],
    raw_notes: "",
    updated_at: "",
  };
}
