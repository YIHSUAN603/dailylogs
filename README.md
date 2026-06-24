# 日報告 DailyLogs

撰寫工作日報的桌面應用程式。核心目標：降低「每天回想做了什麼 + 排版打字」的成本，並能一鍵產出可寄送/貼上的格式化日報。

## 功能（規劃）

- **四段式日報**：今日完成事項 / 進行中 / 遇到的問題 / 明日計劃
- **本機儲存**：SQLite，一天一份，自動存草稿
- **AI 協助**：零散記事 → 正式日報、潤稿、自動下標籤、日報彙整成週報（呼叫本機 `claude` CLI）
- **Git 整合**：掃指定 repo 當天 commit，AI 草擬日報
- **輸出**：複製到剪貼簿、Markdown、PDF、Word

## 技術

- [Tauri 2](https://tauri.app/)（Rust 後端）
- React + TypeScript + Vite + Tailwind CSS v4
- SQLite（`rusqlite`，bundled）

## 開發

```bash
npm install
npm run tauri dev      # 開發模式（WSL 需 WSLg 才能顯示視窗）
npm run tauri build    # 打包
```

需先安裝 [Rust](https://rustup.rs/) 與 Tauri 的系統相依套件，見官方 [prerequisites](https://tauri.app/start/prerequisites/)。

## 打包 Windows 執行檔（WSL / Linux 交叉編譯）

Tauri 官方不支援從 Linux 交叉編譯 MSI（需 WiX），但可用 [`cargo-xwin`](https://github.com/rust-cross/cargo-xwin) 產出 exe 與 NSIS 安裝程式。

一次性環境準備：

```bash
cargo install cargo-xwin
rustup target add x86_64-pc-windows-msvc
```

打包：

```bash
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

- `--bundles nsis` 為必要：MSI 在 Linux 上做不出來，不限定會在 MSI 步驟失敗。
- 產物位於 `src-tauri/target/x86_64-pc-windows-msvc/release/`：
  - `dailylogs.exe`：獨立執行檔
  - `bundle/nsis/日報告 DailyLogs_<version>_x64-setup.exe`：NSIS 安裝程式（建議發布此版，會引導安裝 WebView2）
- 交叉編譯不會簽章；未簽章的 exe 在 Windows 上會觸發 SmartScreen 警告。
- 目標機若為 Windows 10 且未內建 WebView2 Runtime，直接執行獨立 exe 可能無法開啟，故對外發布優先給安裝程式版本。
- 發布前記得同步更新 `src-tauri/tauri.conf.json` 與 `src-tauri/Cargo.toml` 的 `version`。

## 打包 Linux 執行檔

Linux 為原生 host，直接打包即可（不需交叉編譯）：

```bash
npm run tauri build
```

產物位於 `src-tauri/target/release/`：

- `dailylogs`：裸執行檔（靠系統提供 WebKitGTK 等相依）
- `bundle/appimage/日報告 DailyLogs_<version>_amd64.AppImage`：可攜單檔，內含相依，`chmod +x` 後即可執行（對外發布建議用此格式）
- `bundle/deb/日報告 DailyLogs_<version>_amd64.deb`：Debian/Ubuntu 安裝包
- `bundle/rpm/日報告 DailyLogs-<version>-1.x86_64.rpm`：Fedora/RHEL 安裝包

> WSLg 環境下執行任一產物前，需先 `export WEBKIT_DISABLE_DMABUF_RENDERER=1`，否則 WebKitGTK 會靜默閃退（一般 Linux 桌面通常不需要）。

## 專案結構

```
src/                  前端（React）
  components/         Sidebar, ReportEditor, SectionField
  lib/                api（呼叫 Rust）、format（Markdown/純文字）
  types.ts            Report 型別與四段式定義
src-tauri/src/
  db.rs               SQLite 結構與 CRUD
  commands.rs         #[tauri::command] 對前端的 API
  lib.rs              app 進入點、DB 初始化
```

資料庫位置：系統的 app data 目錄下 `dailylogs.db`。
