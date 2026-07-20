use crate::ai;
use crate::azure::{self, AzureConfig};
use crate::db::{self, Report, ReportMeta, Summary, SummaryMeta, Task};
use crate::github::{self, GithubConfig};
use crate::repo::{self, RepoCommits};
use crate::secret;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

/// 共享的資料庫連線（包在 Mutex 內）
pub struct DbState(pub Mutex<Connection>);

/// AI 命令的設定 key 與預設值
const AI_COMMAND_KEY: &str = "ai_command";
const DEFAULT_AI_COMMAND: &str = "claude -p";

/// GitHub 設定 key
const GITHUB_ENABLED_KEY: &str = "github_enabled"; // "1"/"0"；未設定時有 owner 即視為啟用（舊版升級相容）
const GITHUB_API_URL_KEY: &str = "github_api_url";
const GITHUB_OWNERS_KEY: &str = "github_owners"; // JSON 字串陣列（org 或使用者）
const GITHUB_AUTHOR_KEY: &str = "github_author"; // 作者比對關鍵字（逗號分隔，包含比對）
/// 未設定時的預設 GitHub API 位址
const DEFAULT_GITHUB_API_URL: &str = "https://api.github.com";

/// Azure DevOps（含 TFS/ADS）設定 key
const AZURE_ENABLED_KEY: &str = "azure_enabled"; // "1"/"0"；未設定時視為停用
const AZURE_BASE_URL_KEY: &str = "azure_base_url";
const AZURE_COLLECTIONS_KEY: &str = "azure_collections"; // JSON 字串陣列（雲端為組織名）
const AZURE_AUTHOR_KEY: &str = "azure_author"; // 作者比對關鍵字（逗號分隔，包含比對）

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

/// 讀取二進位檔，以原始 bytes 回傳（給前端解析 PDF 等；不走 JSON 序列化）
#[tauri::command]
pub fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
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
    // 用寬鬆 DTO 反序列化，相容各世代舊備份（四段式 / category-first / 缺欄位）
    let legacy: db::LegacyBundle =
        serde_json::from_str(&json).map_err(|e| format!("檔案格式不符：{}", e))?;
    let bundle = db::legacy_bundle_to_export(legacy);
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

/// 讀取 GitHub token（keychain 優先，退回 settings 表），沒有時回傳空字串
#[tauri::command]
pub fn get_github_token(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::get(&conn, secret::GITHUB_TOKEN)
}

/// 寫入 GitHub token（keychain 優先，退回 settings 表）
#[tauri::command]
pub fn set_github_token(state: State<DbState>, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::set(&conn, secret::GITHUB_TOKEN, &value)
}

/// 讀取 Azure DevOps PAT（keychain 優先，退回 settings 表），沒有時回傳空字串
#[tauri::command]
pub fn get_azure_pat(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::get(&conn, secret::AZURE_PAT)
}

