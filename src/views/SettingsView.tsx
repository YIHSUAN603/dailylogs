import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AI_COMMAND_KEY,
  AI_TIMEOUT_KEY,
  REPORT_TEMPLATE_KEY,
  GITHUB_AUTHOR_KEY,
  GITHUB_API_URL_KEY,
  GITHUB_OWNERS_KEY,
  THEME_ACCENT_KEY,
  THEME_MODE_KEY,
  getSetting,
  setSetting,
  getGithubToken,
  setGithubToken,
  runAi,
  githubTestConnection,
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
  const [aiTimeout, setAiTimeout] = useState("120");
  const [aiTimeoutError, setAiTimeoutError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [saved, setSaved] = useState(false);

  const [reportTemplate, setReportTemplate] = useState("");
  const [templateSaved, setTemplateSaved] = useState(false);

  const [githubAuthor, setGithubAuthor] = useState("");
  const [githubApiUrl, setGithubApiUrl] = useState("");
  const [githubOwners, setGithubOwners] = useState<string[]>([]);
  const [newOwner, setNewOwner] = useState("");
  const [githubToken, setGithubTokenValue] = useState("");
  const [githubSaved, setGithubSaved] = useState(false);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubTestResult, setGithubTestResult] = useState("");

  const [backupMsg, setBackupMsg] = useState("");

  useEffect(() => {
    getSetting(AI_COMMAND_KEY).then((v) => setAiCommand(v ?? "claude -p"));
    getSetting(AI_TIMEOUT_KEY).then((v) => setAiTimeout(v ?? "120"));
    getSetting(REPORT_TEMPLATE_KEY).then((v) => setReportTemplate(v ?? ""));
    getSetting(GITHUB_AUTHOR_KEY).then((v) => setGithubAuthor(v ?? ""));
    getSetting(GITHUB_API_URL_KEY).then((v) => setGithubApiUrl(v ?? ""));
    getSetting(GITHUB_OWNERS_KEY).then((v) => setGithubOwners(v ? JSON.parse(v) : []));
    getGithubToken().then(setGithubTokenValue);
  }, []);

  const addOwner = () => {
    const o = newOwner.trim();
    if (o && !githubOwners.includes(o)) {
      setGithubOwners([...githubOwners, o]);
    }
    setNewOwner("");
  };

  const removeOwner = (o: string) => setGithubOwners(githubOwners.filter((x) => x !== o));

  // 把目前畫面上的 GitHub 設定寫回 DB（測試與儲存共用）；token 走 keychain
  const persistGithub = async () => {
    await setSetting(GITHUB_AUTHOR_KEY, githubAuthor.trim());
    await setSetting(GITHUB_API_URL_KEY, githubApiUrl.trim());
    await setSetting(GITHUB_OWNERS_KEY, JSON.stringify(githubOwners));
    await setGithubToken(githubToken.trim());
  };

  const saveGithub = async () => {
    await persistGithub();
    setGithubSaved(true);
    window.setTimeout(() => setGithubSaved(false), 1500);
  };

  const testGithub = async () => {
    setGithubTesting(true);
    setGithubTestResult("");
    // 後端從 settings/keychain 讀設定，測試需先暫存目前輸入值；測完還原原值，避免「測試＝偷偷存檔」
    const orig = await Promise.all(
      [GITHUB_AUTHOR_KEY, GITHUB_API_URL_KEY, GITHUB_OWNERS_KEY].map(
        async (k) => [k, await getSetting(k)] as const,
      ),
    );
    const origToken = await getGithubToken();
    try {
      await persistGithub();
      const count = await githubTestConnection();
      setGithubTestResult(`✅ 連線成功，找到 ${count} 個 repo`);
    } catch (e) {
      setGithubTestResult(`❌ ${e}`);
    } finally {
      for (const [k, v] of orig) {
        if (v !== null) await setSetting(k, v);
      }
      // 只在原本就有 token 時還原；否則保留剛輸入的值，
      // 避免第一次設定（原本為空）時把剛填的 token 洗掉
      if (origToken) await setGithubToken(origToken);
      setGithubTesting(false);
    }
  };

  // 逾時欄位驗證：5–3600 的整數才合法；空字串視為重設回預設 120
  const parseTimeout = (v: string): number | null => {
    const s = v.trim();
    if (!s) return 120;
    const n = Number(s);
    return Number.isInteger(n) && n >= 5 && n <= 3600 ? n : null;
  };

  const save = async () => {
    const timeout = parseTimeout(aiTimeout);
    if (timeout === null) {
      setAiTimeoutError("逾時秒數請輸入 5–3600 的整數");
      return;
    }
    setAiTimeoutError("");
    await setSetting(AI_COMMAND_KEY, aiCommand.trim());
    await setSetting(AI_TIMEOUT_KEY, String(timeout));
    setAiTimeout(String(timeout));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const saveTemplate = async () => {
    // 不 trim 內容本身：範本內的縮排與空行有意義
    await setSetting(REPORT_TEMPLATE_KEY, reportTemplate);
    setTemplateSaved(true);
    window.setTimeout(() => setTemplateSaved(false), 1500);
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
      getSetting(AI_TIMEOUT_KEY).then((v) => setAiTimeout(v ?? "120"));
      getSetting(REPORT_TEMPLATE_KEY).then((v) => setReportTemplate(v ?? ""));
      getSetting(GITHUB_AUTHOR_KEY).then((v) => setGithubAuthor(v ?? ""));
      getSetting(GITHUB_API_URL_KEY).then((v) => setGithubApiUrl(v ?? ""));
      getSetting(GITHUB_OWNERS_KEY).then((v) => setGithubOwners(v ? JSON.parse(v) : []));
      getGithubToken().then(setGithubTokenValue);
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
    const timeout = parseTimeout(aiTimeout);
    if (timeout === null) {
      setAiTimeoutError("逾時秒數請輸入 5–3600 的整數");
      return;
    }
    setAiTimeoutError("");
    setTesting(true);
    setTestResult("");
    // 後端從 settings 表讀命令與逾時，測試需先暫存目前輸入值；測完還原原值，避免「測試＝偷偷存檔」
    const orig = await getSetting(AI_COMMAND_KEY);
    const origTimeout = await getSetting(AI_TIMEOUT_KEY);
    try {
      await setSetting(AI_COMMAND_KEY, aiCommand.trim());
      await setSetting(AI_TIMEOUT_KEY, String(timeout));
      const out = await runAi("請只回覆兩個字：可用");
      setTestResult(`✅ 回應：${out.slice(0, 200)}`);
    } catch (e) {
      setTestResult(`❌ ${e}`);
    } finally {
      if (orig !== null) await setSetting(AI_COMMAND_KEY, orig);
      if (origTimeout !== null) await setSetting(AI_TIMEOUT_KEY, origTimeout);
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
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">逾時秒數</label>
          <input
            type="number"
            min={5}
            max={3600}
            step={1}
            value={aiTimeout}
            onChange={(e) => setAiTimeout(e.target.value)}
            placeholder="120"
            className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-xs text-slate-400 dark:text-slate-500">AI 命令超過此秒數即中止（預設 120，留空重設）</span>
        </div>
        {aiTimeoutError && <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">{aiTimeoutError}</p>}
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
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">日報範本</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          新建某天日報時自動填入以下 Markdown；留空則維持空白日報。已存在的日報不受影響。
        </p>
        <textarea
          rows={8}
          value={reportTemplate}
          onChange={(e) => setReportTemplate(e.target.value)}
          placeholder={"例如：\n# 專案名稱\n\n## 完成\n\n- \n\n## 進行中\n\n- \n\n## 明日\n\n- "}
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={saveTemplate}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            儲存
          </button>
          {templateSaved && <span className="text-sm text-emerald-600 dark:text-emerald-400">已儲存</span>}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">GitHub 整合</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
          設定後，可在日報用「從 Git 草擬」一鍵把當天 GitHub 上的 commit 轉成日報草稿。
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">GitHub API 位址</label>
        <input
          value={githubApiUrl}
          onChange={(e) => setGithubApiUrl(e.target.value)}
          placeholder="https://api.github.com"
          className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          留空＝雲端 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">https://api.github.com</code>；企業版填 API 位址，例如 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">https://ghe.company.com/api/v3</code>。
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
          Personal Access Token（需 repo 讀取權限）
        </label>
        <input
          type="password"
          value={githubToken}
          onChange={(e) => setGithubTokenValue(e.target.value)}
          placeholder="貼上 token"
          className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          token 存在系統的憑證管理員（keychain；系統不支援時退回本機資料庫），不會包含在「匯出全部資料」的備份檔中。
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">作者關鍵字（逗號分隔，留空＝全部）</label>
        <input
          value={githubAuthor}
          onChange={(e) => setGithubAuthor(e.target.value)}
          placeholder="例如 arieschao（不分大小寫，包含比對）"
          className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
          以「包含、不分大小寫」比對 commit 的 GitHub 帳號（login）、作者姓名與 email，任一命中即算。多個關鍵字可用逗號分隔。
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Owner（org 或使用者）</label>
        </div>
        <div className="mb-2 flex gap-2">
          <input
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOwner();
              }
            }}
            placeholder="輸入 org 或使用者名稱，例如 my-org"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <button
            onClick={addOwner}
            className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            + 新增
          </button>
        </div>
        {githubOwners.length === 0 ? (
          <p className="mb-3 text-sm text-slate-400 dark:text-slate-500">尚未新增任何 owner</p>
        ) : (
          <ul className="mb-3 space-y-1">
            {githubOwners.map((o) => (
              <li
                key={o}
                className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800"
              >
                <span className="truncate font-mono text-slate-700 dark:text-slate-200" title={o}>
                  {o}
                </span>
                <button
                  onClick={() => removeOwner(o)}
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
            onClick={saveGithub}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            儲存
          </button>
          <button
            onClick={testGithub}
            disabled={githubTesting}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {githubTesting ? "測試中…" : "測試連線"}
          </button>
          {githubSaved && <span className="text-sm text-emerald-600 dark:text-emerald-400">已儲存</span>}
        </div>
        {githubTestResult && (
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200">
            {githubTestResult}
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
