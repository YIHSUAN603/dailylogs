use crate::repo::RepoCommits;
use chrono::{DateTime, Local, NaiveDate, Utc};
use reqwest::header::{ACCEPT, USER_AGENT};
use std::collections::HashMap;
use std::time::Duration;

/// GitHub REST API 版本（放 X-GitHub-Api-Version header）
const GITHUB_API_VERSION: &str = "2022-11-28";
/// 每頁筆數（repo / commit 列表分頁上限）
const PER_PAGE: usize = 100;
/// 同時並發撈 commit 的 repo 數上限（避免一次開太多連線）
const CONCURRENCY: usize = 10;

/// GitHub 連線設定
pub struct GithubConfig {
    /// GitHub REST API 位址，例如 https://api.github.com 或企業版 https://ghe.company.com/api/v3（尾斜線會被去除）
    pub api_url: String,
    /// owner 清單（org 或使用者名稱）
    pub owners: Vec<String>,
    pub token: String,
    /// 作者比對關鍵字（已 trim、去空；空陣列＝不過濾作者）
    pub authors: Vec<String>,
}

#[derive(serde::Deserialize)]
struct RepoItem {
    name: String,
}

#[derive(serde::Deserialize)]
struct CommitItem {
    #[serde(default)]
    commit: CommitDetail,
    /// 對應 GitHub 帳號（可能為 null，例如非 GitHub 使用者的 commit）
    #[serde(default)]
    author: Option<GhUser>,
}

#[derive(serde::Deserialize, Default)]
struct CommitDetail {
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    author: Option<CommitUser>,
}

