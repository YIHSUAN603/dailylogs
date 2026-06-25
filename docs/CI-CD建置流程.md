# CI/CD 建置流程 — DailyLogs Azure Pipeline

本文件說明如何從零把 `azure-pipelines.yml` 接上 Azure DevOps 並順利運作。
適用環境：**self-hosted Windows agent + 原生 MSVC 編譯**。

---

## 0. 這條 pipeline 在做什麼

| Stage | 觸發條件 | 工作內容 |
| --- | --- | --- |
| **CI** | push / PR 到 `develop`、`main`（tag 不跑） | `npm ci` → `npm run build`（tsc + vite）→ ESLint → Vitest → `cargo fmt --check` → `cargo clippy -D warnings` → `cargo test` |
| **Release** | 推 `v*` tag（如 `v1.2.0`） | 版本一致性檢查 → `tauri build --bundles nsis`（MSVC 原生）→ 發佈 artifact → 上傳 Google Drive |

兩個 stage 都要求 agent：`Agent.OS = Windows_NT`，且具備自訂 capability `node`、`rust`。

---

## 1. 前置：準備一台 Windows 建置機

agent 要能跑 `npm run tauri build`，所以這台機器需安裝：

| 軟體 | 用途 | 備註 |
| --- | --- | --- |
| Node.js LTS | 前端 build / `npm ci` | 裝完 `node -v` 確認 |
| Rust（rustup） | `cargo` / clippy / fmt / build | `rustup target add x86_64-pc-windows-msvc` |
| **Visual Studio Build Tools（C++ 工作負載）** | MSVC 原生編譯 | ⚠️ 授權注意：VS *Community* 對「>250 台裝置 **或** 年營收 >USD 100 萬」的企業有限制，超過門檻需改用付費版或改裝獨立的 *Build Tools* |
| WebView2 Runtime | Tauri 執行 / 打包依賴 | Win11 內建；Win10 可能要補裝 |
| NSIS | `--bundles nsis` 產安裝檔 | tauri 可自動下載，或手動裝 |

> ⚠️ **不要把 agent 裝進 WSL**：WSL 回報 `Agent.OS = Linux`，永遠不符合 `Windows_NT` 的 demand，且 WSL 內沒有 MSVC，Release 無法原生編譯。agent 必須裝在 **Windows 本體**。

**驗收前置**：在這台機器手動跑一次成功，再往下接 agent：

```powershell
npm ci
npm run tauri build -- --bundles nsis
```

---

## 2. 把 repo 放上 Azure DevOps

- repo 已在 Azure DevOps Repos → 跳過。
- 在別處 → 建專案後 `git remote add` 推上去（pipeline 用 `checkout: self`，repo 在同專案即可）。

---

## 3. 建立 Agent Pool 並安裝 agent

1. **Organization Settings → Agent pools → Add pool**，型別選 **Self-hosted**，命名（例：`WinBuild`）。
2. 進該 pool → **New agent** → 選 Windows，在建置機上：
   ```powershell
   # 解壓下載的 agent 後
   .\config.cmd   # 輸入 org URL、PAT、pool 名稱、agent 名稱
   .\run.cmd      # 或裝成 Windows service 常駐
   ```
   PAT 需具備 **Agent Pools (read, manage)** 權限。

### 3.1 加上 `node` / `rust` 自訂 capability（關鍵）

少了這兩個，job 會永遠卡在排隊。在建置機設**系統環境變數**（名稱即 capability 名，值隨意）：

```
node = 1
rust = 1
```

設完**重啟 agent**，到 pool → agent → **Capabilities** 確認 `node`、`rust` 出現在 User-defined 區。

---

## 4. 改 pipeline 裡的 pool 名稱

`azure-pipelines.yml` 有**兩處** `REPLACE_WITH_YOUR_POOL`（CI 與 Release 各一），改成步驟 3 的 pool 名稱。

---

## 5. 確認平行作業授權

