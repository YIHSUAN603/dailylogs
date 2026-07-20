use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// 一個分類（通常是專案或主題），底下含四個面向
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    #[serde(default)]
    pub project: String, // 專案（大類）；舊資料無此欄，預設空字串
    pub name: String,     // 子分類/主題名稱
    pub done: String,     // 完成
    pub doing: String,    // 進行中
    pub blockers: String, // 問題
    pub tomorrow: String, // 明日
}

/// 一份完整日報（以分類為主結構）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Report {
    pub date: String,   // YYYY-MM-DD，一天一份
    pub status: String, // "draft" | "final"
    pub categories: Vec<Category>,
    pub raw_notes: String, // 零散記事原料，給 AI 潤飾用
    pub updated_at: String,
}

/// 側欄用的精簡資訊
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportMeta {
    pub date: String,
    pub status: String,
    pub updated_at: String,
}

/// 一份彙整報告（週報/月報/自訂區間），存進 DB、可多版本
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Summary {
    #[serde(default)]
    pub id: Option<i64>, // 新建時為 None，後端 autoincrement
    pub kind: String, // "weekly" | "monthly" | "custom"
    pub start_date: String,
    pub end_date: String,
    pub title: String,
    pub content: String, // Markdown
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// 彙整報告清單用的精簡資訊
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SummaryMeta {
    pub id: i64,
    pub kind: String,
    pub start_date: String,
    pub end_date: String,
    pub title: String,
    pub updated_at: String,
}

/// 一筆工作項目（持續任務，跨多天存在）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    #[serde(default)]
    pub id: Option<i64>, // 新建時為 None，後端 autoincrement
    pub title: String,
    pub status: String,   // "todo" | "doing" | "done" | "hold"
    pub project: String,  // 專案/大類；可為空
    pub priority: String, // "low" | "normal" | "high"
    #[serde(default)]
    pub due_date: Option<String>, // YYYY-MM-DD，可為 None
    pub notes: String,    // Markdown 細節
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub completed_at: Option<String>, // 標記完成時間，可為 None
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// 關鍵字搜尋的單筆結果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchHit {
    pub date: String,
    pub status: String,
    pub snippet: String, // 命中關鍵字附近的上下文片段（純文字，前端負責 highlight）
}

/// 開啟（或建立）資料庫並初始化結構
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    init_schema(&conn)?;
    Ok(conn)
}

/// 建表與遷移（open 與測試用的記憶體資料庫共用）
fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reports (
            date       TEXT PRIMARY KEY,
            status     TEXT NOT NULL DEFAULT 'draft',
            categories TEXT NOT NULL DEFAULT '[]',
            raw_notes  TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS report_tags (
            report_date TEXT NOT NULL,
            tag_id      INTEGER NOT NULL,
            PRIMARY KEY (report_date, tag_id)
        );

        CREATE TABLE IF NOT EXISTS summaries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT NOT NULL DEFAULT 'weekly',
            start_date  TEXT NOT NULL,
            end_date    TEXT NOT NULL,
            title       TEXT NOT NULL DEFAULT '',
            content     TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'todo',
            project      TEXT NOT NULL DEFAULT '',
            priority     TEXT NOT NULL DEFAULT 'normal',
            due_date     TEXT,
            notes        TEXT NOT NULL DEFAULT '',
            tags         TEXT NOT NULL DEFAULT '[]',
            completed_at TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );",
    )?;
    // 舊資料庫（四段式）遷移：補上 categories 欄位（已存在則忽略錯誤）
    let _ = conn.execute(
        "ALTER TABLE reports ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    Ok(())
}

/// 側欄：所有日報，依日期新到舊
pub fn list_reports(conn: &Connection) -> rusqlite::Result<Vec<ReportMeta>> {
    let mut stmt =
        conn.prepare("SELECT date, status, updated_at FROM reports ORDER BY date DESC")?;
    let rows = stmt.query_map([], |r| {
        Ok(ReportMeta {
            date: r.get(0)?,
            status: r.get(1)?,
            updated_at: r.get(2)?,
        })
    })?;
    rows.collect()
}

