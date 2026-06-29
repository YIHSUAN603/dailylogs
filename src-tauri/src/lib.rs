mod ai;
mod commands;
mod db;
mod tfs;

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
            commands::get_task,
            commands::save_task,
            commands::delete_task,
            commands::write_text_file,
            commands::write_binary_file,
            commands::read_text_file,
            commands::export_all,
            commands::import_all,
            commands::get_setting,
            commands::set_setting,
            commands::get_report_tags,
            commands::set_report_tags,
            commands::run_ai,
            commands::git_collect_commits,
            commands::tfs_test_connection,
            commands::tfs_list_projects,
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