- Self-hosted agent 免費額度為 **1 條平行 job**。
- 新 org 偶爾預設為 0，會報 `no hosted parallelism has been purchased or granted`。
- 解法：**Organization Settings → Parallel jobs** 申請免費 self-hosted 額度（微軟免費申請，約 1–3 工作天）。

---

## 6. 設定 Google Drive 上傳（rclone 個人 OAuth）

Release 最後會把安裝檔上傳到個人雲端硬碟的 `tools/dailylogs/dailylogs_<版號>/`。

### 6.1 本機授權一次（取得 token）

在任一台有瀏覽器的電腦：

1. 裝 rclone：`winget install Rclone.Rclone`（或 rclone.org 下載）。
2. `rclone config`：
   - `n`（New remote）
   - name 輸入 **`gdrive`**（⚠️ 一定要這名字，YAML 對應它）
   - Storage 選 **`drive`**
   - client_id / client_secret 可留空（用內建；想穩定可自建 GCP OAuth client）
   - scope 選 **`1`（drive 完整存取）**
   - 其餘預設，「Use auto config?」選 **Yes** → 瀏覽器登入授權 → `y` → `q`
3. `rclone config file` 找到設定檔（通常 `%APPDATA%\rclone\rclone.conf`），內含 `refresh_token`。

### 6.2 上傳成 Secure file

**Pipelines → Library → Secure files → Upload**，上傳上一步的 `rclone.conf`，**檔名必須是 `rclone.conf`**。

> 個人 Drive 不需要任何額外變數（不用 team_drive / 共用硬碟 ID）。

---

## 7. 建立 Pipeline

1. **Pipelines → New pipeline → Azure Repos Git → 選 repo**。
2. 選 **Existing Azure Pipelines YAML file** → 路徑 `/azure-pipelines.yml`。
3. **Save**。

---

## 8. 版本一致性規則（發版前必看）

Release 第一步會檢查並 fail fast：

```
tag 版號  ==  src-tauri/tauri.conf.json 的 version  ==  src-tauri/Cargo.toml 的 version
```

三者不一致就中止。**注意：此檢查不含 `package.json`。** 發 tag 前先對齊：

- `src-tauri/Cargo.toml` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`
- （建議一併同步 `package.json`，雖然不在檢查範圍）

---

## 9. 觸發行為

| 動作 | 結果 |
| --- | --- |
| push / PR 到 `develop`、`main` | 跑 **CI**（型別/lint/測試） |
| 推 `v*` tag | 跑 **Release**：版本檢查 → MSVC 打包 NSIS → 發佈 `nsis-installer` / `standalone-exe` artifact → 上傳 Google Drive |

---

## 10. 驗收路徑

1. 完成步驟 1–7 後，對 `develop` 推一個小 commit → 應觸發 **CI** 並全綠。
2. CI 過了再測 Release：對齊三處版號 → 打 tag：
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
   → 應觸發 **Release**，在 pipeline run 的 Artifacts 看到安裝檔，並在 Google Drive `tools/dailylogs/dailylogs_v1.2.0/` 看到上傳結果。

---

## 附錄：常見錯誤排查

| 症狀 | 可能原因 / 解法 |
| --- | --- |
| job 一直卡在排隊（不開始） | agent 缺 `node` / `rust` capability，或 pool 名稱沒對上 |
| `no hosted parallelism...` | 平行作業額度為 0，見第 5 節申請 |
| 版本檢查失敗中止 Release | tag / tauri.conf.json / Cargo.toml 三者版號不一致，見第 8 節 |
| `DownloadSecureFile` 找不到 `rclone.conf` | 沒上傳 Secure file 或檔名不符，見 6.2 |
| rclone 上傳 401 / 找不到遠端 | `rclone.conf` 內遠端不叫 `gdrive`，或 token 失效需重新 `rclone config` |
| MSVC 編譯失敗（link.exe 缺失等） | 建置機沒裝 VS Build Tools 的 C++ 工作負載，見第 1 節 |
| 打包閃退 / WebView2 相關 | 建置機缺 WebView2 Runtime |
