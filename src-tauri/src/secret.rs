//! GitHub token 的安全儲存：優先存 OS keychain（macOS 鑰匙圈 / Windows 憑證管理員 / Linux Secret Service），
//! keychain 不可用時（例如 WSL 沒有 Secret Service）退回 settings 表，行為與舊版相同。
use crate::db;
use keyring::Entry;
use rusqlite::Connection;

const SERVICE: &str = "com.richitech.dailylogs";
const USER: &str = "github_token";
const LEGACY_KEY: &str = "github_token";

fn entry() -> keyring::Result<Entry> {
    Entry::new(SERVICE, USER)
}

fn delete_legacy(conn: &Connection) {
    let _ = conn.execute("DELETE FROM settings WHERE key = ?1", [LEGACY_KEY]);
}

/// 讀取 token：keychain 優先；沒有時讀 settings 表（舊資料），
/// 並趁機把舊資料搬進 keychain（搬移成功才刪除 settings 內的明文）。
pub fn get_token(conn: &Connection) -> Result<String, String> {
    if let Ok(e) = entry() {
        match e.get_password() {
            Ok(p) => return Ok(p),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {} // keychain 不可用，退回 settings
        }
    }
    let legacy = db::get_setting(conn, LEGACY_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if !legacy.is_empty() {
        if let Ok(e) = entry() {
            if e.set_password(&legacy).is_ok() {
                delete_legacy(conn);
            }
        }
    }
    Ok(legacy)
}

/// 寫入 token：keychain 成功即清掉 settings 表的明文；keychain 不可用則存 settings 表。
pub fn set_token(conn: &Connection, value: &str) -> Result<(), String> {
    let v = value.trim();
    if let Ok(e) = entry() {
        if v.is_empty() {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {
                    delete_legacy(conn);
                    return Ok(());
                }
                Err(_) => {}
            }
        } else if e.set_password(v).is_ok() {
            delete_legacy(conn);
            return Ok(());
        }
    }
    db::set_setting(conn, LEGACY_KEY, v).map_err(|e| e.to_string())
}
