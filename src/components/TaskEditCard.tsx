import { useEffect, useState } from "react";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../types";
import * as ai from "../lib/ai";
import { toastError } from "../lib/toast";
import DatePicker from "./DatePicker";
import ProjectInput from "./ProjectInput";

interface Props {
  /** 初始任務（新建或編輯既有）。以此為 draft 初值；切換不同任務時請用 key 重置元件 */
  task: Task;
  projects: string[];
  onSave: (t: Task) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onCancel: () => void;
  /** 回報 draft 是否與初始任務不同（給外層在關閉前確認用） */
  onDirtyChange?: (dirty: boolean) => void;
}

/** 工作項目編輯卡：工作面板與日曆共用。自管 draft / busy / 刪除二次確認 / AI 標籤 */
export default function TaskEditCard({ task, projects, onSave, onDelete, onCancel, onDirtyChange }: Props) {
  const [editing, setEditing] = useState<Task>(task);
  const [busy, setBusy] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    onDirtyChange?.(JSON.stringify(editing) !== JSON.stringify(task));
  }, [editing, task, onDirtyChange]);

  const save = async () => {
    if (!editing.title.trim()) {
      toastError("請輸入標題");
      return;
    }
    setBusy("儲存中");
    try {
      await onSave({ ...editing, title: editing.title.trim() });
    } catch (e) {
      toastError(`儲存失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (editing.id == null) return;
    setBusy("刪除中");
    try {
      await onDelete(editing.id);
    } catch (e) {
      toastError(`刪除失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const genTags = async () => {
    if (!editing.title.trim()) {
      toastError("請先輸入標題");
      return;
    }
    setBusy("AI 標籤中");
    try {
      const generated = await ai.generateTaskTags(editing);
      // 與既有標籤合併、去重
      const merged = Array.from(new Set([...editing.tags, ...generated]));
      setEditing({ ...editing, tags: merged });
    } catch (e) {
      toastError(`AI 產製標籤失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800">
      <input
        type="text"
        value={editing.title}
        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
        placeholder="工作項目標題"
        autoFocus
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          狀態
          <select
            value={editing.status}
            onChange={(e) => setEditing({ ...editing, status: e.target.value as TaskStatus })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          優先序
          <select
            value={editing.priority}
            onChange={(e) => setEditing({ ...editing, priority: e.target.value as TaskPriority })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          專案
          <ProjectInput
            value={editing.project}
            onChange={(v) => setEditing({ ...editing, project: v })}
            projects={projects}
            inputClassName="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
        <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          <span>截止日</span>
          <div className="flex items-center gap-1">
            <DatePicker
              value={editing.due_date ?? ""}
              onChange={(v) => setEditing({ ...editing, due_date: v || null })}
            />
            {editing.due_date && (
              <button
                type="button"
                onClick={() => setEditing({ ...editing, due_date: null })}
                className="rounded px-1.5 py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="清除截止日"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={editing.tags.join(", ")}
          onChange={(e) =>
            setEditing({
              ...editing,
              tags: e.target.value
                .split(/[,，]/)
                .map((g) => g.trim())
                .filter(Boolean),
            })
          }
          placeholder="標籤（以逗號分隔，可空）"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        />
        <button
          type="button"
          onClick={genTags}
          disabled={!!busy}
          className="shrink-0 rounded-md border border-accent-300 bg-accent-50 px-3 py-1.5 text-sm font-medium text-accent-700 hover:bg-accent-100 disabled:opacity-50 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50"
        >
          {busy === "AI 標籤中" ? "產製中…" : "✨ AI 標籤"}
        </button>
      </div>
      <textarea
        value={editing.notes}
        onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
        placeholder="細節 / 進度（Markdown）"
        rows={5}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={!!busy}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "儲存中" ? "儲存中…" : "儲存"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          取消
        </button>
        {editing.id != null && (
          <div className="ml-auto">
            {confirmDel ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={remove}
                  disabled={!!busy}
                  className="rounded bg-rose-600 px-2.5 py-1 text-xs text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  確認刪除
                </button>
                <button
                  onClick={() => setConfirmDel(false)}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDel(true)}
                className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                刪除
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
