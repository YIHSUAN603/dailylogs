import { useMemo, useState } from "react";
import {
  TASK_STATUSES,
  TASK_PRIORITY_LABELS,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../types";
import * as api from "../lib/api";
import { dateStr } from "../lib/format";
import { toastError } from "../lib/toast";

interface Props {
  tasks: Task[];
  projects: string[];
  projectFilter: string;
  onProjectFilterChange: (p: string) => void;
  onEdit: (t: Task) => void;
  onChanged: () => Promise<void>;
}

// 欄內排序：優先序高到低，再依截止日早到晚
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/** 欄標題底色（同月曆的狀態配色） */
const COLUMN_CHIP: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  doing: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  hold: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

/** 優先序標記（僅高/低顯色，同清單） */
function PriorityMark({ priority }: { priority: TaskPriority }) {
  if (priority === "normal") return null;
  const cls =
    priority === "high"
      ? "text-rose-600 dark:text-rose-400"
      : "text-slate-400 dark:text-slate-500";
  return <span className={`shrink-0 text-xs font-medium ${cls}`}>{TASK_PRIORITY_LABELS[priority]}</span>;
}

/** 看板檢視：四個狀態欄，卡片可拖拉到別欄換狀態 */
export default function TaskBoardPanel({
  tasks,
  projects,
  projectFilter,
  onProjectFilterChange,
  onEdit,
  onChanged,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);

  // 篩選後依狀態分欄，欄內排序
  const columns = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const visible = tasks
      .filter((t) => projectFilter === "all" || t.project.trim() === projectFilter)
      .filter(
        (t) =>
          !kw ||
          t.title.toLowerCase().includes(kw) ||
          t.notes.toLowerCase().includes(kw) ||
          t.tags.some((g) => g.toLowerCase().includes(kw)),
      );
    const byStatus = new Map<TaskStatus, Task[]>(TASK_STATUSES.map((s) => [s.key, []]));
    for (const t of visible) byStatus.get(t.status)?.push(t);
    // 完成欄依完成時間新到舊；其他欄依優先序→截止日
    for (const [status, list] of byStatus)
      list.sort((a, b) => {
        if (status === "done")
          return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
        if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority])
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        const da = a.due_date ?? "9999-99-99";
        const db = b.due_date ?? "9999-99-99";
        if (da !== db) return da < db ? -1 : 1;
        return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
      });
    return byStatus;
  }, [tasks, projectFilter, keyword]);

  // 拖到別欄：改狀態存檔（completed_at 由後端 save_task 處理）
  const drop = async (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOver(null);
    if (saving) return;
    const id = Number(e.dataTransfer.getData("text/plain"));
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    setSaving(true);
    try {
      await api.saveTask({ ...task, status });
      await onChanged();
    } catch (err) {
      toastError(`更新狀態失敗：${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* 篩選列（欄位即狀態，不放狀態篩選） */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <select
          value={projectFilter}
          onChange={(e) => onProjectFilterChange(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="all">所有專案</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜尋標題 / 細節 / 標籤…"
          className="min-w-40 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500"
        />
      </div>

      {/* 四欄看板；窄視窗橫向捲動 */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[44rem] grid-cols-4 gap-3">
          {TASK_STATUSES.map(({ key, label }) => {
            const all = columns.get(key) ?? [];
            // 完成欄預設只顯示最近 7 天完成的，可展開全部
            const cutoff = dateStr(new Date(Date.now() - 7 * 86400000));
            const shown =
              key === "done" && !showAllDone
                ? all.filter((t) => (t.completed_at ?? "").slice(0, 10) >= cutoff)
                : all;
            const hiddenCount = all.length - shown.length;
            return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver((prev) => (prev === key ? null : prev))}
              onDrop={(e) => void drop(e, key)}
              className={`flex min-h-64 flex-col gap-2 rounded-lg border p-2 transition-colors ${
                dragOver === key
                  ? "border-accent-400 bg-accent-50/60 dark:border-accent-600 dark:bg-accent-900/20"
                  : "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40"
              }`}
            >
              <div className="flex items-center justify-between px-1">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${COLUMN_CHIP[key]}`}>
                  {label}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {hiddenCount > 0 ? `${shown.length} / ${all.length}` : all.length}
                </span>
              </div>
              {shown.map((t) => (
                <button
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.id))}
                  onClick={() => onEdit(t)}
                  className="flex cursor-grab flex-col gap-1 rounded-md border border-slate-200 bg-white p-2.5 text-left shadow-sm hover:border-accent-300 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900 dark:hover:border-accent-600"
                >
                  <span
                    className={`text-sm font-medium ${
                      t.status === "done"
                        ? "text-slate-400 line-through dark:text-slate-500"
                        : "text-slate-800 dark:text-slate-100"
                    }`}
                  >
                    {t.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <PriorityMark priority={t.priority} />
                    {t.project.trim() && <span>📁 {t.project.trim()}</span>}
                    {t.due_date && <span>截止 {t.due_date}</span>}
                    {t.tags.map((g) => (
                      <span key={g} className="text-indigo-500 dark:text-indigo-400">
                        #{g}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
              {key === "done" && (hiddenCount > 0 || showAllDone) && (
                <button
                  onClick={() => setShowAllDone((v) => !v)}
                  className="rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  {showAllDone ? "只顯示最近 7 天" : `顯示全部（${all.length}）`}
                </button>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
