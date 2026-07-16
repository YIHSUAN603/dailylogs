//! Azure DevOps（含企業內 TFS / Azure DevOps Server）整合：
//! 走 `{base}/{collection}/_apis/...` REST API（api-version 3.0，相容舊 TFS，
//! 雲端填 `https://dev.azure.com` + collection=組織名 亦可）。
use crate::repo::RepoCommits;
use chrono::{DateTime, Local, NaiveDate, Utc};
use std::collections::HashMap;
use std::time::Duration;

const API_VERSION: &str = "3.0";
/// 同時並發撈 commit 的 repo 數上限（避免一次對 LAN TFS 開太多連線）
const CONCURRENCY: usize = 10;

/// Azure DevOps 連線設定
pub struct AzureConfig {
    /// 含 collection 之前的位址，例如 http://tfs.example.com:8080/tfs 或 https://dev.azure.com（尾斜線會被去除）
    pub base_url: String,
    pub collections: Vec<String>,
    pub pat: String,
    /// 作者比對關鍵字（已 trim、去空；空陣列＝不過濾作者）
    pub authors: Vec<String>,
}

#[derive(serde::Deserialize)]
struct ReposResp {
    #[serde(default)]
    value: Vec<RepoItem>,
}

#[derive(serde::Deserialize)]
struct RepoItem {
    id: String,
    name: String,
    #[serde(default)]
    project: ProjectRef,
}

#[derive(serde::Deserialize, Default)]
struct ProjectRef {
    #[serde(default)]
    name: String,
}

#[derive(serde::Deserialize)]
struct ProjectsResp {
    #[serde(default)]
    value: Vec<ProjectItem>,
}

#[derive(serde::Deserialize)]
struct ProjectItem {
    name: String,
}

#[derive(serde::Deserialize)]
struct CommitsResp {
    #[serde(default)]
    value: Vec<CommitItem>,
}

#[derive(serde::Deserialize)]
struct CommitItem {
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    author: Option<CommitUser>,
}

