use crate::ai;
use crate::db::{self, Report, ReportMeta, Summary, SummaryMeta, Task};
use crate::secret;
use crate::tfs::{self, TfsConfig};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

/// 共享的資料庫連線（包在 Mutex 內）
pub struct DbState(pub Mutex<Connection>);

/// AI 命令的設定 key 與預設值
const AI_COMMAND_KEY: &str = "ai_command";
const DEFAULT_AI_COMMAND: &str = "claude -p";

/// TFS 設定 key
const TFS_BASE_URL_KEY: &str = "tfs_base_url";
const TFS_COLLECTIONS_KEY: &str = "tfs_collections"; // JSON 字串陣列
const GIT_AUTHOR_KEY: &str = "git_author"; // 作者比對關鍵字（逗號分隔，包含比對）

/// AI 逾時秒數設定 key 與預設值
const AI_TIMEOUT_KEY: &str = "ai_timeout_secs";
const DEFAULT_AI_TIMEOUT: u64 = 120;

#[tauri::command]
pub fn list_reports(state: State<DbState>) -> Result<Vec<ReportMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::list_reports(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report(state: State<DbState>, date: String) -> Result<Option<Report>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_report(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_reports(
    state: State<DbState>,
    keyword: String,
) -> Result<Vec<db::SearchHit>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::search_reports(&conn, &keyword).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_reports_in_range(
    state: State<DbState>,
    start: String,
    end: String,
) -> Result<Vec<Report>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::list_reports_in_range(&conn, &start, &end).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_report(state: State<DbState>, report: Report) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_report(&conn, &report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_report(state: State<DbState>, date: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_report(&conn, &date).map_err(|e| e.to_string())
}

/// 新增/更新一份彙整報告，回傳該筆 id
#[tauri::command]
pub fn save_summary(state: State<DbState>, summary: Summary) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_summary(&conn, &summary).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_summaries(state: State<DbState>) -> Result<Vec<SummaryMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::list_summaries(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_summary(state: State<DbState>, id: i64) -> Result<Option<Summary>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_summary(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_summary(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_summary(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tasks(state: State<DbState>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::list_tasks(&conn).map_err(|e| e.to_string())
}

/// 新增/更新一筆工作項目，回傳寫入後的完整 Task
#[tauri::command]
pub fn save_task(state: State<DbState>, task: Task) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::save_task(&conn, &task).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_task(&conn, id).map_err(|e| e.to_string())
}

/// 寫入文字檔（路徑由前端的存檔對話框取得）
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// 寫入二進位檔（給 .docx 等）
#[tauri::command]
pub fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// 讀取文字檔（給匯入資料用）
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 匯出整個資料庫成 JSON 字串
#[tauri::command]
pub fn export_all(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bundle = db::export_data(&conn).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

/// 從 JSON 字串匯入資料（以日期 upsert 合併），回傳匯入的日報份數
#[tauri::command]
pub fn import_all(state: State<DbState>, json: String) -> Result<usize, String> {
    let bundle: db::ExportBundle =
        serde_json::from_str(&json).map_err(|e| format!("檔案格式不符：{}", e))?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::import_data(&conn, &bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(state: State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

/// 讀取 TFS PAT（keychain 優先，退回 settings 表），沒有時回傳空字串
#[tauri::command]
pub fn get_tfs_pat(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::get_pat(&conn)
}

/// 寫入 TFS PAT（keychain 優先，退回 settings 表）
#[tauri::command]
pub fn set_tfs_pat(state: State<DbState>, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::set_pat(&conn, &value)
}

#[tauri::command]
pub fn get_report_tags(state: State<DbState>, date: String) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_report_tags(&conn, &date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_report_tags(
    state: State<DbState>,
    date: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_report_tags(&conn, &date, &tags).map_err(|e| e.to_string())
}

/// 呼叫 AI：讀取設定的命令模板，把 prompt 經 stdin 傳入 CLI，回傳輸出。
/// 用 async 讓阻塞的子行程在 Tauri 的執行緒池跑，不卡住 UI。
#[tauri::command]
pub async fn run_ai(state: State<'_, DbState>, prompt: String) -> Result<String, String> {
    let (command, timeout_secs) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let command = db::get_setting(&conn, AI_COMMAND_KEY)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| DEFAULT_AI_COMMAND.to_string());
        let timeout_secs = db::get_setting(&conn, AI_TIMEOUT_KEY)
            .map_err(|e| e.to_string())?
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(DEFAULT_AI_TIMEOUT);
        (command, timeout_secs)
    };
    ai::run_ai(&command, &prompt, timeout_secs)
}

/// 從 settings 讀出 TFS 連線設定（會鎖 DB；回傳前即放鎖，避免跨 await 持鎖）。
fn load_tfs_config(state: &State<DbState>) -> Result<TfsConfig, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let base_url = db::get_setting(&conn, TFS_BASE_URL_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let collections_json =
        db::get_setting(&conn, TFS_COLLECTIONS_KEY).map_err(|e| e.to_string())?;
    let pat = secret::get_pat(&conn)?;
    let author = db::get_setting(&conn, GIT_AUTHOR_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let collections: Vec<String> = match collections_json {
        Some(j) => serde_json::from_str(&j).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };
    let authors: Vec<String> = author
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if base_url.trim().is_empty() {
        return Err("尚未設定 TFS 位址".to_string());
    }
    if collections.is_empty() {
        return Err("尚未設定任何 collection".to_string());
    }
    if pat.trim().is_empty() {
        return Err("尚未設定 PAT（Personal Access Token）".to_string());
    }

    Ok(TfsConfig {
        base_url,
        collections,
        pat,
        authors,
    })
}

/// 從 TFS 撈指定日期該作者的 commit，回傳組好的文字。沒有任何 commit 時回傳空字串。
#[tauri::command]
pub async fn git_collect_commits(
    state: State<'_, DbState>,
    date: String,
) -> Result<String, String> {
    let cfg = load_tfs_config(&state)?;
    let collected = tfs::collect_commits(&cfg, &date).await?;
    Ok(tfs::format_commits(&collected))
}

/// 測試 TFS 連線：回傳所有 collection 的 repo 總數。
#[tauri::command]
pub async fn tfs_test_connection(state: State<'_, DbState>) -> Result<usize, String> {
    let cfg = load_tfs_config(&state)?;
    tfs::count_repos(&cfg).await
}

/// 列出所有 collection 的團隊專案名稱（給工作面板匯入專案用）。
#[tauri::command]
pub async fn tfs_list_projects(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let cfg = load_tfs_config(&state)?;
    tfs::list_projects(&cfg).await
}
