import { useMemo, useState } from "react";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../types";

interface Props {
  tasks: Task[];
  projects: string[];
  statusFilter: TaskStatus | "all";
  onStatusFilterChange: (s: TaskStatus | "all") => void;
  projectFilter: string;
  onProjectFilterChange: (p: string) => void;
  onEdit: (t: Task) => void;
}

// 清單排序用：未完成優先、進行中最前；完成沉底
const STATUS_ORDER: Record<TaskStatus, number> = { doing: 0, todo: 1, hold: 2, done: 3 };
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/** 狀態 badge */
function StatusBadge({ status }: { status: TaskStatus }) {
  const cls: Record<TaskStatus, string> = {
    todo: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    doing: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    hold: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${cls[status]}`}>
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

/** 優先序標記（僅高/低顯色） */
function PriorityMark({ priority }: { priority: TaskPriority }) {
  if (priority === "normal") return null;
  const cls =
    priority === "high"
      ? "text-rose-600 dark:text-rose-400"
      : "text-slate-400 dark:text-slate-500";
  return <span className={`shrink-0 text-xs font-medium ${cls}`}>優先序：{TASK_PRIORITY_LABELS[priority]}</span>;
}

export default function TaskListPanel({
  tasks,
  projects,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  onEdit,
}: Props) {
  const [keyword, setKeyword] = useState("");

  // 篩選 + 排序
  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return tasks
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => projectFilter === "all" || t.project.trim() === projectFilter)
      .filter(
        (t) =>
          !kw ||
          t.title.toLowerCase().includes(kw) ||
          t.notes.toLowerCase().includes(kw) ||
          t.tags.some((g) => g.toLowerCase().includes(kw)),
      )
      .sort((a, b) => {
        if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status])
          return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority])
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        // 有截止日的排前面、依日期早到晚
        const da = a.due_date ?? "9999-99-99";
        const db = b.due_date ?? "9999-99-99";
        if (da !== db) return da < db ? -1 : 1;
        return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
      });
  }, [tasks, statusFilter, projectFilter, keyword]);

  return (
    <>
      {/* 篩選列 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(["all", ...TASK_STATUSES.map((s) => s.key)] as const).map((s) => (
            <button
              key={s}
              onClick={() => onStatusFilterChange(s)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                statusFilter === s
                  ? "bg-white font-medium text-accent-700 shadow-sm dark:bg-slate-700 dark:text-accent-300"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {s === "all" ? "全部" : TASK_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
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

      {/* 清單 */}
      {visible.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
          {tasks.length === 0 ? "尚無工作項目，點「+ 新增工作項目」開始" : "沒有符合篩選條件的工作項目"}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {visible.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onEdit(t)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-medium ${
                      t.status === "done"
                        ? "text-slate-400 line-through dark:text-slate-500"
                        : "text-slate-800 dark:text-slate-100"
                    }`}
                  >
                    {t.title}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs text-slate-500 dark:text-slate-400">
                  {t.project.trim() && <span>📁 {t.project.trim()}</span>}
                  <PriorityMark priority={t.priority} />
                  {t.due_date && <span>截止 {t.due_date}</span>}
                  {t.tags.map((g) => (
                    <span key={g} className="text-indigo-500 dark:text-indigo-400">
                      #{g}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
