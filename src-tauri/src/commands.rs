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

/// 儲存庫來源清單設定 key（JSON 陣列，每筆一個 RepoProvider）
const REPO_PROVIDERS_KEY: &str = "repo_providers";
/// 未設定時的預設 GitHub API 位址
const DEFAULT_GITHUB_API_URL: &str = "https://api.github.com";

// ── 舊版單例 GitHub / Azure 設定 key（僅供 migrate_repo_providers 讀舊值遷移用）──
const GITHUB_ENABLED_KEY: &str = "github_enabled"; // "1"/"0"；未設定時有 owner 即視為啟用
const GITHUB_API_URL_KEY: &str = "github_api_url";
const GITHUB_OWNERS_KEY: &str = "github_owners"; // JSON 字串陣列（org 或使用者）
const GITHUB_AUTHOR_KEY: &str = "github_author"; // 作者比對關鍵字（逗號分隔，包含比對）
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

/// 讀取某來源（provider id）的 token/PAT（keychain 優先，退回 settings 表），沒有時回傳空字串
#[tauri::command]
pub fn get_provider_secret(state: State<DbState>, id: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::get_provider(&conn, &id)
}

/// 寫入某來源（provider id）的 token/PAT（空字串＝刪除）
#[tauri::command]
pub fn set_provider_secret(state: State<DbState>, id: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    secret::set_provider(&conn, &id, &value)
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

/// 一筆儲存庫來源（GitHub 或 Azure DevOps）。同時對應 repo_providers 的 JSON 元素
/// 與前端 repo_test_connection 的命令參數。token/PAT 不在此結構，另存 keychain
/// （見 secret::get_provider）。欄位命名採 camelCase 與前端一致。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoProvider {
    pub id: String,
    /// "github" | "azure"
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub enabled: bool,
    /// 作者比對關鍵字（逗號分隔，包含比對）
    #[serde(default)]
    pub author: String,
    // ── GitHub ──
    #[serde(default)]
    pub api_url: Option<String>,
    #[serde(default)]
    pub owners: Option<Vec<String>>,
    // ── Azure DevOps ──
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub collections: Option<Vec<String>>,
}

/// trim + 去空的字串清單
fn clean_list(items: Option<Vec<String>>) -> Vec<String> {
    items
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 把一筆 GitHub 來源 ＋ token 組成既有的 GithubConfig（含空值驗證）
fn provider_to_github_config(p: &RepoProvider, token: String) -> Result<GithubConfig, String> {
    let api_url = p
        .api_url
        .clone()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| DEFAULT_GITHUB_API_URL.to_string());
    let owners = clean_list(p.owners.clone());
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
        authors: split_authors(&p.author),
    })
}

/// 把一筆 Azure 來源 ＋ PAT 組成既有的 AzureConfig（含空值驗證）
fn provider_to_azure_config(p: &RepoProvider, pat: String) -> Result<AzureConfig, String> {
    let base_url = p.base_url.clone().unwrap_or_default().trim().to_string();
    let collections = clean_list(p.collections.clone());
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
        authors: split_authors(&p.author),
    })
}

/// 讀出 repo_providers 清單（key 不存在或空字串＝空清單）
fn load_providers(conn: &Connection) -> Result<Vec<RepoProvider>, String> {
    match db::get_setting(conn, REPO_PROVIDERS_KEY).map_err(|e| e.to_string())? {
        Some(j) if !j.trim().is_empty() => serde_json::from_str(&j).map_err(|e| e.to_string()),
        _ => Ok(Vec::new()),
    }
}

/// 顯示名稱：使用者未命名時退回型別預設，供 warning 前綴用
fn provider_display_name(p: &RepoProvider) -> String {
    if !p.name.trim().is_empty() {
        return p.name.trim().to_string();
    }
    match p.kind.as_str() {
        "github" => "GitHub".to_string(),
        "azure" => "Azure DevOps".to_string(),
        other => other.to_string(),
    }
}

/// 已啟用來源的連線設定（或設定不完整的 Err），連同顯示名稱
enum ProviderConn {
    Github(GithubConfig),
    Azure(AzureConfig),
}

/// 一筆已啟用來源：顯示名稱 + 連線設定（設定不完整＝Err，由呼叫端當警告）
type EnabledProvider = (String, Result<ProviderConn, String>);

/// 在鎖內讀出所有「已啟用」來源的連線設定與秘密（await 前放鎖）。
fn load_enabled_providers(state: &State<DbState>) -> Result<Vec<EnabledProvider>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let providers = load_providers(&conn)?;
    let mut out = Vec::new();
    for p in providers.iter().filter(|p| p.enabled) {
        let name = provider_display_name(p);
        let secret = secret::get_provider(&conn, &p.id)?;
        let cfg = match p.kind.as_str() {
            "github" => provider_to_github_config(p, secret).map(ProviderConn::Github),
            "azure" => provider_to_azure_config(p, secret).map(ProviderConn::Azure),
            other => Err(format!("未知的來源類型「{other}」")),
        };
        out.push((name, cfg));
    }
    Ok(out)
}

