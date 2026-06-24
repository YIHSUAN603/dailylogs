use rusqlite::{Connection, OptionalExtension};
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
        );",
    )?;
    // 舊資料庫（四段式）遷移：補上 categories 欄位（已存在則忽略錯誤）
    let _ = conn.execute(
        "ALTER TABLE reports ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    Ok(conn)
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
        let categories: Vec<Category> = serde_json::from_str(&categories_json).unwrap_or_default();
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
        if !raw_notes.trim().is_empty() {
            segments.push(raw_notes.clone());
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
        let categories = serde_json::from_str(&categories_json).unwrap_or_default();
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
            let categories = serde_json::from_str(&categories_json).unwrap_or_default();
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
        let categories = serde_json::from_str(&categories_json).unwrap_or_default();
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
    // 排除 PAT，避免敏感 token 隨備份檔外洩
    let mut stmt = conn.prepare("SELECT key, value FROM settings WHERE key != 'tfs_pat'")?;
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
    for report in &bundle.reports {
        save_report(conn, report)?;
    }
    for (date, tags) in &bundle.tags {
        set_report_tags(conn, date, tags)?;
    }
    for (key, value) in &bundle.settings {
        set_setting(conn, key, value)?;
    }
    for summary in &bundle.summaries {
        save_summary(conn, summary)?;
    }
    Ok(bundle.reports.len())
}
