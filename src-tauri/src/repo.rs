//! 儲存庫整合的共用層：各提供者（github / azure）撈完 commit 後
//! 統一以 `RepoCommits` 表示，再由 `format_commits` 組成文字。

/// 某個 repo 在指定日期、指定作者的 commit
#[derive(serde::Serialize)]
pub struct RepoCommits {
    /// repo 所屬的群組名稱（GitHub 為 owner、Azure DevOps 為團隊專案，可能為空）
    pub project: String,
    pub repo: String,
    pub commits: Vec<String>,
}

/// 把多個 repo 的 commit 組成給 AI / 隨手記用的文字。
/// 以「# 專案」為大標、「[repo]」為子層；專案間空一行，同專案下各 repo 連續。
/// 輸入須已先依 project、再依 repo 排序（collect_commits / 合併端已處理）。
pub fn format_commits(repos: &[RepoCommits]) -> String {
    let mut lines = Vec::new();
    let mut cur_project: Option<&str> = None;
    for rc in repos {
        if rc.commits.is_empty() {
            continue;
        }
        if cur_project != Some(rc.project.as_str()) {
            if !lines.is_empty() {
                lines.push(String::new());
            }
            if !rc.project.is_empty() {
                lines.push(format!("# {}", rc.project));
            }
            cur_project = Some(rc.project.as_str());
        }
        lines.push(format!("[{}]", rc.repo));
        for c in &rc.commits {
            lines.push(format!("- {c}"));
        }
    }
    lines.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_commits_groups_by_project() {
        let repos = vec![
            RepoCommits {
                project: "A".into(),
                repo: "r1".into(),
                commits: vec!["c1".into()],
            },
            RepoCommits {
                project: "A".into(),
                repo: "r2".into(),
                commits: vec!["c2".into()],
            },
            RepoCommits {
                project: "B".into(),
                repo: "r3".into(),
                commits: vec!["c3".into()],
            },
        ];
        assert_eq!(
            format_commits(&repos),
            "# A\n[r1]\n- c1\n[r2]\n- c2\n\n# B\n[r3]\n- c3"
        );
    }
}