/// 關鍵字搜尋：全表掃描，比對每份日報的內容（四面向 + 分類/專案名）、原始記事與標籤。
/// 大小寫不敏感；命中即回傳一段含關鍵字的上下文片段。結果依日期新到舊。
pub fn search_reports(conn: &Connection, keyword: &str) -> rusqlite::Result<Vec<SearchHit>> {
    let kw = keyword.trim().to_lowercase();
    if kw.is_empty() {
        return Ok(Vec::new());
    }

    // 一次撈全部標籤，整理成 date -> [tag] 的對照
    let mut tags_by_date: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT rt.report_date, t.name FROM report_tags rt
             JOIN tags t ON rt.tag_id = t.id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (date, name) = row?;
            tags_by_date.entry(date).or_default().push(name);
        }
    }

    let mut stmt =
        conn.prepare("SELECT date, status, categories, raw_notes FROM reports ORDER BY date DESC")?;
    let rows = stmt.query_map([], |r| {
        let categories_json: String = r.get(2)?;
        let categories: Vec<Category> = json_or_default(&categories_json, "reports.categories");
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            categories,
            r.get::<_, String>(3)?,
        ))
    })?;

    let mut hits = Vec::new();
    for row in rows {
        let (date, status, categories, raw_notes) = row?;

        // 組出可搜尋片段：每個分類的非空欄位、原始記事、標籤
        let mut segments: Vec<String> = Vec::new();
        for c in &categories {
            for field in [
                &c.project,
                &c.name,
                &c.done,
                &c.doing,
                &c.blockers,
                &c.tomorrow,
            ] {
                if !field.trim().is_empty() {
                    segments.push(field.clone());
                }
            }
        }
        // raw_notes 現為 HTML；去標籤（含 <img> 內 base64）後才比對，避免污染命中與片段
        let raw_text = strip_html(&raw_notes);
        if !raw_text.trim().is_empty() {
            segments.push(raw_text);
        }
        if let Some(tags) = tags_by_date.get(&date) {
            if !tags.is_empty() {
                segments.push(
                    tags.iter()
                        .map(|t| format!("#{t}"))
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            }
        }

        // 找到第一個命中的 segment 即產生片段
        if let Some(seg) = segments.iter().find(|s| s.to_lowercase().contains(&kw)) {
            hits.push(SearchHit {
                date,
                status,
                snippet: make_snippet(seg, &kw),
            });
        }
    }
    Ok(hits)
}

/// 以命中位置為中心，取前後約 30 個字元的視窗（以字元為單位，避免切斷中文）。
fn make_snippet(text: &str, keyword_lower: &str) -> String {
    const WINDOW: usize = 30;
    let lower = text.to_lowercase();
    // 命中位置（byte index）→ 換算成字元索引
    let byte_pos = match lower.find(keyword_lower) {
        Some(p) => p,
        None => return text.chars().take(WINDOW * 2).collect(),
    };
    let char_pos = lower[..byte_pos].chars().count();

    let chars: Vec<char> = text.chars().collect();
    let start = char_pos.saturating_sub(WINDOW);
    let end = (char_pos + keyword_lower.chars().count() + WINDOW).min(chars.len());

    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.extend(chars[start..end].iter());
    if end < chars.len() {
        snippet.push('…');
    }
    snippet
}

/// 去掉 HTML 標籤與常見實體，讓搜尋以純文字為準（<img> 內的 base64 隨標籤一併移除）。
/// 手寫掃描以避免新增 regex 依賴。
fn strip_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    // 還原基本實體（&amp; 最後處理，避免二次解碼）
    out.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// 取得日期區間內（含頭尾）的所有日報，依日期由舊到新
