import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { ask, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AI_COMMAND_KEY,
  AI_TIMEOUT_KEY,
  REPORT_TEMPLATE_KEY,
  REPO_PROVIDERS_KEY,
  THEME_ACCENT_KEY,
  THEME_MODE_KEY,
  getSetting,
  setSetting,
  getProviderSecret,
  setProviderSecret,
  runAi,
  exportAll,
  importAll,
  readTextFile,
  type RepoProvider,
} from "../lib/api";
import RepoProviderCard from "../components/RepoProviderCard";
import { todayStr } from "../lib/format";
import { checkForUpdates } from "../lib/updater";
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

  // 儲存庫來源清單（唯一內容來源）＋各來源初次載入的秘密（id → token/PAT）
  const [providers, setProviders] = useState<RepoProvider[]>([]);
  const [providerSecrets, setProviderSecrets] = useState<Record<string, string>>({});
  const [newlyAdded, setNewlyAdded] = useState<Set<string>>(new Set());
  const [newProviderType, setNewProviderType] = useState<RepoProvider["type"]>("github");

  const [backupMsg, setBackupMsg] = useState("");

  const [appVersion, setAppVersion] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    try {
      await checkForUpdates({ silent: false });
    } finally {
      setUpdateChecking(false);
    }
  };

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {}); // 純瀏覽器 dev 模式無 Tauri API，拿不到就不顯示
  }, []);

  // 讀出來源清單與各來源秘密並填回畫面（初始化與匯入備份後共用）
  const loadRepoSettings = async () => {
    const raw = await getSetting(REPO_PROVIDERS_KEY);
    const list: RepoProvider[] = raw ? JSON.parse(raw) : [];
    // 先撈齊秘密再設 providers：卡片以 useState(initialSecret) 只在掛載當下讀一次秘密，
    // 若 providers 先設好、秘密還沒到，卡片會抓到空字串且之後不再同步，之後任何存檔
    //（含切換啟用）就會把空字串覆蓋回去、清掉 PAT。
    const entries = await Promise.all(
      list.map(async (p) => [p.id, await getProviderSecret(p.id)] as const),
    );
    setProviderSecrets(Object.fromEntries(entries));
    setNewlyAdded(new Set());
    setProviders(list);
  };

  // 把整份清單寫回 DB
  const persistProviders = (list: RepoProvider[]) =>
    setSetting(REPO_PROVIDERS_KEY, JSON.stringify(list));

  const addProvider = () => {
    const p: RepoProvider = {
      id: crypto.randomUUID(),
      type: newProviderType,
      name: "",
      enabled: false,
      author: "",
      ...(newProviderType === "github" ? { apiUrl: "", owners: [] } : { baseUrl: "", collections: [] }),
    };
    setProviders((prev) => [...prev, p]);
    setNewlyAdded((prev) => new Set(prev).add(p.id)); // 新卡預設展開
  };

  const saveProvider = async (updated: RepoProvider, secret: string) => {
    const next = providers.map((p) => (p.id === updated.id ? updated : p));
    setProviders(next);
    await persistProviders(next);
    await setProviderSecret(updated.id, secret);
  };

  const removeProvider = async (id: string) => {
    const next = providers.filter((p) => p.id !== id);
    setProviders(next);
    await persistProviders(next);
    await setProviderSecret(id, ""); // 清掉 keychain/settings 的秘密
  };

  useEffect(() => {
    getSetting(AI_COMMAND_KEY).then((v) => setAiCommand(v ?? "claude -p"));
    getSetting(AI_TIMEOUT_KEY).then((v) => setAiTimeout(v ?? "120"));
    getSetting(REPORT_TEMPLATE_KEY).then((v) => setReportTemplate(v ?? ""));
    void loadRepoSettings();
  }, []);

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
      void loadRepoSettings();
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
          日報會把提示傳給此命令並讀取輸出（Windows 上附加為最後一個參數，macOS/Linux 透過
          stdin，命令請填 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">claude -p</code> 這類形式、勿加{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">-</code>）。預設使用本機已登入的 Claude
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
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">儲存庫整合</h3>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
          設定後，可在日報用「從 Git 草擬」一鍵把當天的 commit 轉成日報草稿。可新增多個來源
          （每筆選 GitHub 或 Azure DevOps，各自獨立設定與 token），撈取時會合併所有「已啟用」的來源。
        </p>

        {providers.length === 0 && (
          <p className="mb-4 text-sm text-slate-400 dark:text-slate-500">尚未新增任何來源，請於下方選擇類型後新增。</p>
        )}

        {providers.map((p) => (
          <RepoProviderCard
            key={p.id}
            provider={p}
            initialSecret={providerSecrets[p.id] ?? ""}
            defaultExpanded={newlyAdded.has(p.id)}
            onSave={saveProvider}
            onRemove={() => removeProvider(p.id)}
          />
        ))}

        <div className="mt-2 flex items-center gap-2">
          <select
            value={newProviderType}
            onChange={(e) => setNewProviderType(e.target.value as RepoProvider["type"])}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="github">GitHub</option>
            <option value="azure">Azure DevOps（含 TFS / ADS）</option>
          </select>
          <button
            onClick={addProvider}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            + 新增來源
          </button>
        </div>
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

      <section className="mt-6 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
        <h3 className="mb-1 font-semibold text-slate-800 dark:text-slate-100">關於</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          日報告 DailyLogs{appVersion && ` v${appVersion}`}。
        </p>
        <button
          onClick={handleCheckUpdate}
          disabled={updateChecking}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {updateChecking ? "檢查中…" : "檢查更新"}
        </button>
      </section>
    </div>
  );
}