#[derive(serde::Deserialize)]
struct CommitUser {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

#[derive(serde::Deserialize)]
struct GhUser {
    #[serde(default)]
    login: Option<String>,
}

fn base(cfg: &GithubConfig) -> &str {
    cfg.api_url.trim_end_matches('/')
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// GitHub 要求所有請求帶 User-Agent；同時帶 token、Accept 與 API 版本 header。
fn authed(req: reqwest::RequestBuilder, cfg: &GithubConfig) -> reqwest::RequestBuilder {
    req.bearer_auth(&cfg.token)
        .header(USER_AGENT, "dailylogs")
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
}

/// 對某個 owner 列出所有 repo：先當成 org 試，404 再退成使用者。含分頁。
async fn list_repositories(
    client: &reqwest::Client,
    cfg: &GithubConfig,
    owner: &str,
) -> Result<Vec<String>, String> {
    // (路徑, type 參數)：org 全部、使用者只取自身擁有
    let attempts = [
        (format!("{}/orgs/{}/repos", base(cfg), owner), "all"),
        (format!("{}/users/{}/repos", base(cfg), owner), "owner"),
    ];

    let mut last_status: Option<reqwest::StatusCode> = None;
    for (url, repo_type) in attempts {
        match fetch_repo_page(client, cfg, &url, repo_type, 1).await {
            Ok(Some(mut names)) => {
                // 第一頁成功，若滿頁則繼續往後抓
                let mut page = 2;
                let mut last_len = names.len();
                while last_len == PER_PAGE {
                    match fetch_repo_page(client, cfg, &url, repo_type, page).await {
                        Ok(Some(mut more)) => {
                            last_len = more.len();
                            names.append(&mut more);
                            page += 1;
                        }
                        _ => break,
                    }
                }
                return Ok(names);
            }
            Ok(None) => continue, // 404：換下一種 owner 型別
            Err((_e, status)) => {
                last_status = status;
                continue;
            }
        }
    }
    Err(format!(
        "owner「{owner}」列出 repo 失敗{}（請確認 owner 名稱、API 位址與 token 權限）",
        last_status
            .map(|s| format!("（回應 {s}）"))
            .unwrap_or_default()
    ))
}

/// 抓單頁 repo：Ok(Some(names))=成功、Ok(None)=404（該型別不存在）、Err=其他錯誤。
async fn fetch_repo_page(
    client: &reqwest::Client,
    cfg: &GithubConfig,
    url: &str,
    repo_type: &str,
    page: usize,
) -> Result<Option<Vec<String>>, (String, Option<reqwest::StatusCode>)> {
    let resp = authed(client.get(url), cfg)
        .query(&[
            ("per_page", PER_PAGE.to_string()),
            ("page", page.to_string()),
            ("type", repo_type.to_string()),
        ])
        .send()
        .await
        .map_err(|e| (format!("連線失敗：{e}"), None))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err((format!("回應 {}", resp.status()), Some(resp.status())));
    }
    let items: Vec<RepoItem> = resp
        .json()
        .await
        .map_err(|e| (format!("解析 repo 清單失敗：{e}"), None))?;
    Ok(Some(items.into_iter().map(|r| r.name).collect()))
}

/// 撈單一 repo 在時間窗內的 commit；失敗回空（不中斷其餘 repo）
async fn fetch_repo_commits(
    client: &reqwest::Client,
    cfg: &GithubConfig,
    owner: &str,
    repo: &str,
    from: &str,
    to: &str,
) -> Vec<CommitItem> {
    let url = format!("{}/repos/{}/{}/commits", base(cfg), owner, repo);
    let resp = authed(client.get(&url), cfg)
        .query(&[("since", from), ("until", to), ("per_page", "100")])
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => r.json::<Vec<CommitItem>>().await.unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// 列出所有設定 owner 的 repo 名稱（去重 + 排序，給工作面板匯入用）
pub async fn list_repos(cfg: &GithubConfig) -> Result<Vec<String>, String> {
    let client = build_client()?;
    let mut names: Vec<String> = Vec::new();
    for o in &cfg.owners {
        names.extend(list_repositories(&client, cfg, o).await?);
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// 列出所有設定 owner 的 repo 總數（測試連線用，錯誤會往上拋）
pub async fn count_repos(cfg: &GithubConfig) -> Result<usize, String> {
    let client = build_client()?;
    let mut total = 0;
    for o in &cfg.owners {
        total += list_repositories(&client, cfg, o).await?.len();
    }
    Ok(total)
}

/// 掃描所有 owner 的 repo，取出指定日期（當地時間）該作者的 commit 標題。
pub async fn collect_commits(cfg: &GithubConfig, date: &str) -> Result<Vec<RepoCommits>, String> {
    let target =
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| format!("日期格式錯誤：{date}"))?;
    // 拉寬到目標日 ±1 天（UTC），再用本機時區精準濾出當天，避開時區邊界
    let from = format!("{}T00:00:00Z", target.pred_opt().unwrap_or(target));
    let to = format!("{}T00:00:00Z", target.succ_opt().unwrap_or(target));

    let client = build_client()?;

    // 攤平成 (owner, repo_name)；某 owner 失敗則略過
    let mut flat: Vec<(String, String)> = Vec::new();
    for o in &cfg.owners {
        if let Ok(repos) = list_repositories(&client, cfg, o).await {
            for name in repos {
                flat.push((o.clone(), name));
            }
        }
    }

    // repo 名若在多個 owner 重複，顯示成 owner/repo 以區分
    let mut name_count: HashMap<&str, usize> = HashMap::new();
    for (_, name) in &flat {
        *name_count.entry(name.as_str()).or_insert(0) += 1;
    }

    let mut result: Vec<RepoCommits> = Vec::new();
    for chunk in flat.chunks(CONCURRENCY) {
        let futs = chunk.iter().map(|(owner, name)| {
            let client = &client;
            let cfg = &cfg;
            let from = from.as_str();
            let to = to.as_str();
            async move {
                let items = fetch_repo_commits(client, cfg, owner, name, from, to).await;
                (owner, name, items)
            }
        });
        for (owner, name, items) in futures::future::join_all(futs).await {
            let commits: Vec<String> = items
                .into_iter()
                .filter(|c| commit_on_date(c, target))
                .filter(|c| author_matches(c, &cfg.authors))
                .filter_map(|c| {
                    c.commit
                        .message
                        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
                        .filter(|l| !l.is_empty())
                })
                .collect();
            if commits.is_empty() {
                continue;
            }
            let display = if name_count.get(name.as_str()).copied().unwrap_or(0) > 1 {
                format!("{owner}/{name}")
            } else {
                name.clone()
            };
            result.push(RepoCommits {
                project: owner.to_string(),
                repo: display,
                commits,
            });
        }
    }
    // 先依 owner、再依 repo 排序，讓 format_commits 可用「連續同 owner」分組
    result.sort_by(|a, b| a.project.cmp(&b.project).then_with(|| a.repo.cmp(&b.repo)));
    Ok(result)
}

/// commit 的作者時間（UTC ISO8601）轉本機時區後，日期是否等於目標日
fn commit_on_date(c: &CommitItem, target: NaiveDate) -> bool {
    let date = match c.commit.author.as_ref().and_then(|a| a.date.as_deref()) {
        Some(d) => d,
        None => return false,
    };
    match DateTime::parse_from_rfc3339(date) {
        Ok(dt) => dt.with_timezone(&Local).date_naive() == target,
        // 退而求其次：當成 UTC 再轉本機
        Err(_) => match date.parse::<DateTime<Utc>>() {
            Ok(dt) => dt.with_timezone(&Local).date_naive() == target,
            Err(_) => false,
        },
    }
}

/// authors 為空＝全部通過；否則 commit 的 name / email / GitHub login
/// 任一不分大小寫包含任一關鍵字才通過
fn author_matches(c: &CommitItem, authors: &[String]) -> bool {
    if authors.is_empty() {
        return true;
    }
    let commit_author = c.commit.author.as_ref();
    let name = commit_author
        .and_then(|a| a.name.as_deref())
        .unwrap_or("")
        .to_lowercase();
    let email = commit_author
        .and_then(|a| a.email.as_deref())
        .unwrap_or("")
        .to_lowercase();
    let login = c
        .author
        .as_ref()
        .and_then(|a| a.login.as_deref())
        .unwrap_or("")
        .to_lowercase();
    authors.iter().any(|kw| {
        let kw = kw.to_lowercase();
        name.contains(&kw) || email.contains(&kw) || login.contains(&kw)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn commit_full(name: &str, email: &str, login: &str, date: &str) -> CommitItem {
        CommitItem {
            commit: CommitDetail {
                message: Some("fix: 修正".into()),
                author: Some(CommitUser {
                    name: Some(name.into()),
                    email: Some(email.into()),
                    date: Some(date.into()),
                }),
            },
            author: Some(GhUser {
                login: Some(login.into()),
            }),
        }
    }

    fn commit(name: &str, date: &str) -> CommitItem {
        commit_full(name, "", "", date)
    }

    #[test]
    fn author_empty_passes_all() {
        assert!(author_matches(&commit("Anyone", "x"), &[]));
    }

    #[test]
    fn author_contains_case_insensitive() {
        let authors = vec!["ARIESCHAO".to_string()];
        // name 命中
        assert!(author_matches(&commit("arieschao-nb\\user", "x"), &authors));
        // email 命中
        assert!(author_matches(
            &commit_full("Someone", "arieschao@example.com", "other", "x"),
            &authors
        ));
        // GitHub login 命中
        assert!(author_matches(
            &commit_full("Someone", "s@example.com", "ARIESChao", "x"),
            &authors
        ));
        // 三者皆不含 → 不通過
        assert!(!author_matches(
            &commit_full("someone", "s@example.com", "other", "x"),
            &authors
        ));
    }

    #[test]
    fn commit_on_date_converts_to_local() {
        // 用本機時區的當日中午組時間，避免測試依賴特定時區
        let target = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();
        let noon = Local
            .with_ymd_and_hms(2026, 7, 1, 12, 0, 0)
            .unwrap()
            .to_rfc3339();
        let c = commit("a", &noon);
        assert!(commit_on_date(&c, target));
        assert!(!commit_on_date(
            &c,
            NaiveDate::from_ymd_opt(2026, 7, 2).unwrap()
        ));
        // 沒有作者時間 → 不通過
        let no_date = CommitItem {
            commit: CommitDetail {
                message: Some("x".into()),
                author: None,
            },
            author: None,
        };
        assert!(!commit_on_date(&no_date, target));
    }
}