/// 統一撈 commit 的結果：text 為組好的文字，warnings 為個別來源的失敗訊息
#[derive(serde::Serialize)]
pub struct CollectedCommits {
    pub text: String,
    pub warnings: Vec<String>,
}

/// 從所有已啟用的儲存庫來源撈指定日期該作者的 commit，合併成一份文字。
/// 單一來源失敗記入 warnings 不中斷（例如在家連不到公司 TFS 仍可撈 GitHub）；
/// 全部失敗才回 Err；沒有任何來源啟用也回 Err。
#[tauri::command]
pub async fn repo_collect_commits(
    state: State<'_, DbState>,
    date: String,
) -> Result<CollectedCommits, String> {
    let enabled = load_enabled_providers(&state)?;
    if enabled.is_empty() {
        return Err(
            "尚未啟用任何儲存庫整合（請到設定新增並啟用 GitHub 或 Azure DevOps 來源）".to_string(),
        );
    }

    let mut all: Vec<RepoCommits> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut succeeded = false;

    for (name, cfg) in enabled {
        let result = match cfg {
            Ok(ProviderConn::Github(c)) => github::collect_commits(&c, &date).await,
            Ok(ProviderConn::Azure(c)) => azure::collect_commits(&c, &date).await,
            Err(e) => Err(e),
        };
        match result {
            Ok((mut v, on_date_total)) => {
                // 當天其實有 commit、卻被作者關鍵字全數濾光：給出可行動的診斷
                if v.is_empty() && on_date_total > 0 {
                    warnings.push(format!(
                        "{name}：今天有 {on_date_total} 筆 commit，但無一符合作者關鍵字，請檢查該來源的「作者關鍵字」設定"
                    ));
                }
                all.append(&mut v);
                succeeded = true;
            }
            Err(e) => warnings.push(format!("{name}：{e}")),
        }
    }

    if !succeeded {
        return Err(warnings.join("；"));
    }
    // 跨來源合併後重排，讓 format_commits 能以「連續同 project」分組
    all.sort_by(|a, b| a.project.cmp(&b.project).then_with(|| a.repo.cmp(&b.repo)));
    Ok(CollectedCommits {
        text: repo::format_commits(&all),
        warnings,
    })
}