/// 寫入 Azure DevOps PAT（keychain 優先，退回 settings 表）
#[tauri::command]
pub fn set_azure_pat(state: State<DbState>, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::set(&conn, secret::AZURE_PAT, &value)
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

/// 把逗號分隔的作者關鍵字切成清單（trim、去空）
fn split_authors(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 讀 settings 表的 JSON 字串陣列（key 不存在＝空陣列）
fn get_json_list(conn: &Connection, key: &str) -> Result<Vec<String>, String> {
    match db::get_setting(conn, key).map_err(|e| e.to_string())? {
        Some(j) => serde_json::from_str(&j).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

/// 從 settings 讀出 GitHub 連線設定（呼叫端負責取鎖，並在 await 前放鎖）。
fn load_github_config(conn: &Connection) -> Result<GithubConfig, String> {
    let api_url = db::get_setting(conn, GITHUB_API_URL_KEY)
        .map_err(|e| e.to_string())?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_GITHUB_API_URL.to_string());
    let owners = get_json_list(conn, GITHUB_OWNERS_KEY)?;
    let token = secret::get(conn, secret::GITHUB_TOKEN)?;
    let authors = split_authors(
        &db::get_setting(conn, GITHUB_AUTHOR_KEY)
            .map_err(|e| e.to_string())?
            .unwrap_or_default(),
    );

    if owners.is_empty() {
        return Err("尚未設定任何 owner（org 或使用者）".to_string());
    }
    if token.trim().is_empty() {
        return Err("尚未設定 GitHub token（Personal Access Token）".to_string());
    }

    Ok(GithubConfig {
        api_url,
        owners,
        token,
        authors,
    })
}

/// 從 settings 讀出 Azure DevOps 連線設定（呼叫端負責取鎖，並在 await 前放鎖）。
fn load_azure_config(conn: &Connection) -> Result<AzureConfig, String> {
    let base_url = db::get_setting(conn, AZURE_BASE_URL_KEY)
        .map_err(|e| e.to_string())?
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let collections = get_json_list(conn, AZURE_COLLECTIONS_KEY)?;
    let pat = secret::get(conn, secret::AZURE_PAT)?;
    let authors = split_authors(
        &db::get_setting(conn, AZURE_AUTHOR_KEY)
            .map_err(|e| e.to_string())?
            .unwrap_or_default(),
    );

    if base_url.is_empty() {
        return Err("尚未設定 Azure DevOps 位址".to_string());
    }
    if collections.is_empty() {
        return Err("尚未設定任何 collection".to_string());
    }
    if pat.trim().is_empty() {
        return Err("尚未設定 Azure DevOps PAT（Personal Access Token）".to_string());
    }

    Ok(AzureConfig {
        base_url,
        collections,
        pat,
        authors,
    })
}

/// GitHub 整合是否啟用：明確設定優先；未設定時有 owner 即視為啟用（舊版升級相容）
fn github_enabled(conn: &Connection) -> Result<bool, String> {
    match db::get_setting(conn, GITHUB_ENABLED_KEY).map_err(|e| e.to_string())? {
        Some(v) => Ok(v == "1"),
        None => Ok(!get_json_list(conn, GITHUB_OWNERS_KEY)?.is_empty()),
    }
}

/// Azure DevOps 整合是否啟用：未設定時視為停用
fn azure_enabled(conn: &Connection) -> Result<bool, String> {
    Ok(db::get_setting(conn, AZURE_ENABLED_KEY)
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("1"))
}

/// 一次讀出兩個提供者「已啟用者」的設定；停用＝None，
/// 啟用但設定不完整＝Some(Err)（由呼叫端決定當警告或錯誤）。
#[allow(clippy::type_complexity)]
fn load_enabled_configs(
    state: &State<DbState>,
) -> Result<
    (
        Option<Result<GithubConfig, String>>,
        Option<Result<AzureConfig, String>>,
    ),
    String,
> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let gh = github_enabled(&conn)?.then(|| load_github_config(&conn));
    let az = azure_enabled(&conn)?.then(|| load_azure_config(&conn));
    Ok((gh, az))
}

/// 統一撈 commit 的結果：text 為組好的文字，warnings 為個別提供者的失敗訊息
#[derive(serde::Serialize)]
pub struct CollectedCommits {
    pub text: String,
    pub warnings: Vec<String>,
}

/// 從所有已啟用的儲存庫整合撈指定日期該作者的 commit，合併成一份文字。
/// 單一提供者失敗記入 warnings 不中斷（例如在家連不到公司 TFS 仍可撈 GitHub）；
/// 全部失敗才回 Err；沒有任何提供者啟用也回 Err。
#[tauri::command]
pub async fn repo_collect_commits(
    state: State<'_, DbState>,
    date: String,
) -> Result<CollectedCommits, String> {
    let (gh, az) = load_enabled_configs(&state)?;
    if gh.is_none() && az.is_none() {
        return Err("尚未啟用任何儲存庫整合（請到設定啟用 GitHub 或 Azure DevOps）".to_string());
    }

    let mut all: Vec<RepoCommits> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut succeeded = false;

    if let Some(cfg) = gh {
        match cfg {
            Ok(cfg) => match github::collect_commits(&cfg, &date).await {
                Ok(mut v) => {
                    all.append(&mut v);
                    succeeded = true;
                }
                Err(e) => warnings.push(format!("GitHub：{e}")),
            },
            Err(e) => warnings.push(format!("GitHub：{e}")),
        }
    }
    if let Some(cfg) = az {
        match cfg {
            Ok(cfg) => match azure::collect_commits(&cfg, &date).await {
                Ok(mut v) => {
                    all.append(&mut v);
                    succeeded = true;
                }
                Err(e) => warnings.push(format!("Azure DevOps：{e}")),
            },
            Err(e) => warnings.push(format!("Azure DevOps：{e}")),
        }
    }

    if !succeeded {
        return Err(warnings.join("；"));
    }
    // 跨提供者合併後重排，讓 format_commits 能以「連續同 project」分組
    all.sort_by(|a, b| a.project.cmp(&b.project).then_with(|| a.repo.cmp(&b.repo)));
    Ok(CollectedCommits {
        text: repo::format_commits(&all),
        warnings,
    })
}

/// 列出所有已啟用整合的專案/儲存庫名稱（GitHub repo ∪ Azure 團隊專案，去重排序，
/// 給工作面板匯入專案用）。單一提供者失敗略過，全部失敗才回 Err。
#[tauri::command]
pub async fn repo_list_projects(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let (gh, az) = load_enabled_configs(&state)?;
    if gh.is_none() && az.is_none() {
        return Err("尚未啟用任何儲存庫整合（請到設定啟用 GitHub 或 Azure DevOps）".to_string());
    }

    let mut names: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut succeeded = false;

    if let Some(cfg) = gh {
        match cfg {
            Ok(cfg) => match github::list_repos(&cfg).await {
                Ok(mut v) => {
                    names.append(&mut v);
                    succeeded = true;
                }
                Err(e) => errors.push(format!("GitHub：{e}")),
            },
            Err(e) => errors.push(format!("GitHub：{e}")),
        }
    }
    if let Some(cfg) = az {
        match cfg {
            Ok(cfg) => match azure::list_projects(&cfg).await {
                Ok(mut v) => {
                    names.append(&mut v);
                    succeeded = true;
                }
                Err(e) => errors.push(format!("Azure DevOps：{e}")),
            },
            Err(e) => errors.push(format!("Azure DevOps：{e}")),
        }
    }

    if !succeeded {
        return Err(errors.join("；"));
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// 測試 GitHub 連線：回傳所有 owner 的 repo 總數（不看啟用開關，設定頁測試用）。
#[tauri::command]
pub async fn github_test_connection(state: State<'_, DbState>) -> Result<usize, String> {
    let cfg = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        load_github_config(&conn)?
    };
    github::count_repos(&cfg).await
}

/// 測試 Azure DevOps 連線：回傳所有 collection 的 repo 總數（不看啟用開關，設定頁測試用）。
#[tauri::command]
pub async fn azure_test_connection(state: State<'_, DbState>) -> Result<usize, String> {
    let cfg = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        load_azure_config(&conn)?
    };
    azure::count_repos(&cfg).await
}
