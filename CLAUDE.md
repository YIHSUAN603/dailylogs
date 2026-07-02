# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

日報告 DailyLogs：撰寫工作日報的桌面應用程式（Tauri 2）。降低「回想做了什麼 + 排版打字」的成本，並一鍵產出可寄送/貼上的格式化日報。前端 React 19 + TypeScript + Vite + Tailwind v4，後端 Rust，資料存本機 SQLite。

## 開發指令

```bash
npm install
npm run tauri dev      # 開發模式（啟動 vite + Rust，開視窗）
npm run tauri build    # 打包桌面 app
npm run build          # 僅前端：tsc 型別檢查 + vite build（驗證前端是否能編譯）
npm run dev            # 僅 vite（瀏覽器無 Tauri API，invoke 會失敗，僅看版面用）
```

- Rust toolchain 在 `~/.cargo/bin`；非登入 shell 需 `export PATH="$HOME/.cargo/bin:$PATH"`。
- 測試：前端 vitest（`npm run test:run`，測試檔在 `src/lib/*.test.ts`）；後端 `cargo test`（`db.rs`/`tfs.rs` 內的 `#[cfg(test)]`，用 in-memory SQLite）。驗證編譯：前端 `npm run build`（含 `tsc`）、後端 `cargo check`（在 `src-tauri/`）。CI 另跑 `npm run lint`、`cargo fmt --check`、`cargo clippy -D warnings`。

### 在 WSLg 啟動（本機環境）

WSL2 + WSLg 跑 Tauri 有兩個必踩的坑：

- **必須** `export WEBKIT_DISABLE_DMABUF_RENDERER=1`（建議再加 `WEBKIT_DISABLE_COMPOSITING_MODE=1`），否則 WebKitGTK 因 GPU 渲染失敗（log 停在 `MESA: error: ZINK`）**靜默閃退、無 panic**。EGL/MESA 警告是軟體渲染的正常雜訊。
- 用 Bash 工具的 `run_in_background:true` 啟動，**不要**加 `setsid`/`nohup`/`&`——會孤立 vite 子行程，binary 活著但 port 1420 沒人聽，視窗變空白。
- 殺行程：binary 的 cmdline 是相對路徑，用 `pkill -9 -f "target/debug/dailylogs"`（`pkill -f "project/dailylogs"` 殺不到）。
- 驗證成功：log 出現 `` Running `target/debug/dailylogs` `` 後，`ss -ltn | grep :1420`（vite）與 binary 行程兩者都在。

## 架構

### 前後端橋接

前端透過 `@tauri-apps/api` 的 `invoke` 呼叫 Rust 的 `#[tauri::command]`。所有 command 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 註冊；前端對應的 typed wrapper 集中在 `src/lib/api.ts`（**新增 command 時兩處都要改**）。Rust 端 command（`src-tauri/src/commands.rs`）只做薄薄一層：取 DB 鎖、轉錯誤成 `String`，再委派給 `db` / `ai` / `git` 模組。

DB 連線是單一 `Connection` 包在 `Mutex` 裡，於 `lib.rs` 的 `setup` 建立並 `app.manage` 成全域 state（`DbState`）。資料庫位於系統 app data 目錄下 `dailylogs.db`。

### 核心資料模型：自由 Markdown（`raw_notes` 為準）

**重要**：歷史上曾有「四段式日報」→「category-first 分類為主 + 四面向」兩代設計，**現行模型是自由 Markdown**。一份 `Report`（一天一份，date 為 PK）的內容就是 `raw_notes` 這個 Markdown 字串，是**唯一內容來源**；編輯、匯出、AI、週報彙整全部讀它。使用者可自由使用任意 Markdown 語法（標題、清單、表格、程式碼…），不再被固定結構強制。

`Category[]` / `ASPECTS`（`src/types.ts`）與 `db.rs` 的 `categories` JSON 欄位**仍存在但已退場**：DB 欄位保留只存空陣列（未改 Rust，避免 schema 遷移），前端不再用它承載內容。唯一還用到 `categories` 的地方是 `src/lib/format.ts` 的 `reportToEditableText()`——把**舊資料**（只有 categories、raw_notes 空）開啟時一次性轉成 Markdown 寫回 `raw_notes`（見 `ReportEditor.tsx` 的遷移 effect）。`format.ts` 的 `toItems()`/`groupByProject()`/`hasContent()` 目前只服務這條遷移路徑。

