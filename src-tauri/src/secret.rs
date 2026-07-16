//! 整合 token / PAT 的安全儲存：優先存 OS keychain（macOS 鑰匙圈 / Windows 憑證管理員 /
//! Linux Secret Service），keychain 不可用時（例如 WSL 沒有 Secret Service）退回 settings 表。
//! 每種秘密以 `SecretKind` 描述 keychain 帳號名與 settings 表的舊明文 key。
use crate::db;
use keyring::Entry;
use rusqlite::Connection;

const SERVICE: &str = "com.arieschao.dailylogs";

/// 一種要保管的秘密：keychain 的帳號名 + settings 表的舊明文 key（讀到會自動搬進 keychain）
#[derive(Clone, Copy)]
pub struct SecretKind {
    user: &'static str,
    legacy_key: &'static str,
}

/// GitHub Personal Access Token
pub const GITHUB_TOKEN: SecretKind = SecretKind {
    user: "github_token",
    legacy_key: "github_token",
};

/// Azure DevOps / TFS Personal Access Token（舊版 TFS 整合的明文存於 tfs_pat）
pub const AZURE_PAT: SecretKind = SecretKind {
    user: "azure_pat",
    legacy_key: "tfs_pat",
};

fn entry(kind: SecretKind) -> keyring::Result<Entry> {
    Entry::new(SERVICE, kind.user)
}

fn delete_legacy(conn: &Connection, kind: SecretKind) {
    let _ = conn.execute("DELETE FROM settings WHERE key = ?1", [kind.legacy_key]);
}

/// 讀取秘密：keychain 優先；沒有時讀 settings 表（舊資料），
/// 並趁機把舊資料搬進 keychain（搬移成功才刪除 settings 內的明文）。
pub fn get(conn: &Connection, kind: SecretKind) -> Result<String, String> {
    if let Ok(e) = entry(kind) {
        match e.get_password() {
            Ok(p) => return Ok(p),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {} // keychain 不可用，退回 settings
        }
    }
    let legacy = db::get_setting(conn, kind.legacy_key)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if !legacy.is_empty() {
        if let Ok(e) = entry(kind) {
            if e.set_password(&legacy).is_ok() {
                delete_legacy(conn, kind);
            }
        }
    }
    Ok(legacy)
}

/// 寫入秘密：keychain 成功即清掉 settings 表的明文；keychain 不可用則存 settings 表。
pub fn set(conn: &Connection, kind: SecretKind, value: &str) -> Result<(), String> {
    let v = value.trim();
    if let Ok(e) = entry(kind) {
        if v.is_empty() {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {
                    delete_legacy(conn, kind);
                    return Ok(());
                }
                Err(_) => {}
            }
        } else if e.set_password(v).is_ok() {
            delete_legacy(conn, kind);
            return Ok(());
        }
    }
    db::set_setting(conn, kind.legacy_key, v).map_err(|e| e.to_string())
}