#[derive(serde::Deserialize)]
struct CommitUser {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

fn base(cfg: &AzureConfig) -> &str {
    cfg.base_url.trim_end_matches('/')
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// 列出單一 collection 底下所有 git repo
async fn list_repositories(
    client: &reqwest::Client,
    cfg: &AzureConfig,
    collection: &str,
) -> Result<Vec<RepoItem>, String> {
    let url = format!("{}/{}/_apis/git/repositories", base(cfg), collection);
    let resp = client
        .get(&url)
        .basic_auth("", Some(&cfg.pat))
        .query(&[("api-version", API_VERSION)])
        .send()
        .await
        .map_err(|e| format!("連線失敗：{e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "collection「{collection}」回應 {}（請確認位址、collection 名稱與 PAT 權限）",
            resp.status()
        ));
    }
    let parsed: ReposResp = resp
        .json()
        .await
        .map_err(|e| format!("解析 repo 清單失敗：{e}"))?;
    Ok(parsed.value)
}

/// 撈單一 repo 在時間窗內的 commit；失敗回空（不中斷其餘 repo）
async fn fetch_repo_commits(
    client: &reqwest::Client,
    cfg: &AzureConfig,
    collection: &str,
    repo_id: &str,
    from: &str,
    to: &str,
) -> Vec<CommitItem> {
    let url = format!(
        "{}/{}/_apis/git/repositories/{}/commits",
        base(cfg),
        collection,
        repo_id
    );
    let resp = client
        .get(&url)
        .basic_auth("", Some(&cfg.pat))
        .query(&[
            ("searchCriteria.fromDate", from),
            ("searchCriteria.toDate", to),
            ("api-version", API_VERSION),
        ])
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => r
            .json::<CommitsResp>()
            .await
            .map(|c| c.value)
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// 列出單一 collection 底下所有團隊專案名稱
async fn list_collection_projects(
    client: &reqwest::Client,
    cfg: &AzureConfig,
    collection: &str,
) -> Result<Vec<String>, String> {
    let url = format!("{}/{}/_apis/projects", base(cfg), collection);
    let resp = client
        .get(&url)
        .basic_auth("", Some(&cfg.pat))
        .query(&[("api-version", API_VERSION)])
        .send()
        .await
        .map_err(|e| format!("連線失敗：{e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "collection「{collection}」回應 {}（請確認位址、collection 名稱與 PAT 權限）",
            resp.status()
        ));
    }
    let parsed: ProjectsResp = resp
        .json()
        .await
        .map_err(|e| format!("解析專案清單失敗：{e}"))?;
    Ok(parsed.value.into_iter().map(|p| p.name).collect())
}

/// 列出所有設定 collection 的團隊專案名稱（去重 + 排序，給工作面板匯入用）
pub async fn list_projects(cfg: &AzureConfig) -> Result<Vec<String>, String> {
    let client = build_client()?;
    let mut names: Vec<String> = Vec::new();
    for c in &cfg.collections {
        names.extend(list_collection_projects(&client, cfg, c).await?);
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// 列出所有設定 collection 的 repo 總數（測試連線用，錯誤會往上拋）
pub async fn count_repos(cfg: &AzureConfig) -> Result<usize, String> {
    let client = build_client()?;
    let mut total = 0;
    for c in &cfg.collections {
        total += list_repositories(&client, cfg, c).await?.len();
    }
    Ok(total)
}

/// 掃描所有 collection 的 repo，取出指定日期（當地時間）該作者的 commit 標題。
pub async fn collect_commits(cfg: &AzureConfig, date: &str) -> Result<Vec<RepoCommits>, String> {
    let target =
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| format!("日期格式錯誤：{date}"))?;
    // 拉寬到目標日 ±1 天（UTC），再用本機時區精準濾出當天，避開時區邊界
    let from = format!("{}T00:00:00Z", target.pred_opt().unwrap_or(target));
    let to = format!("{}T00:00:00Z", target.succ_opt().unwrap_or(target));

    let client = build_client()?;

    // 攤平成 (collection, repo_id, repo_name, project_name)；某 collection 失敗則略過
    let mut flat: Vec<(String, String, String, String)> = Vec::new();
    for c in &cfg.collections {
        if let Ok(repos) = list_repositories(&client, cfg, c).await {
            for r in repos {
                flat.push((c.clone(), r.id, r.name, r.project.name));
            }
        }
    }

    // repo 名若在多個 collection 重複，顯示成 collection/repo 以區分
    let mut name_count: HashMap<&str, usize> = HashMap::new();
    for (_, _, name, _) in &flat {
        *name_count.entry(name.as_str()).or_insert(0) += 1;
    }

    let mut result: Vec<RepoCommits> = Vec::new();
    for chunk in flat.chunks(CONCURRENCY) {
        let futs = chunk.iter().map(|(coll, id, name, project)| {
            let client = &client;
            let cfg = &cfg;
            let from = from.as_str();
            let to = to.as_str();
            async move {
                let items = fetch_repo_commits(client, cfg, coll, id, from, to).await;
                (coll, name, project, items)
            }
        });
        for (coll, name, project, items) in futures::future::join_all(futs).await {
            let commits: Vec<String> = items
                .into_iter()
                .filter(|c| commit_on_date(c, target))
                .filter(|c| author_matches(c, &cfg.authors))
                .filter_map(|c| {
                    c.comment
                        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
                        .filter(|l| !l.is_empty())
                })
                .collect();
            if commits.is_empty() {
                continue;
            }
            let display = if name_count.get(name.as_str()).copied().unwrap_or(0) > 1 {
                format!("{coll}/{name}")
            } else {
                name.clone()
            };
            result.push(RepoCommits {
                project: project.clone(),
                repo: display,
                commits,
            });
        }
    }
    // 先依 project、再依 repo 排序，讓 format_commits 可用「連續同 project」分組
    result.sort_by(|a, b| a.project.cmp(&b.project).then_with(|| a.repo.cmp(&b.repo)));
    Ok(result)
}

/// commit 的作者時間（UTC ISO8601）轉本機時區後，日期是否等於目標日
fn commit_on_date(c: &CommitItem, target: NaiveDate) -> bool {
    let date = match c.author.as_ref().and_then(|a| a.date.as_deref()) {
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

/// authors 為空＝全部通過；否則 author.name 不分大小寫包含任一關鍵字才通過
fn author_matches(c: &CommitItem, authors: &[String]) -> bool {
    if authors.is_empty() {
        return true;
    }
    let name = c
        .author
        .as_ref()
        .and_then(|a| a.name.as_deref())
        .unwrap_or("")
        .to_lowercase();
    authors.iter().any(|kw| name.contains(&kw.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn commit(author: &str, date: &str) -> CommitItem {
        CommitItem {
            comment: Some("fix: 修正".into()),
            author: Some(CommitUser {
                name: Some(author.into()),
                date: Some(date.into()),
            }),
        }
    }

    #[test]
    fn author_empty_passes_all() {
        assert!(author_matches(&commit("Anyone", "x"), &[]));
    }

    #[test]
    fn author_contains_case_insensitive() {
        let authors = vec!["ARIESCHAO".to_string()];
        assert!(author_matches(&commit("arieschao-nb\\user", "x"), &authors));
        assert!(!author_matches(&commit("someone", "x"), &authors));
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
            comment: Some("x".into()),
            author: None,
        };
        assert!(!commit_on_date(&no_date, target));
    }
}
