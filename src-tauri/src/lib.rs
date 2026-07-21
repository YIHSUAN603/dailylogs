mod ai;
mod azure;
mod commands;
mod db;
mod github;
mod repo;
mod secret;

use commands::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 資料庫放在系統的 app data 目錄
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("dailylogs.db"))?;
            // 更新後首次啟動：自動把舊 identifier 目錄的資料非破壞性搬進來（只跑一次）。
            // best-effort：失敗只記錄、不中斷啟動（仍可用舊 app 匯出 JSON → 匯入當後備）。
            if let Err(e) = db::migrate_legacy_data(&conn, &dir) {
                eprintln!("[dailylogs] 舊資料自動遷移失敗（略過，不影響啟動）：{e}");
            }
            // 舊版單例 GitHub/Azure 設定 → repo_providers 清單（只跑一次；best-effort）
            if let Err(e) = commands::migrate_repo_providers(&conn) {
                eprintln!("[dailylogs] 儲存庫來源設定遷移失敗（略過，不影響啟動）：{e}");
            }
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_reports,
            commands::get_report,
            commands::search_reports,
            commands::list_reports_in_range,
            commands::save_report,
            commands::delete_report,
            commands::save_summary,
            commands::list_summaries,
            commands::get_summary,
            commands::delete_summary,
            commands::list_tasks,
            commands::save_task,
            commands::delete_task,
            commands::write_text_file,
            commands::write_binary_file,
            commands::read_text_file,
            commands::read_binary_file,
            commands::export_all,
            commands::import_all,
            commands::get_setting,
            commands::set_setting,
            commands::get_provider_secret,
            commands::set_provider_secret,
            commands::get_report_tags,
            commands::set_report_tags,
            commands::run_ai,
            commands::repo_collect_commits,
            commands::repo_list_projects,
            commands::repo_test_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn sanity() {
        assert_eq!(2 + 2, 4);
    }
}
