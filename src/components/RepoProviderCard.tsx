import { useState } from "react";
import { repoTestConnection, type RepoProvider } from "../lib/api";

interface Props {
  provider: RepoProvider;
  /** 初次載入的 token/PAT（卡片自持一份草稿） */
  initialSecret: string;
  /** 新增的卡片一開始就展開 */
  defaultExpanded?: boolean;
  /** 儲存整張卡（含 enabled 切換也走這裡）：寫回清單 + 秘密 */
  onSave: (provider: RepoProvider, secret: string) => Promise<void>;
  /** 移除此來源 */
  onRemove: () => void;
}

const TYPE_LABEL: Record<RepoProvider["type"], string> = {
  github: "GitHub",
  azure: "Azure DevOps",
};

export default function RepoProviderCard({
  provider,
  initialSecret,
  defaultExpanded,
  onSave,
  onRemove,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [draft, setDraft] = useState<RepoProvider>(provider);
  const [secret, setSecret] = useState(initialSecret);
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");

  const isGithub = draft.type === "github";
  const items = (isGithub ? draft.owners : draft.collections) ?? [];
  const setItems = (next: string[]) =>
    setDraft(isGithub ? { ...draft, owners: next } : { ...draft, collections: next });

  const addItem = () => {
    const v = newItem.trim();
    if (v && !items.includes(v)) setItems([...items, v]);
    setNewItem("");
  };
  const removeItem = (x: string) => setItems(items.filter((i) => i !== x));

  const persist = async (p: RepoProvider) => {
    setSaving(true);
    try {
      await onSave(p, secret);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = (enabled: boolean) => {
    const next = { ...draft, enabled };
    setDraft(next);
    void persist(next); // 啟用切換即時存檔
  };

  const test = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const count = await repoTestConnection(draft, secret);
      setTestResult(`✅ 連線成功，找到 ${count} 個 repo`);
    } catch (e) {
      setTestResult(`❌ ${e}`);
    } finally {
      setTesting(false);
    }
  };

  const displayName = draft.name.trim() || TYPE_LABEL[draft.type];

  return (
    <div className="mb-4 rounded-md border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-slate-400 dark:text-slate-500">{expanded ? "▾" : "▸"}</span>
          <span className="truncate font-medium text-slate-800 dark:text-slate-100" title={displayName}>
            {displayName}
          </span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {TYPE_LABEL[draft.type]}
          </span>
        </button>
        <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent-600"
          />
          啟用
        </label>
        <button
          onClick={onRemove}
          className="shrink-0 text-xs text-rose-500 hover:underline dark:text-rose-400"
        >
          移除
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">名稱</label>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={isGithub ? "例如 個人 GitHub" : "例如 公司 Azure"}
            className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
          />

          {isGithub ? (
            <>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">GitHub API 位址</label>
              <input
                value={draft.apiUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
                placeholder="https://api.github.com"
                className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
              />
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                留空＝雲端 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">https://api.github.com</code>；企業版填 API 位址，例如 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">https://ghe.company.com/api/v3</code>。
              </p>
            </>
          ) : (
            <>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">伺服器位址</label>
              <input
                value={draft.baseUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="例如 http://tfs.company.com:8080/tfs 或 https://dev.azure.com"
                className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
              />
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
                填到 collection「之前」的位址：企業內 TFS/ADS 例如 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">http://tfs.example.com:8080/tfs</code>；雲端填 <code className="rounded bg-slate-100 px-1 dark:bg-slate-700">https://dev.azure.com</code>（collection 填組織名）。
              </p>
            </>
          )}

          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Personal Access Token（需 {isGithub ? "repo" : "Code"} 讀取權限）
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={isGithub ? "貼上 token" : "貼上 PAT"}
            className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            token 存在系統的憑證管理員（keychain；系統不支援時退回本機資料庫），不會包含在「匯出全部資料」的備份檔中。
          </p>

          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">作者關鍵字（逗號分隔，留空＝全部）</label>
          <input
            value={draft.author}
            onChange={(e) => setDraft({ ...draft, author: e.target.value })}
            placeholder="例如 arieschao（不分大小寫，包含比對）"
            className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            {isGithub
              ? "以「包含、不分大小寫」比對 commit 的 GitHub 帳號（login）、作者姓名與 email，任一命中即算。多個關鍵字可用逗號分隔。"
              : "以「包含、不分大小寫」比對 commit 的作者姓名。多個關鍵字可用逗號分隔。"}
          </p>

          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {isGithub ? "Owner（org 或使用者）" : "Collection（雲端為組織名）"}
          </label>
          <div className="mb-2 flex gap-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder={isGithub ? "輸入 org 或使用者名稱，例如 my-org" : "輸入 collection 名稱，例如 DefaultCollection"}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              onClick={addItem}
              className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              + 新增
            </button>
          </div>
          {items.length === 0 ? (
            <p className="mb-3 text-sm text-slate-400 dark:text-slate-500">
              {isGithub ? "尚未新增任何 owner" : "尚未新增任何 collection"}
            </p>
          ) : (
            <ul className="mb-3 space-y-1">
              {items.map((it) => (
                <li
                  key={it}
                  className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800"
                >
                  <span className="truncate font-mono text-slate-700 dark:text-slate-200" title={it}>
                    {it}
                  </span>
                  <button
                    onClick={() => removeItem(it)}
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
              onClick={() => void persist(draft)}
              disabled={saving}
              className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
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
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {testResult}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