pub fn list_reports_in_range(
    conn: &Connection,
    start: &str,
    end: &str,
) -> rusqlite::Result<Vec<Report>> {
    let mut stmt = conn.prepare(
        "SELECT date, status, categories, raw_notes, updated_at
         FROM reports WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC",
    )?;
    let rows = stmt.query_map([start, end], |r| {
        let categories_json: String = r.get(2)?;
        let categories: Vec<Category> = json_or_default(&categories_json, "reports.categories");
        Ok(Report {
            date: r.get(0)?,
            status: r.get(1)?,
            categories,
            raw_notes: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

/// 取得某日日報；不存在回傳 None
pub fn get_report(conn: &Connection, date: &str) -> rusqlite::Result<Option<Report>> {
    conn.query_row(
        "SELECT date, status, categories, raw_notes, updated_at
         FROM reports WHERE date = ?1",
        [date],
        |r| {
            let categories_json: String = r.get(2)?;
            let categories: Vec<Category> = json_or_default(&categories_json, "reports.categories");
            Ok(Report {
                date: r.get(0)?,
                status: r.get(1)?,
                categories,
                raw_notes: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    )
    .optional()
}

/// 新增或更新（upsert）一份日報，回傳更新後的 updated_at
pub fn save_report(conn: &Connection, report: &Report) -> rusqlite::Result<String> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let categories_json = serde_json::to_string(&report.categories).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO reports (date, status, categories, raw_notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(date) DO UPDATE SET
            status=?2, categories=?3, raw_notes=?4, updated_at=?5",
        rusqlite::params![
            report.date,
            report.status,
            categories_json,
            report.raw_notes,
            now
        ],
    )?;
    Ok(now)
}

/// 刪除某日日報
pub fn delete_report(conn: &Connection, date: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM reports WHERE date = ?1", [date])?;
    conn.execute("DELETE FROM report_tags WHERE report_date = ?1", [date])?;
    Ok(())
}

/// 從一列查詢結果組出 Task（欄位順序需與下方 SELECT 一致）
fn row_to_task(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    let tags_json: String = r.get(7)?;
    let tags: Vec<String> = json_or_default(&tags_json, "tasks.tags");
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        status: r.get(2)?,
        project: r.get(3)?,
        priority: r.get(4)?,
        due_date: r.get(5)?,
        notes: r.get(6)?,
        tags,
        completed_at: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

const TASK_COLS: &str =
    "id, title, status, project, priority, due_date, notes, tags, completed_at, created_at, updated_at";

/// 所有工作項目，依狀態與更新時間排序（細部過濾/排序由前端處理）
pub fn list_tasks(conn: &Connection) -> rusqlite::Result<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks ORDER BY updated_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_task)?;
    rows.collect()
}

/// 取得某筆工作項目；不存在回傳 None
pub fn get_task(conn: &Connection, id: i64) -> rusqlite::Result<Option<Task>> {
    conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
        [id],
        row_to_task,
    )
    .optional()
}

/// 新增或更新一筆工作項目。
/// `id` 為 None → INSERT；為 Some → UPSERT。狀態切到 done 時自動寫入 completed_at、
/// 切離 done 時清空。回傳含 id 與時間戳的完整 Task。
pub fn save_task(conn: &Connection, task: &Task) -> rusqlite::Result<Task> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let tags_json = serde_json::to_string(&task.tags).unwrap_or_else(|_| "[]".into());

    // 依目標狀態決定 completed_at：done → 沿用既有或設為現在；非 done → 清空
    let completed_at: Option<String> = if task.status == "done" {
        task.completed_at.clone().or_else(|| Some(now.clone()))
    } else {
        None
    };

    let id = match task.id {
        Some(id) => {
            conn.execute(
                "UPDATE tasks SET title=?2, status=?3, project=?4, priority=?5, due_date=?6,
                    notes=?7, tags=?8, completed_at=?9, updated_at=?10 WHERE id=?1",
                rusqlite::params![
                    id,
                    task.title,
                    task.status,
                    task.project,
                    task.priority,
                    task.due_date,
                    task.notes,
                    tags_json,
                    completed_at,
                    now
                ],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO tasks (title, status, project, priority, due_date, notes, tags,
                    completed_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                rusqlite::params![
                    task.title,
                    task.status,
                    task.project,
                    task.priority,
                    task.due_date,
                    task.notes,
                    tags_json,
                    completed_at,
                    now
                ],
            )?;
            conn.last_insert_rowid()
        }
    };

    // 回傳寫入後的完整資料（含 created_at，由 DB 為準）
    get_task(conn, id).map(|t| t.expect("剛寫入的 task 必定存在"))
}

/// 刪除某筆工作項目
pub fn delete_task(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    Ok(())
}

/// 解析 JSON 欄位；資料損毀時記錄警告並回傳預設值，避免整筆查詢失敗或內容無聲消失
fn json_or_default<T: serde::de::DeserializeOwned + Default>(raw: &str, ctx: &str) -> T {
    serde_json::from_str(raw).unwrap_or_else(|e| {
        eprintln!("[dailylogs] {ctx} 的 JSON 欄位解析失敗，以預設值代替：{e}");
        T::default()
    })
}

/// 讀取設定值，不存在回傳 None
pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .optional()
}

/// 寫入設定值（upsert）
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// 取得某日日報的標籤
pub fn get_report_tags(conn: &Connection, date: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t
         JOIN report_tags rt ON rt.tag_id = t.id
         WHERE rt.report_date = ?1 ORDER BY t.name",
    )?;
    let rows = stmt.query_map([date], |r| r.get(0))?;
    rows.collect()
}

/// 設定某日日報的標籤（整批覆蓋）
pub fn set_report_tags(conn: &Connection, date: &str, tags: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM report_tags WHERE report_date = ?1", [date])?;
    for name in tags {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [name])?;
        let id: i64 =
            conn.query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))?;
        conn.execute(
            "INSERT OR IGNORE INTO report_tags (report_date, tag_id) VALUES (?1, ?2)",
            rusqlite::params![date, id],
        )?;
    }
    Ok(())
}