/// 列出所有已啟用來源的專案/儲存庫名稱（GitHub repo ∪ Azure 團隊專案，去重排序，
/// 給工作面板匯入專案用）。單一來源失敗略過，全部失敗才回 Err。
#[tauri::command]
pub async fn repo_list_projects(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let enabled = load_enabled_providers(&state)?;
    if enabled.is_empty() {
        return Err(
            "尚未啟用任何儲存庫整合（請到設定新增並啟用 GitHub 或 Azure DevOps 來源）".to_string(),
        );
    }

    let mut names: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut succeeded = false;

    for (name, cfg) in enabled {
        let result = match cfg {
            Ok(ProviderConn::Github(c)) => github::list_repos(&c).await,
            Ok(ProviderConn::Azure(c)) => azure::list_projects(&c).await,
            Err(e) => Err(e),
        };
        match result {
            Ok(mut v) => {
                names.append(&mut v);
                succeeded = true;
            }
            Err(e) => errors.push(format!("{name}：{e}")),
        }
    }

    if !succeeded {
        return Err(errors.join("；"));
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// 測試單一來源連線：依型別組 config 後回傳 repo 總數（直接吃傳入的設定與秘密，
/// 不讀 settings、無存檔副作用，設定頁測試用）。
#[tauri::command]
pub async fn repo_test_connection(provider: RepoProvider, secret: String) -> Result<usize, String> {
    match provider.kind.as_str() {
        "github" => {
            let cfg = provider_to_github_config(&provider, secret)?;
            github::count_repos(&cfg).await
        }
        "azure" => {
            let cfg = provider_to_azure_config(&provider, secret)?;
            azure::count_repos(&cfg).await
        }
        other => Err(format!("未知的來源類型「{other}」")),
    }
}

/// 一次性遷移：把舊版單例 GitHub / Azure 設定轉成 repo_providers 清單（含把 token/PAT
/// 搬到 per-instance keychain）。repo_providers 已存在則不動；沒有舊資料也寫入空陣列，
/// 代表「已遷移」，避免每次啟動重跑。呼叫端負責取鎖。
pub fn migrate_repo_providers(conn: &Connection) -> Result<(), String> {
    if let Some(v) = db::get_setting(conn, REPO_PROVIDERS_KEY).map_err(|e| e.to_string())? {
        if !v.trim().is_empty() {
            return Ok(());
        }
    }

    let mut providers: Vec<RepoProvider> = Vec::new();

    // 舊 GitHub
    let gh_owners = get_json_list(conn, GITHUB_OWNERS_KEY)?;
    let gh_api = db::get_setting(conn, GITHUB_API_URL_KEY).map_err(|e| e.to_string())?;
    let gh_author = db::get_setting(conn, GITHUB_AUTHOR_KEY).map_err(|e| e.to_string())?;
    let gh_enabled_raw = db::get_setting(conn, GITHUB_ENABLED_KEY).map_err(|e| e.to_string())?;
    if !gh_owners.is_empty() || gh_api.is_some() || gh_author.is_some() || gh_enabled_raw.is_some()
    {
        let id = "migrated-github".to_string();
        // enabled：明確設定優先；未設定時有 owner 即視為啟用（沿用舊行為）
        let enabled = match gh_enabled_raw {
            Some(v) => v == "1",
            None => !gh_owners.is_empty(),
        };
        providers.push(RepoProvider {
            id: id.clone(),
            kind: "github".to_string(),
            name: "GitHub".to_string(),
            enabled,
            author: gh_author.unwrap_or_default(),
            api_url: gh_api,
            owners: Some(gh_owners),
            base_url: None,
            collections: None,
        });
        let token = secret::get(conn, secret::GITHUB_TOKEN)?;
        if !token.trim().is_empty() {
            secret::set_provider(conn, &id, &token)?;
        }
    }

    // 舊 Azure DevOps
    let az_collections = get_json_list(conn, AZURE_COLLECTIONS_KEY)?;
    let az_base = db::get_setting(conn, AZURE_BASE_URL_KEY).map_err(|e| e.to_string())?;
    let az_author = db::get_setting(conn, AZURE_AUTHOR_KEY).map_err(|e| e.to_string())?;
    let az_enabled_raw = db::get_setting(conn, AZURE_ENABLED_KEY).map_err(|e| e.to_string())?;
    if !az_collections.is_empty()
        || az_base.is_some()
        || az_author.is_some()
        || az_enabled_raw.is_some()
    {
        let id = "migrated-azure".to_string();
        let enabled = az_enabled_raw.as_deref() == Some("1"); // 未設定＝停用（沿用舊行為）
        providers.push(RepoProvider {
            id: id.clone(),
            kind: "azure".to_string(),
            name: "Azure DevOps".to_string(),
            enabled,
            author: az_author.unwrap_or_default(),
            api_url: None,
            owners: None,
            base_url: az_base,
            collections: Some(az_collections),
        });
        let pat = secret::get(conn, secret::AZURE_PAT)?;
        if !pat.trim().is_empty() {
            secret::set_provider(conn, &id, &pat)?;
        }
    }

    let json = serde_json::to_string(&providers).map_err(|e| e.to_string())?;
    db::set_setting(conn, REPO_PROVIDERS_KEY, &json).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // 遷移只用到 settings 表；秘密在無 keychain（測試環境）時退回同一張表
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        conn
    }

    #[test]
    fn migrate_from_legacy_github_and_azure() {
        let conn = mem_db();
        db::set_setting(&conn, GITHUB_OWNERS_KEY, r#"["me","my-org"]"#).unwrap();
        db::set_setting(&conn, GITHUB_AUTHOR_KEY, "arieschao").unwrap();
        db::set_setting(&conn, GITHUB_ENABLED_KEY, "1").unwrap();
        db::set_setting(&conn, AZURE_BASE_URL_KEY, "http://tfs:8080/tfs").unwrap();
        db::set_setting(&conn, AZURE_COLLECTIONS_KEY, r#"["DefaultCollection"]"#).unwrap();
        db::set_setting(&conn, AZURE_ENABLED_KEY, "0").unwrap();

        migrate_repo_providers(&conn).unwrap();
        let providers = load_providers(&conn).unwrap();
        assert_eq!(providers.len(), 2);

        let gh = providers.iter().find(|p| p.kind == "github").unwrap();
        assert_eq!(gh.id, "migrated-github");
        assert!(gh.enabled);
        assert_eq!(gh.author, "arieschao");
        assert_eq!(gh.owners.as_deref().unwrap(), ["me", "my-org"]);

        let az = providers.iter().find(|p| p.kind == "azure").unwrap();
        assert_eq!(az.id, "migrated-azure");
        assert!(!az.enabled); // azure_enabled = "0"
        assert_eq!(az.base_url.as_deref(), Some("http://tfs:8080/tfs"));
    }

    #[test]
    fn migrate_github_enabled_defaults_to_owner_presence() {
        // 未設定 github_enabled、但有 owner → 視為啟用（舊版升級相容）
        let conn = mem_db();
        db::set_setting(&conn, GITHUB_OWNERS_KEY, r#"["me"]"#).unwrap();
        migrate_repo_providers(&conn).unwrap();
        let providers = load_providers(&conn).unwrap();
        let gh = providers.iter().find(|p| p.kind == "github").unwrap();
        assert!(gh.enabled);
    }

    #[test]
    fn migrate_is_idempotent_and_no_legacy_writes_empty() {
        let conn = mem_db();
        // 沒有任何舊 key → 寫入空清單，代表已遷移
        migrate_repo_providers(&conn).unwrap();
        assert_eq!(
            db::get_setting(&conn, REPO_PROVIDERS_KEY)
                .unwrap()
                .as_deref(),
            Some("[]")
        );
        // 再跑一次：不覆蓋既有清單
        db::set_setting(&conn, REPO_PROVIDERS_KEY, r#"[{"id":"x","type":"github"}]"#).unwrap();
        migrate_repo_providers(&conn).unwrap();
        assert_eq!(load_providers(&conn).unwrap().len(), 1);
    }
}
