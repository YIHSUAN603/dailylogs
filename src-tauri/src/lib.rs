mod ai;
mod commands;
mod db;
mod github;
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
        .setup(|app| {
            // 資料庫放在系統的 app data 目錄
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("dailylogs.db"))?;
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
            commands::export_all,
            commands::import_all,
            commands::get_setting,
            commands::set_setting,
            commands::get_github_token,
            commands::set_github_token,
            commands::get_report_tags,
            commands::set_report_tags,
            commands::run_ai,
            commands::github_collect_commits,
            commands::github_test_connection,
            commands::github_list_repos,
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
