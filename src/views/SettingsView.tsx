import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AI_COMMAND_KEY,
  GIT_AUTHOR_KEY,
  TFS_BASE_URL_KEY,
  TFS_COLLECTIONS_KEY,
  THEME_ACCENT_KEY,
  THEME_MODE_KEY,
  getSetting,
  setSetting,
  getTfsPat,
  setTfsPat,
  runAi,
  tfsTestConnection,
  exportAll,
  importAll,
  readTextFile,
} from "../lib/api";
import { todayStr } from "../lib/format";
import { ACCENTS, isAccentName, isThemeMode, type AccentName, type ThemeMode } from "../lib/theme";

interface Props {
  onClose: () => void;
  accent: AccentName;
  mode: ThemeMode;
  onAccentChange: (name: AccentName) => void;
  onModeChange: (mode: ThemeMode) => void;
}

export default function SettingsView({ onClose, accent, mode, onAccentChange, onModeChange }: Props) {
  const [aiCommand, setAiCommand] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [saved, setSaved] = useState(false);

  const [gitAuthor, setGitAuthor] = useState("");
  const [tfsBaseUrl, setTfsBaseUrl] = useState("");
  const [tfsCollections, setTfsCollections] = useState<string[]>([]);
  const [newCollection, setNewCollection] = useState("");
  const [tfsPat, setTfsPatValue] = useState("");
  const [gitSaved, setGitSaved] = useState(false);
  const [tfsTesting, setTfsTesting] = useState(false);
  const [tfsTestResult, setTfsTestResult] = useState("");

  const [backupMsg, setBackupMsg] = useState("");

  useEffect(() => {
    getSetting(AI_COMMAND_KEY).then((v) => setAiCommand(v ?? "claude -p"));
    getSetting(GIT_AUTHOR_KEY).then((v) => setGitAuthor(v ?? ""));
    getSetting(TFS_BASE_URL_KEY).then((v) => setTfsBaseUrl(v ?? ""));
    getSetting(TFS_COLLECTIONS_KEY).then((v) => setTfsCollections(v ? JSON.parse(v) : []));
    getTfsPat().then(setTfsPatValue);
  }, []);

  const addCollection = () => {
    const c = newCollection.trim();
    if (c && !tfsCollections.includes(c)) {
      setTfsCollections([...tfsCollections, c]);
    }
    setNewCollection("");
  };

  const removeCollection = (c: string) =>
    setTfsCollections(tfsCollections.filter((x) => x !== c));

  // 把目前畫面上的 TFS 設定寫回 DB（測試與儲存共用）；PAT 走 keychain
  const persistTfs = async () => {
    await setSetting(GIT_AUTHOR_KEY, gitAuthor.trim());
    await setSetting(TFS_BASE_URL_KEY, tfsBaseUrl.trim());
    await setSetting(TFS_COLLECTIONS_KEY, JSON.stringify(tfsCollections));
    await setTfsPat(tfsPat.trim());
  };

  const saveGit = async () => {
    await persistTfs();
    setGitSaved(true);
    window.setTimeout(() => setGitSaved(false), 1500);
  };

  const testTfs = async () => {
    setTfsTesting(true);
    setTfsTestResult("");
    // 後端從 settings/keychain 讀設定，測試需先暫存目前輸入值；測完還原原值，避免「測試＝偷偷存檔」
    const orig = await Promise.all(
      [GIT_AUTHOR_KEY, TFS_BASE_URL_KEY, TFS_COLLECTIONS_KEY].map(
        async (k) => [k, await getSetting(k)] as const,
      ),
    );
    const origPat = await getTfsPat();
    try {
      await persistTfs();
      const count = await tfsTestConnection();
      setTfsTestResult(`✅ 連線成功，找到 ${count} 個 repo`);
    } catch (e) {
      setTfsTestResult(`❌ ${e}`);
    } finally {
      for (const [k, v] of orig) {
        if (v !== null) await setSetting(k, v);
      }
      await setTfsPat(origPat);
      setTfsTesting(false);
    }
  };

  const save = async () => {
    await setSetting(AI_COMMAND_KEY, aiCommand.trim());
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const handleExport = async () => {
    setBackupMsg("");
    try {
      const path = await saveDialog({
        defaultPath: `日報備份_${todayStr()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const json = await exportAll();
      await invoke("write_text_file", { path, contents: json });
      setBackupMsg("✅ 已匯出全部資料");
    } catch (e) {
      setBackupMsg(`❌ 匯出失敗：${e}`);
    }
  };

  const handleImport = async () => {
    setBackupMsg("");
    try {
      const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      const ok = await ask("匯入會以檔案內容覆蓋同日期的日報與設定，確定繼續？", {
        title: "匯入資料",
        kind: "warning",
      });
      if (!ok) return;
      const json = await readTextFile(path);
      const count = await importAll(json);
      // 設定可能被覆蓋，重新載入畫面上的值
      getSetting(AI_COMMAND_KEY).then((v) => setAiCommand(v ?? "claude -p"));
      getSetting(GIT_AUTHOR_KEY).then((v) => setGitAuthor(v ?? ""));
      getSetting(TFS_BASE_URL_KEY).then((v) => setTfsBaseUrl(v ?? ""));
      getSetting(TFS_COLLECTIONS_KEY).then((v) => setTfsCollections(v ? JSON.parse(v) : []));
      getTfsPat().then(setTfsPatValue);
      // 主題設定也可能被覆蓋，重套到畫面
      getSetting(THEME_ACCENT_KEY).then((v) => {
        if (isAccentName(v)) onAccentChange(v);
      });
      getSetting(THEME_MODE_KEY).then((v) => {
        if (isThemeMode(v)) onModeChange(v);
      });
      setBackupMsg(`✅ 已匯入 ${count} 份日報`);
    } catch (e) {
      setBackupMsg(`❌ 匯入失敗：${e}`);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult("");
    // 後端從 settings 表讀命令，測試需先暫存目前輸入值；測完還原原值，避免「測試＝偷偷存檔」
    const orig = await getSetting(AI_COMMAND_KEY);
    try {
      await setSetting(AI_COMMAND_KEY, aiCommand.trim());
      const out = await runAi("請只回覆兩個字：可用");
      setTestResult(`✅ 回應：${out.slice(0, 200)}`);
    } catch (e) {
      setTestResult(`❌ ${e}`);
    } finally {
      if (orig !== null) await setSetting(AI_COMMAND_KEY, orig);
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">設定</h2>
        <button
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          返回
        </button>
      </div>

      <section className="mb-6 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">外觀</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">調整主色與淺／深色模式，變更後立即套用並保存。</p>

        <div className="mb-4">
          <div className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">主色</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
              <button
                key={name}
                onClick={() => onAccentChange(name)}
                title={ACCENTS[name].label}
                aria-label={`主色 ${ACCENTS[name].label}`}
                aria-pressed={accent === name}
                style={{ backgroundColor: ACCENTS[name].scale[600] }}
                className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                  accent === name
                    ? "ring-2 ring-offset-2 ring-slate-400 dark:ring-slate-300 dark:ring-offset-slate-900"
                    : ""
                }`}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">模式</div>
          <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  mode === m
                    ? "bg-white font-medium text-accent-700 shadow-sm dark:bg-slate-700 dark:text-accent-300"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                {m === "light" ? "淺色" : m === "dark" ? "深色" : "跟隨系統"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">AI 命令</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
          日報會把提示透過 stdin 傳給此命令並讀取輸出。預設使用本機已登入的 Claude
          Code（<code className="rounded bg-slate-100 px-1 dark:bg-slate-700">claude -p</code>）。
          也可改成其他 CLI，或填完整路徑（例如 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">/home/aries/.local/bin/claude -p</code>）。
        </p>
        <input
          value={aiCommand}
          onChange={(e) => setAiCommand(e.target.value)}
          placeholder="claude -p"
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={save}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            儲存
          </button>
          <button
            onClick={test}
            disabled={testing}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {testing ? "測試中…" : "測試連線"}
          </button>
          {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">已儲存</span>}
        </div>
        {testResult && (
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200">
            {testResult}
          </pre>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">TFS 整合</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
          設定後，可在日報用「從 Git 草擬」一鍵把當天 TFS 上的 commit 轉成日報草稿。
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">TFS 位址（含 /tfs）</label>
        <input
          value={tfsBaseUrl}
          onChange={(e) => setTfsBaseUrl(e.target.value)}
          placeholder="http://192.168.0.143:8080/tfs"
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
          Personal Access Token（需 Code(read) 權限）
        </label>
        <input
          type="password"
          value={tfsPat}
          onChange={(e) => setTfsPatValue(e.target.value)}
          placeholder="貼上 PAT"
          className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          PAT 存在系統的憑證管理員（keychain；系統不支援時退回本機資料庫），不會包含在「匯出全部資料」的備份檔中。
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">作者關鍵字（逗號分隔，留空＝全部）</label>
        <input
          value={gitAuthor}
          onChange={(e) => setGitAuthor(e.target.value)}
          placeholder="例如 ARIESCHAO（不分大小寫，包含比對）"
          className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          以「包含、不分大小寫」比對 commit 作者；例如填 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">ARIESCHAO</code> 可命中 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">ARIESCHAO-NB\USER</code>。多台電腦的作者名可用逗號分隔多筆。
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Collections</label>
        </div>
        <div className="mb-2 flex gap-2">
          <input
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCollection();
              }
            }}
            placeholder="輸入 collection 名稱，例如 MCollection"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <button
            onClick={addCollection}
            className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            + 新增
          </button>
        </div>
        {tfsCollections.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400 dark:text-slate-500">尚未新增任何 collection</p>
        ) : (
          <ul className="mb-3 space-y-1">
            {tfsCollections.map((c) => (
              <li
                key={c}
                className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800"
              >
                <span className="truncate font-mono text-slate-700 dark:text-slate-200" title={c}>
                  {c}
                </span>
                <button
                  onClick={() => removeCollection(c)}
                  className="ml-2 shrink-0 text-xs text-rose-500 hover:underline dark:text-rose-400"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={saveGit}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            儲存
          </button>
          <button
            onClick={testTfs}
            disabled={tfsTesting}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {tfsTesting ? "測試中…" : "測試連線"}
          </button>
          {gitSaved && <span className="text-sm text-emerald-600 dark:text-emerald-400">已儲存</span>}
        </div>
        {tfsTestResult && (
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200">
            {tfsTestResult}
          </pre>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">資料備份</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
          將所有日報、標籤與設定匯出成單一 JSON 檔備份；匯入時會以檔案內容覆蓋相同日期的資料（合併）。
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            匯出全部資料
          </button>
          <button
            onClick={handleImport}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            匯入資料
          </button>
          {backupMsg && <span className="text-sm text-slate-600 dark:text-slate-300">{backupMsg}</span>}
        </div>
      </section>
    </div>
  );
}
