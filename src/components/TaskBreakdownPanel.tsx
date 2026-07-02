import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emptyTask, TASK_PRIORITIES, type Task, type TaskPriority } from "../types";
import * as api from "../lib/api";
import * as ai from "../lib/ai";
import { toastError } from "../lib/toast";
import ProjectInput from "./ProjectInput";

interface Props {
  projects: string[];
  onCreated: () => Promise<void>;
  onClose: () => void;
}

/** AI 拆解工項：輸入一段描述 / 匯入檔案 → 拆成多筆草稿 → 逐筆編輯後一次建立 */
export default function TaskBreakdownPanel({ projects, onCreated, onClose }: Props) {
  const [input, setInput] = useState("");
  const [defaultProject, setDefaultProject] = useState("");
  const [drafts, setDrafts] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState("");

  const importFile = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "文字 / Markdown", extensions: ["md", "txt"] }],
      });
      if (typeof path !== "string") return;
      setInput(await api.readTextFile(path));
    } catch (e) {
      toastError(`讀取檔案失敗：${e}`);
    }
  };

  const breakdown = async () => {
    if (!input.trim()) {
      toastError("請先輸入或匯入工作描述");
      return;
    }
    setBusy("拆解中");
    try {
      const result = await ai.breakdownToTasks(input);
      setDrafts(
        result.map((d) => ({
          ...emptyTask(),
          title: d.title,
          notes: d.notes,
          project: defaultProject.trim(),
        })),
      );
    } catch (e) {
      toastError(`AI 拆解失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const patch = (i: number, fields: Partial<Task>) =>
    setDrafts((prev) => prev && prev.map((d, idx) => (idx === i ? { ...d, ...fields } : d)));

  const removeDraft = (i: number) =>
    setDrafts((prev) => prev && prev.filter((_, idx) => idx !== i));

  const createAll = async () => {
    if (!drafts) return;
    const valid = drafts.filter((d) => d.title.trim());
    if (valid.length === 0) {
      toastError("沒有可建立的工項（標題皆為空）");
      return;
    }
    setBusy("建立中");
    try {
      for (const d of valid) {
        await api.saveTask({ ...d, title: d.title.trim() });
      }
      await onCreated();
      onClose();
    } catch (e) {
      toastError(`建立失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const validCount = drafts?.filter((d) => d.title.trim()).length ?? 0;

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-accent-300 bg-accent-50/50 p-4 dark:border-accent-700 dark:bg-accent-900/20">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          ✨ AI 拆解工項{drafts ? `：檢視 ${drafts.length} 筆草稿` : ""}
        </span>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      {drafts === null ? (
        /* Step 1：輸入 */
        <>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="貼上或打一段工作描述（例：做一個登入頁），或用「匯入檔案」載入 .md / .txt，AI 會拆成多筆工項。"
            rows={6}
            autoFocus
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              預設專案
              <ProjectInput
                value={defaultProject}
                onChange={setDefaultProject}
                projects={projects}
                inputClassName="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              />
            </label>
            <button
              onClick={importFile}
              disabled={!!busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              匯入檔案
            </button>
            <button
              onClick={breakdown}
              disabled={!!busy}
              className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {busy === "拆解中" ? "拆解中…" : "開始拆解"}
            </button>
          </div>
        </>
      ) : (
        /* Step 2：檢視編輯 */
        <>
          {drafts.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
              已全部移除，可「重新拆解」或關閉。
            </p>
          ) : (
            <ul className="space-y-3">
              {drafts.map((d, i) => (
                <li
                  key={i}
                  className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={d.title}
                      onChange={(e) => patch(i, { title: e.target.value })}
                      placeholder="工項標題"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      onClick={() => removeDraft(i)}
                      className="shrink-0 rounded px-2 py-1 text-xs text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      移除
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      專案
                      <ProjectInput
                        value={d.project}
                        onChange={(v) => patch(i, { project: v })}
                        projects={projects}
                        inputClassName="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                      優先序
                      <select
                        value={d.priority}
                        onChange={(e) => patch(i, { priority: e.target.value as TaskPriority })}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {TASK_PRIORITIES.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <textarea
                    value={d.notes}
                    onChange={(e) => patch(i, { notes: e.target.value })}
                    placeholder="細節 / 驗收要點（可空）"
                    rows={3}
                    className="w-full resize-y rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={createAll}
              disabled={!!busy || validCount === 0}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "建立中" ? "建立中…" : `全部建立（${validCount}）`}
            </button>
            <button
              onClick={() => setDrafts(null)}
              disabled={!!busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              重新拆解
            </button>
            <button
              onClick={onClose}
              disabled={!!busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              取消
            </button>
          </div>
        </>
      )}
    </div>
  );
}
