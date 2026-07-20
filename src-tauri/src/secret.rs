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

fn entry(user: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, user)
}

fn delete_legacy(conn: &Connection, legacy_key: &str) {
    let _ = conn.execute("DELETE FROM settings WHERE key = ?1", [legacy_key]);
}

/// 讀取秘密：keychain（帳號 `user`）優先；沒有時讀 settings 表的 `legacy_key`（舊資料），
/// 並趁機把舊資料搬進 keychain（搬移成功才刪除 settings 內的明文）。
fn get_by(conn: &Connection, user: &str, legacy_key: &str) -> Result<String, String> {
    if let Ok(e) = entry(user) {
        match e.get_password() {
            Ok(p) => return Ok(p),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {} // keychain 不可用，退回 settings
        }
    }
    let legacy = db::get_setting(conn, legacy_key)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    if !legacy.is_empty() {
        if let Ok(e) = entry(user) {
            if e.set_password(&legacy).is_ok() {
                delete_legacy(conn, legacy_key);
            }
        }
    }
    Ok(legacy)
}

/// 寫入秘密：keychain 成功即清掉 settings 表的明文；keychain 不可用則存 settings 表。
fn set_by(conn: &Connection, user: &str, legacy_key: &str, value: &str) -> Result<(), String> {
    let v = value.trim();
    if let Ok(e) = entry(user) {
        if v.is_empty() {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {
                    delete_legacy(conn, legacy_key);
                    return Ok(());
                }
                Err(_) => {}
            }
        } else if e.set_password(v).is_ok() {
            delete_legacy(conn, legacy_key);
            return Ok(());
        }
    }
    db::set_setting(conn, legacy_key, v).map_err(|e| e.to_string())
}

/// 讀取固定種類的秘密（GitHub token / Azure PAT，供遷移讀舊值）
pub fn get(conn: &Connection, kind: SecretKind) -> Result<String, String> {
    get_by(conn, kind.user, kind.legacy_key)
}

/// per-instance 秘密的 keychain 帳號名
fn provider_user(id: &str) -> String {
    format!("provider_{id}")
}

/// per-instance 秘密的 settings 表 fallback key（keychain 不可用時）
fn provider_legacy_key(id: &str) -> String {
    format!("provider_secret_{id}")
}

/// 讀取某來源（provider id）的 token/PAT，沒有時回傳空字串
pub fn get_provider(conn: &Connection, id: &str) -> Result<String, String> {
    get_by(conn, &provider_user(id), &provider_legacy_key(id))
}

/// 寫入某來源（provider id）的 token/PAT（空字串＝刪除）
pub fn set_provider(conn: &Connection, id: &str, value: &str) -> Result<(), String> {
    set_by(conn, &provider_user(id), &provider_legacy_key(id), value)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 只驗證 key 命名（不觸碰真實 keychain）：fallback settings key 必須以
    // provider_secret_ 開頭，才會被 db::all_settings 的 NOT LIKE 排除、不隨備份外洩。
    #[test]
    fn provider_keys_derivation() {
        assert_eq!(provider_user("abc"), "provider_abc");
        assert_eq!(provider_legacy_key("abc"), "provider_secret_abc");
        assert!(provider_legacy_key("x").starts_with("provider_secret_"));
    }
}