`format.ts` 另提供 `markdownToPlain()`：把 Markdown 去掉標題井號/清單符號/行內粗體，給通訊軟體貼上。

### AI 整合（呼叫外部 CLI）

不直接呼叫 API，而是執行使用者設定的本機 CLI（預設 `claude -p`，存在 settings 表 key `ai_command`）。`src-tauri/src/ai.rs` 把命令字串以空白切成「程式 + 參數」（不經 shell，避免注入），prompt 經 **stdin** 傳入、讀 stdout。`run_ai` command 為 `async`，讓阻塞子行程跑在 Tauri 執行緒池不卡 UI。

prompt 工程全在前端 `src/lib/ai.ts`：`organizeReport`（零散記事→日報）、`polishReport`（潤稿）、`summarizeRange`（彙整週/月報）、`generateTags`。`organizeReport`/`polishReport` 共用 `FORMAT_RULE` 建議 AI 輸出 `# 專案 / ## 子分類 / ### 面向 / - 條列` 的排版，但**直接回傳 Markdown 文字**寫回 `raw_notes`（使用者可再自由編輯），不再解析成結構。`summarizeRange`/`generateTags` 也直接吃 `raw_notes`。

（舊版的 `parseCategories()` 解析、`draftFromCommits` 已移除；現在 FORMAT_RULE 只是排版建議，沒有「解析回 Category」的綁定契約。）

### TFS 整合

`src-tauri/src/tfs.rs`：走地端 Azure DevOps（TFS）REST API（api-version 固定 3.0、PAT Basic Auth）。`collect_commits` 掃所有 collection 的 repo、取指定日期（本機時區，查詢窗放寬 ±1 天避開時區邊界）該作者的 commit 標題，單一 collection/repo 失敗會跳過不中斷，併發上限 10。作者比對是「逗號分隔關鍵字、不分大小寫包含」。設定存 settings 表：`tfs_base_url`、`tfs_collections`（JSON 陣列）、`git_author`；PAT 見下方設定儲存。

### 設定儲存

一般設定走 SQLite `settings` 表（key-value），透過 `get_setting`/`set_setting` 存取。key 常數在 `commands.rs`（Rust 端）與 `api.ts`（前端）各定義一份，需保持一致。**例外：TFS PAT** 走 `src-tauri/src/secret.rs`（`get_tfs_pat`/`set_tfs_pat` command）——優先存 OS keychain（Windows 憑證管理員 / Linux Secret Service），keychain 不可用（如 WSL）則退回 settings 表，讀取時會自動把舊明文搬進 keychain；匯出備份一律排除 PAT。

### 前端結構與狀態

`src/App.tsx` 是唯一狀態中心：管理目前日報、清單、view 切換（`editor` / `settings` / `weekly` / `work`）。編輯採 **600ms 防抖自動存檔**（`handleChange` + `pendingSave` ref；切換日期/刪除前會 flush/丟棄未觸發的存檔）。`ReportEditor` 以 `key={report.date}` 掛載，切日即重建，並在 AI 完成時丟棄已卸載元件的結果，避免寫進別天。全域提示走 `src/lib/toast.ts` + `<Toaster />`（勿再用 `alert()`）。`ReportEditor.tsx` 用 `@uiw/react-md-editor`（內建工具列 / 並排即時預覽 / Tab 縮排 / Enter 接清單），onChange 只更新 `raw_notes`。`src/components/`（Sidebar, ReportEditor, Toaster…）、`src/views/`（SettingsView, WeeklyView, WorkView）。

### 匯出

`src/lib/export.ts`：全部以 `raw_notes` 的 **Markdown 原文**為來源直接呈現——剪貼簿 Markdown / 存 .md = 原文；純文字 = `markdownToPlain()`；Word = 逐行把 Markdown 轉成 `docx` 段落（中文字型 `Microsoft JhengHei`）；PDF = 用 `react-dom/server` 的 `renderToStaticMarkup` 把 `<ReactMarkdown remarkPlugins={[remarkGfm]}>` 算成 HTML，再塞隱藏 iframe 觸發系統列印對話框。寫檔走 Rust 的 `write_text_file`/`write_binary_file`（路徑由前端 dialog 取得）。