/// 新增或更新一份彙整報告。
/// `id` 為 Some → 以 id upsert（更新時只動 updated_at）；為 None → 新增一份。回傳該筆 id。
pub fn save_summary(conn: &Connection, summary: &Summary) -> rusqlite::Result<i64> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    match summary.id {
        Some(id) => {
            let created_at = if summary.created_at.is_empty() {
                now.clone()
            } else {
                summary.created_at.clone()
            };
            conn.execute(
                "INSERT INTO summaries (id, kind, start_date, end_date, title, content, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    kind=?2, start_date=?3, end_date=?4, title=?5, content=?6, updated_at=?8",
                rusqlite::params![
                    id, summary.kind, summary.start_date, summary.end_date,
                    summary.title, summary.content, created_at, now
                ],
            )?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO summaries (kind, start_date, end_date, title, content, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                rusqlite::params![
                    summary.kind, summary.start_date, summary.end_date,
                    summary.title, summary.content, now
                ],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/// 所有彙整報告（清單用），依結束日期新到舊
pub fn list_summaries(conn: &Connection) -> rusqlite::Result<Vec<SummaryMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, start_date, end_date, title, updated_at
         FROM summaries ORDER BY end_date DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SummaryMeta {
            id: r.get(0)?,
            kind: r.get(1)?,
            start_date: r.get(2)?,
            end_date: r.get(3)?,
            title: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

/// 取得某份彙整報告；不存在回傳 None
pub fn get_summary(conn: &Connection, id: i64) -> rusqlite::Result<Option<Summary>> {
    conn.query_row(
        "SELECT id, kind, start_date, end_date, title, content, created_at, updated_at
         FROM summaries WHERE id = ?1",
        [id],
        |r| {
            Ok(Summary {
                id: r.get(0)?,
                kind: r.get(1)?,
                start_date: r.get(2)?,
                end_date: r.get(3)?,
                title: r.get(4)?,
                content: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        },
    )
    .optional()
}

/// 刪除某份彙整報告
pub fn delete_summary(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM summaries WHERE id = ?1", [id])?;
    Ok(())
}

/// 所有彙整報告（完整內容），依結束日期由舊到新
fn all_summaries(conn: &Connection) -> rusqlite::Result<Vec<Summary>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, start_date, end_date, title, content, created_at, updated_at
         FROM summaries ORDER BY end_date ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Summary {
            id: r.get(0)?,
            kind: r.get(1)?,
            start_date: r.get(2)?,
            end_date: r.get(3)?,
            title: r.get(4)?,
            content: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })?;
    rows.collect()
}

/// 整包匯出/匯入的資料結構
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportBundle {
    pub version: u32,
    pub exported_at: String,
    pub reports: Vec<Report>,
    pub tags: HashMap<String, Vec<String>>, // date -> tags
    pub settings: HashMap<String, String>,
    #[serde(default)]
    pub summaries: Vec<Summary>,
}

/// 所有日報（完整內容），依日期由舊到新
fn all_reports(conn: &Connection) -> rusqlite::Result<Vec<Report>> {
    let mut stmt = conn.prepare(
        "SELECT date, status, categories, raw_notes, updated_at FROM reports ORDER BY date ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        let categories_json: String = r.get(2)?;
        let categories: Vec<Category> = json_or_default(&categories_json, "reports.categories");
        Ok(Report {
            date: r.get(0)?,
            status: r.get(1)?,
            categories,
            raw_notes: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

/// 所有日期 → 標籤對照
fn all_report_tags(conn: &Connection) -> rusqlite::Result<HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT rt.report_date, t.name FROM report_tags rt
         JOIN tags t ON t.id = rt.tag_id ORDER BY t.name",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (date, name) = row?;
        map.entry(date).or_default().push(name);
    }
    Ok(map)
}

/// 所有設定
fn all_settings(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    // 排除 token / PAT，避免敏感資訊隨備份檔外洩（含舊版 tfs_pat 明文）
    let mut stmt = conn.prepare(
        "SELECT key, value FROM settings WHERE key NOT IN ('github_token', 'tfs_pat', 'azure_pat')",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    rows.collect()
}

/// 匯出整個資料庫成 bundle
pub fn export_data(conn: &Connection) -> rusqlite::Result<ExportBundle> {
    Ok(ExportBundle {
        version: 1,
        exported_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        reports: all_reports(conn)?,
        tags: all_report_tags(conn)?,
        settings: all_settings(conn)?,
        summaries: all_summaries(conn)?,
    })
}

/// 匯入 bundle（以日期為鍵 upsert 合併），回傳匯入的日報份數
pub fn import_data(conn: &Connection, bundle: &ExportBundle) -> rusqlite::Result<usize> {
    // 整批包在一個交易：中途失敗全部回滾，不留半匯入狀態；也避免逐筆 autocommit 的效能損耗
    let tx = conn.unchecked_transaction()?;
    for report in &bundle.reports {
        save_report(&tx, report)?;
    }
    for (date, tags) in &bundle.tags {
        set_report_tags(&tx, date, tags)?;
    }
    for (key, value) in &bundle.settings {
        set_setting(&tx, key, value)?;
    }
    for summary in &bundle.summaries {
        save_summary(&tx, summary)?;
    }
    tx.commit()?;
    Ok(bundle.reports.len())
}

// ── 舊 app 資料轉移 ──────────────────────────────────────────────
// 兩條路徑共用：更新後自動遷移（讀舊 identifier 的 DB）、匯入舊備份 JSON（寬鬆反序列化）。
// 兩者都只把舊資料還原成「有 categories 或 raw_notes」的 Report，交給前端惰性遷移為 HTML。

/// 已知的舊版 bundle identifier（app data 目錄名）；更新後首次啟動據此尋找舊資料庫
const LEGACY_IDENTIFIERS: &[&str] = &["com.richitech.dailylogs"];
/// 自動遷移只跑一次的旗標（存 settings）
const LEGACY_MIGRATED_KEY: &str = "legacy_auto_migrated";

/// 匯入用的寬鬆日報 DTO：相容各世代備份（四段式 report 層級欄位 / category-first / 缺欄位）
#[derive(Debug, Deserialize)]
struct LegacyReport {
    #[serde(default)]
    date: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    categories: Vec<Category>,
    #[serde(default)]
    raw_notes: String,
    #[serde(default)]
    updated_at: String,
    // 四段式（<2.6.1）report 層級舊欄位
    #[serde(default)]
    done: String,
    #[serde(default)]
    doing: String,
    #[serde(default)]
    blockers: String,
    #[serde(default)]
    tomorrow: String,
}

/// 匯入用的寬鬆彙整 DTO（舊備份可能缺欄位）
#[derive(Debug, Deserialize)]
struct LegacySummary {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    end_date: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
}

/// 匯入用的寬鬆 bundle DTO：未知/缺欄位一律預設，避免整包反序列化失敗
#[derive(Debug, Deserialize)]
pub struct LegacyBundle {
    #[serde(default)]
    reports: Vec<LegacyReport>,
    #[serde(default)]
    tags: HashMap<String, Vec<String>>,
    #[serde(default)]
    settings: HashMap<String, String>,
    #[serde(default)]
    summaries: Vec<LegacySummary>,
}

/// 四段式的四個欄位若至少一項有內容，組成單一分類；全空則回傳空分類陣列
fn four_aspects_to_categories(
    done: String,
    doing: String,
    blockers: String,
    tomorrow: String,
) -> Vec<Category> {
    if [&done, &doing, &blockers, &tomorrow]
        .iter()
        .any(|s| !s.trim().is_empty())
    {
        vec![Category {
            project: String::new(),
            name: String::new(),
            done,
            doing,
            blockers,
            tomorrow,
        }]
    } else {
        Vec::new()
    }
}

fn legacy_report_to_report(r: LegacyReport) -> Report {
    let status = if r.status.trim().is_empty() {
        "draft".to_string()
    } else {
        r.status
    };
    let categories = if !r.categories.is_empty() {
        r.categories
    } else {
        four_aspects_to_categories(r.done, r.doing, r.blockers, r.tomorrow)
    };
    Report {
        date: r.date,
        status,
        categories,
        raw_notes: r.raw_notes,
        updated_at: r.updated_at,
    }
}

fn legacy_summary_to_summary(s: LegacySummary) -> Summary {
    Summary {
        id: s.id,
        kind: if s.kind.trim().is_empty() {
            "weekly".to_string()
        } else {
            s.kind
        },
        start_date: s.start_date,
        end_date: s.end_date,
        title: s.title,
        content: s.content,
        created_at: s.created_at,
        updated_at: s.updated_at,
    }
}

/// 寬鬆 bundle → 標準 ExportBundle（供 import_all 用）
pub fn legacy_bundle_to_export(b: LegacyBundle) -> ExportBundle {
    ExportBundle {
        version: 1,
        exported_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        reports: b.reports.into_iter().map(legacy_report_to_report).collect(),
        tags: b.tags,
        settings: b.settings,
        summaries: b
            .summaries
            .into_iter()
            .map(legacy_summary_to_summary)
            .collect(),
    }
}

/// 某表是否存在指定欄位
fn has_column(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?; // 欄位順序：cid, name, type, ...
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 某表是否存在
fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |_| Ok(()),
    )
    .optional()
    .map(|o| o.is_some())
}

/// 從一個（可能是任何世代 schema 的）舊連線讀出 ExportBundle
fn read_legacy_bundle(old: &Connection) -> rusqlite::Result<ExportBundle> {
    let reports: Vec<Report> = if has_column(old, "reports", "categories")? {
        // category-first
        let mut stmt = old.prepare(
            "SELECT date, status, categories, raw_notes, updated_at FROM reports ORDER BY date ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            let categories_json: String = r.get(2)?;
            let categories: Vec<Category> =
                json_or_default(&categories_json, "legacy reports.categories");
            Ok(Report {
                date: r.get(0)?,
                status: r.get(1)?,
                categories,
                raw_notes: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        // 四段式：done/doing/blockers/tomorrow 在 report 層級
        let mut stmt = old.prepare(
            "SELECT date, status, done, doing, blockers, tomorrow, raw_notes, updated_at
             FROM reports ORDER BY date ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Report {
                date: r.get(0)?,
                status: r.get(1)?,
                categories: four_aspects_to_categories(r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?),
                raw_notes: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let tags = if table_exists(old, "report_tags")? && table_exists(old, "tags")? {
        all_report_tags(old)?
    } else {
        HashMap::new()
    };
    let settings = if table_exists(old, "settings")? {
        all_settings(old)? // 已排除 token/PAT
    } else {
        HashMap::new()
    };
    let summaries = if table_exists(old, "summaries")? {
        all_summaries(old)?
    } else {
        Vec::new()
    };

    Ok(ExportBundle {
        version: 1,
        exported_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        reports,
        tags,
        settings,
        summaries,
    })
}

/// 唯讀開啟舊版資料庫檔並讀出 ExportBundle
pub fn read_legacy_db(path: &Path) -> rusqlite::Result<ExportBundle> {
    let old = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    read_legacy_bundle(&old)
}

/// 非破壞性合併：只補現行庫沒有的日期／設定 key，絕不覆蓋現有資料。回傳新增日報數。
fn merge_legacy(conn: &Connection, bundle: &ExportBundle) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut added = 0usize;
    for report in &bundle.reports {
        if get_report(&tx, &report.date)?.is_none() {
            save_report(&tx, report)?;
            if let Some(tags) = bundle.tags.get(&report.date) {
                set_report_tags(&tx, &report.date, tags)?;
            }
            added += 1;
        }
    }
    for (key, value) in &bundle.settings {
        if get_setting(&tx, key)?.is_none() {
            set_setting(&tx, key, value)?;
        }
    }
    for summary in &bundle.summaries {
        // 以新列插入，避免與現有 id 衝突
        let mut s = summary.clone();
        s.id = None;
        save_summary(&tx, &s)?;
    }
    tx.commit()?;
    Ok(added)
}

/// 更新後首次啟動：偵測舊 identifier 的 app data 目錄並非破壞性搬遷舊資料（只跑一次）。
/// current_dir 是現行 app data 目錄（其上層目錄含各 identifier 子目錄）。
pub fn migrate_legacy_data(conn: &Connection, current_dir: &Path) -> rusqlite::Result<()> {
    if get_setting(conn, LEGACY_MIGRATED_KEY)?.as_deref() == Some("1") {
        return Ok(());
    }
    if let Some(parent) = current_dir.parent() {
        for id in LEGACY_IDENTIFIERS {
            let old_path = parent.join(id).join("dailylogs.db");
            if old_path.exists() {
                let bundle = read_legacy_db(&old_path)?;
                let added = merge_legacy(conn, &bundle)?;
                eprintln!("[dailylogs] 已自動從舊資料（{id}）遷移 {added} 份日報");
                break; // 只搬第一個找到的舊庫
            }
        }
    }
    set_setting(conn, LEGACY_MIGRATED_KEY, "1")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn report(date: &str, notes: &str) -> Report {
        Report {
            date: date.into(),
            status: "draft".into(),
            categories: Vec::new(),
            raw_notes: notes.into(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn report_crud_roundtrip() {
        let conn = mem_db();
        let updated = save_report(&conn, &report("2026-07-01", "寫了測試")).unwrap();
        assert!(!updated.is_empty());
        let got = get_report(&conn, "2026-07-01").unwrap().unwrap();
        assert_eq!(got.raw_notes, "寫了測試");

        // 同日期 upsert 覆蓋
        save_report(&conn, &report("2026-07-01", "改了內容")).unwrap();
        let got = get_report(&conn, "2026-07-01").unwrap().unwrap();
        assert_eq!(got.raw_notes, "改了內容");
        assert_eq!(list_reports(&conn).unwrap().len(), 1);

        delete_report(&conn, "2026-07-01").unwrap();
        assert!(get_report(&conn, "2026-07-01").unwrap().is_none());
    }

    #[test]
    fn list_reports_in_range_inclusive() {
        let conn = mem_db();
        for d in ["2026-06-30", "2026-07-01", "2026-07-02"] {
            save_report(&conn, &report(d, "x")).unwrap();
        }
        let rs = list_reports_in_range(&conn, "2026-07-01", "2026-07-02").unwrap();
        let dates: Vec<&str> = rs.iter().map(|r| r.date.as_str()).collect();
        assert_eq!(dates, ["2026-07-01", "2026-07-02"]);
    }

    #[test]
    fn report_tags_overwrite() {
        let conn = mem_db();
        save_report(&conn, &report("2026-07-01", "x")).unwrap();
        set_report_tags(&conn, "2026-07-01", &["前端".into(), "測試".into()]).unwrap();
        assert_eq!(get_report_tags(&conn, "2026-07-01").unwrap().len(), 2);

        // 整批覆蓋
        set_report_tags(&conn, "2026-07-01", &["後端".into()]).unwrap();
        assert_eq!(
            get_report_tags(&conn, "2026-07-01").unwrap(),
            vec!["後端".to_string()]
        );
    }

    #[test]
    fn task_completed_at_follows_status() {
        let conn = mem_db();
        let t = Task {
            id: None,
            title: "工項".into(),
            status: "todo".into(),
            project: String::new(),
            priority: "normal".into(),
            due_date: None,
            notes: String::new(),
            tags: vec!["a".into()],
            completed_at: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let saved = save_task(&conn, &t).unwrap();
        assert!(saved.id.is_some());
        assert!(saved.completed_at.is_none());
        assert_eq!(saved.tags, vec!["a".to_string()]);

        // 切到 done 自動補 completed_at；切離 done 清空
        let done = save_task(
            &conn,
            &Task {
                status: "done".into(),
                ..saved
            },
        )
        .unwrap();
        assert!(done.completed_at.is_some());
        let back = save_task(
            &conn,
            &Task {
                status: "doing".into(),
                ..done
            },
        )
        .unwrap();
        assert!(back.completed_at.is_none());

        delete_task(&conn, back.id.unwrap()).unwrap();
        assert!(list_tasks(&conn).unwrap().is_empty());
    }

    #[test]
    fn settings_upsert() {
        let conn = mem_db();
        assert!(get_setting(&conn, "k").unwrap().is_none());
        set_setting(&conn, "k", "v1").unwrap();
        set_setting(&conn, "k", "v2").unwrap();
        assert_eq!(get_setting(&conn, "k").unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn search_hits_notes_and_tags() {
        let conn = mem_db();
        save_report(&conn, &report("2026-07-01", "修正登入頁的錯誤")).unwrap();
        save_report(&conn, &report("2026-07-02", "其他事項")).unwrap();
        set_report_tags(&conn, "2026-07-02", &["登入".into()]).unwrap();
        let hits = search_reports(&conn, "登入").unwrap();
        assert_eq!(hits.len(), 2);
        assert!(search_reports(&conn, "不存在的字").unwrap().is_empty());
    }

    #[test]
    fn strip_html_removes_tags_and_entities() {
        assert_eq!(strip_html("<p>你好<strong>世界</strong></p>"), "你好世界");
        assert_eq!(
            strip_html("<img src=\"data:image/png;base64,AAAA\">文字"),
            "文字"
        );
        assert_eq!(strip_html("a &amp; b &lt;c&gt;d"), "a & b <c>d");
    }

    #[test]
    fn search_matches_html_content_without_tags() {
        let conn = mem_db();
        // raw_notes 為 HTML（含圖片 base64），仍能以純文字命中，且片段不含標籤
        save_report(
            &conn,
            &report(
                "2026-07-03",
                "<h2>登入</h2><p>修正<strong>登入</strong>頁</p><img src=\"data:image/png;base64,ZZZ\">",
            ),
        )
        .unwrap();
        let hits = search_reports(&conn, "登入").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(!hits[0].snippet.contains('<'));
        assert!(!hits[0].snippet.contains("base64"));
    }

    #[test]
    fn export_import_roundtrip_excludes_token() {
        let src = mem_db();
        save_report(&src, &report("2026-07-01", "內容")).unwrap();
        set_report_tags(&src, "2026-07-01", &["tag1".into()]).unwrap();
        set_setting(&src, "ai_command", "claude -p").unwrap();
        set_setting(&src, "github_token", "secret").unwrap();
        set_setting(&src, "azure_pat", "secret2").unwrap();
        set_setting(&src, "tfs_pat", "secret3").unwrap();

        let bundle = export_data(&src).unwrap();
        // token / PAT（含舊版 tfs_pat 明文）不得隨備份外洩
        assert!(!bundle.settings.contains_key("github_token"));
        assert!(!bundle.settings.contains_key("azure_pat"));
        assert!(!bundle.settings.contains_key("tfs_pat"));

        let dst = mem_db();
        assert_eq!(import_data(&dst, &bundle).unwrap(), 1);
        assert_eq!(
            get_report(&dst, "2026-07-01").unwrap().unwrap().raw_notes,
            "內容"
        );
        assert_eq!(
            get_report_tags(&dst, "2026-07-01").unwrap(),
            vec!["tag1".to_string()]
        );
        assert_eq!(
            get_setting(&dst, "ai_command").unwrap().as_deref(),
            Some("claude -p")
        );
    }

    // ── 舊資料轉移 ──────────────────────────────────────────────

    /// 建一個四段式 schema（無 categories 欄）的記憶體庫
    fn four_aspect_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE reports (
                date TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft',
                done TEXT NOT NULL DEFAULT '', doing TEXT NOT NULL DEFAULT '',
                blockers TEXT NOT NULL DEFAULT '', tomorrow TEXT NOT NULL DEFAULT '',
                raw_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn read_legacy_bundle_four_aspect_schema() {
        let old = four_aspect_db();
        old.execute(
            "INSERT INTO reports (date, status, done, doing, blockers, tomorrow, raw_notes, created_at, updated_at)
             VALUES ('2026-05-01', 'final', '完成的事', '', '', '明天做', '', 't', 't')",
            [],
        )
        .unwrap();
        old.execute(
            "INSERT INTO settings (key, value) VALUES ('ai_command', 'claude -p'), ('github_token', 'secret')",
            [],
        )
        .unwrap();

        let bundle = read_legacy_bundle(&old).unwrap();
        assert_eq!(bundle.reports.len(), 1);
        let cats = &bundle.reports[0].categories;
        assert_eq!(cats.len(), 1);
        assert_eq!(cats[0].done, "完成的事");
        assert_eq!(cats[0].tomorrow, "明天做");
        assert_eq!(bundle.reports[0].status, "final");
        // 舊 schema 無 tags/summaries 表 → 空；token 被排除
        assert!(bundle.tags.is_empty());
        assert!(bundle.summaries.is_empty());
        assert_eq!(
            bundle.settings.get("ai_command").map(String::as_str),
            Some("claude -p")
        );
        assert!(!bundle.settings.contains_key("github_token"));
    }

    #[test]
    fn read_legacy_bundle_category_first_schema() {
        let old = mem_db(); // 現行/category-first schema 有 categories 欄
        let mut r = report("2026-05-02", "");
        r.categories = vec![Category {
            project: "專案X".into(),
            name: "模組A".into(),
            done: "做完".into(),
            doing: String::new(),
            blockers: String::new(),
            tomorrow: String::new(),
        }];
        save_report(&old, &r).unwrap();

        let bundle = read_legacy_bundle(&old).unwrap();
        assert_eq!(bundle.reports.len(), 1);
        assert_eq!(bundle.reports[0].categories.len(), 1);
        assert_eq!(bundle.reports[0].categories[0].name, "模組A");
    }

    #[test]
    fn merge_legacy_is_nondestructive() {
        let main = mem_db();
        save_report(&main, &report("2026-07-01", "現有內容")).unwrap();
        set_setting(&main, "ai_command", "keep").unwrap();

        let bundle = ExportBundle {
            version: 1,
            exported_at: String::new(),
            reports: vec![
                report("2026-07-01", "舊-不該覆蓋"),
                report("2026-07-02", "新增"),
            ],
            tags: HashMap::from([("2026-07-02".to_string(), vec!["t".to_string()])]),
            settings: HashMap::from([
                ("ai_command".to_string(), "OLD".to_string()),
                ("new_key".to_string(), "v".to_string()),
            ]),
            summaries: Vec::new(),
        };

        let added = merge_legacy(&main, &bundle).unwrap();
        assert_eq!(added, 1); // 只新增 2026-07-02
        assert_eq!(
            get_report(&main, "2026-07-01").unwrap().unwrap().raw_notes,
            "現有內容" // 未被覆蓋
        );
        assert_eq!(
            get_report(&main, "2026-07-02").unwrap().unwrap().raw_notes,
            "新增"
        );
        assert_eq!(
            get_setting(&main, "ai_command").unwrap().as_deref(),
            Some("keep")
        ); // 未覆蓋
        assert_eq!(get_setting(&main, "new_key").unwrap().as_deref(), Some("v"));
        assert_eq!(
            get_report_tags(&main, "2026-07-02").unwrap(),
            vec!["t".to_string()]
        );
    }

    #[test]
    fn migrate_runs_once_and_sets_flag() {
        let conn = mem_db();
        // 指向一個沒有任何舊 identifier 子目錄的路徑：不搬任何東西，但會設旗標
        let dir = std::env::temp_dir().join("dailylogs_test_no_legacy");
        migrate_legacy_data(&conn, &dir).unwrap();
        assert_eq!(
            get_setting(&conn, LEGACY_MIGRATED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // 旗標已設 → 第二次呼叫直接返回（不因路徑而出錯）
        migrate_legacy_data(&conn, &dir).unwrap();
    }

    #[test]
    fn legacy_json_four_aspect_imports() {
        let json = r#"{"version":1,"reports":[
            {"date":"2026-01-01","status":"final","done":"做了A","doing":"","blockers":"","tomorrow":"明天B","raw_notes":""}
        ],"tags":{},"settings":{}}"#;
        let b: LegacyBundle = serde_json::from_str(json).unwrap();
        let ex = legacy_bundle_to_export(b);
        assert_eq!(ex.reports.len(), 1);
        assert_eq!(ex.reports[0].status, "final");
        assert_eq!(ex.reports[0].categories.len(), 1);
        assert_eq!(ex.reports[0].categories[0].done, "做了A");
        assert_eq!(ex.reports[0].categories[0].tomorrow, "明天B");
    }

    #[test]
    fn legacy_json_category_first_and_missing_fields() {
        // category-first 原樣保留；缺 tags/settings/summaries 也不失敗
        let json = r#"{"reports":[
            {"date":"2026-02-02","status":"","categories":[{"project":"P","name":"N","done":"D","doing":"","blockers":"","tomorrow":""}],"raw_notes":"","updated_at":""}
        ]}"#;
        let b: LegacyBundle = serde_json::from_str(json).unwrap();
        let ex = legacy_bundle_to_export(b);
        assert_eq!(ex.reports.len(), 1);
        assert_eq!(ex.reports[0].status, "draft"); // 空 status → draft
        assert_eq!(ex.reports[0].categories.len(), 1);
        assert_eq!(ex.reports[0].categories[0].name, "N");

        // 只有 date 的最小報告：categories 空、raw_notes 空，不 panic
        let min: LegacyBundle =
            serde_json::from_str(r#"{"reports":[{"date":"2026-03-03"}]}"#).unwrap();
        let ex2 = legacy_bundle_to_export(min);
        assert!(ex2.reports[0].categories.is_empty());
    }
}
