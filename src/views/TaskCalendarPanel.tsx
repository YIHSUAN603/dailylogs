import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  emptyTask,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../types";
import { dateStr as dsOf, todayStr } from "../lib/format";

interface Props {
  tasks: Task[];
  projects: string[];
  statusFilter: TaskStatus | "all";
  onStatusFilterChange: (s: TaskStatus | "all") => void;
  projectFilter: string;
  onProjectFilterChange: (p: string) => void;
  onEdit: (t: Task) => void;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** 狀態決定底色 */
const STATUS_CHIP: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  doing: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  hold: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
const OVERDUE_CHIP = "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";

/** 優先序決定左側色條 */
const PRIORITY_BORDER: Record<TaskPriority, string> = {
  high: "border-rose-400 dark:border-rose-500",
  normal: "border-slate-300 dark:border-slate-500",
  low: "border-slate-200 dark:border-slate-600",
};

type Entry = { task: Task; due: boolean; done: boolean };

/** 狀態 badge（抽屜清單用） */
function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${STATUS_CHIP[status]}`}>
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

/** 月曆檢視：把工作面板的任務依截止日 / 完成日落在格子上 */
export default function TaskCalendarPanel({
  tasks,
  projects,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  onEdit,
}: Props) {
  const today = todayStr();
  const base = new Date(today + "T00:00:00");
  const [ym, setYm] = useState({ y: base.getFullYear(), m: base.getMonth() }); // m: 0-11
  const [dayPanel, setDayPanel] = useState<string | null>(null); // 當日詳情抽屜的日期
  const [hideDone, setHideDone] = useState(false);

  // Esc 關閉當日抽屜
  useEffect(() => {
    if (!dayPanel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDayPanel(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dayPanel]);

  // 篩選 → 依日期分桶。due = 截止日落該天；done = 當天標記完成（completed_at 取前 10 碼）
  const byDate = useMemo(() => {
    const filtered = tasks.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (projectFilter === "all" || t.project.trim() === projectFilter) &&
        (!hideDone || t.status !== "done"),
    );
    const m = new Map<string, Entry[]>();
    const add = (ds: string, task: Task, kind: "due" | "done") => {
      let arr = m.get(ds);
      if (!arr) {
        arr = [];
        m.set(ds, arr);
      }
      const ex = task.id != null ? arr.find((e) => e.task.id === task.id) : undefined;
      if (ex) {
        if (kind === "due") ex.due = true;
        else ex.done = true;
      } else {
        arr.push({ task, due: kind === "due", done: kind === "done" });
      }
    };
    for (const t of filtered) {
      if (t.due_date) add(t.due_date, t, "due");
      if (t.completed_at) add(t.completed_at.slice(0, 10), t, "done");
    }
    return m;
  }, [tasks, statusFilter, projectFilter, hideDone]);

  // 以本月 1 號的星期回推網格起點，前後以鄰月日補足；列數依當月實際需要（5 或 6 列），避免月末多一整週
  const firstWeekday = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const rows = Math.ceil((firstWeekday + daysInMonth) / 7);
  const days = Array.from({ length: rows * 7 }, (_, i) => new Date(ym.y, ym.m, 1 - firstWeekday + i));

  const shift = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  const goThisMonth = () => {
    const d = new Date();
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  const isOverdue = (e: Entry) =>
    e.due && !!e.task.due_date && e.task.due_date < today && e.task.status !== "done";

  /** 小卡 className */
  const chipClass = (e: Entry) =>
    `block w-full truncate rounded border-l-2 px-1 py-0.5 text-left text-xs ${PRIORITY_BORDER[e.task.priority]} ${
      isOverdue(e) ? OVERDUE_CHIP : STATUS_CHIP[e.task.status]
    } ${e.task.status === "done" ? "line-through opacity-80" : ""}`;

  const panelEntries = dayPanel ? byDate.get(dayPanel) ?? [] : [];

  return (
    <>
      {/* 月份導覽 + 篩選（同一列） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            aria-label="上個月"
            className="flex items-center rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-28 text-center text-sm font-medium text-slate-700 dark:text-slate-200">
            {ym.y} 年 {ym.m + 1} 月
          </span>
          <button
            onClick={() => shift(1)}
            aria-label="下個月"
            className="flex items-center rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={goThisMonth}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            本月
          </button>
        </div>
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
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
            className="accent-accent-600"
          />
          隱藏已完成
        </label>

        {/* 色彩圖例 */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-0 border-l-2 border-rose-400" />高
            <span className="ml-1 inline-block h-3 w-0 border-l-2 border-slate-300" />中
            <span className="ml-1 inline-block h-3 w-0 border-l-2 border-slate-200" />低
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-200" />進行
            <span className="ml-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200" />完成
            <span className="ml-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-200" />逾期
          </span>
        </div>
      </div>

      {/* 週標題 */}
      <div className="grid grid-cols-7 text-center text-xs text-slate-400 dark:text-slate-500">
        {WEEK.map((w, i) => (
          <div key={w} className={`py-2 ${i === 0 || i === 6 ? "text-slate-300 dark:text-slate-600" : ""}`}>
            {w}
          </div>
        ))}
      </div>

      {/* 日期格 */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700">
        {days.map((d, i) => {
          const ds = dsOf(d);
          const inMonth = d.getMonth() === ym.m;
          const isToday = ds === today;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const entries = byDate.get(ds) ?? [];
          const shown = entries.slice(0, 3);
          const extra = entries.length - shown.length;
          return (
            <div
              key={i}
              onClick={() => setDayPanel(ds)}
              className={`group flex min-h-28 cursor-pointer flex-col overflow-hidden p-1 ${
                inMonth
                  ? isWeekend
                    ? "bg-slate-50/70 dark:bg-slate-800/70"
                    : "bg-white dark:bg-slate-800"
                  : "bg-slate-50 dark:bg-slate-900/40"
              } hover:bg-accent-50/50 dark:hover:bg-accent-900/10`}
              title="點開查看當日工作項目"
            >
              <div className="flex items-center justify-between px-0.5">
                <span
                  className={`text-xs ${
                    isToday
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 font-bold text-white"
                      : inMonth
                        ? "text-slate-500 dark:text-slate-400"
                        : "text-slate-300 dark:text-slate-600"
                  }`}
                >
                  {d.getDate()}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit({ ...emptyTask(), due_date: ds });
                  }}
                  aria-label="新增該日工作項目"
                  className="rounded px-1 text-xs text-slate-400 opacity-0 hover:bg-slate-200 group-hover:opacity-100 dark:text-slate-500 dark:hover:bg-slate-600"
                >
                  ＋
                </button>
              </div>
              <div className={`mt-1 flex-1 space-y-0.5 ${inMonth ? "" : "opacity-60"}`}>
                {shown.map((e) => (
                  <button
                    key={e.task.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEdit({ ...e.task });
                    }}
                    title={e.task.title}
                    className={chipClass(e)}
                  >
                    {e.done ? "✓ " : ""}
                    {e.task.title}
                  </button>
                ))}
                {extra > 0 && (
                  <span className="block px-1 text-xs text-slate-400 dark:text-slate-500">+{extra} 更多</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 當日詳情抽屜 */}
      {dayPanel && (
        <div className="fixed inset-0 z-30" onClick={() => setDayPanel(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute right-0 top-0 flex h-full w-[360px] max-w-[90vw] flex-col bg-white shadow-xl dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {(() => {
                  const d = new Date(dayPanel + "T00:00:00");
                  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（週${WEEK[d.getDay()]}）`;
                })()}
              </span>
              <button
                onClick={() => setDayPanel(null)}
                aria-label="關閉"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
              <button
                onClick={() => onEdit({ ...emptyTask(), due_date: dayPanel })}
                className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
              >
                + 新增工作項目
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {panelEntries.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  這天沒有工作項目
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {panelEntries.map((e) => (
                    <li key={e.task.id}>
                      <button
                        onClick={() => onEdit({ ...e.task })}
                        className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      >
                        <span className="flex items-center gap-2">
                          <StatusBadge status={e.task.status} />
                          <span
                            className={`min-w-0 flex-1 truncate text-sm font-medium ${
                              e.task.status === "done"
                                ? "text-slate-400 line-through dark:text-slate-500"
                                : "text-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {e.task.title}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs text-slate-500 dark:text-slate-400">
                          {isOverdue(e) ? (
                            <span className="text-rose-600 dark:text-rose-400">逾期</span>
                          ) : e.due ? (
                            <span>截止</span>
                          ) : null}
                          {e.done && <span className="text-emerald-600 dark:text-emerald-400">當日完成</span>}
                          {e.task.project.trim() && <span>📁 {e.task.project.trim()}</span>}
                          {e.task.priority !== "normal" && (
                            <span
                              className={
                                e.task.priority === "high"
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-slate-400 dark:text-slate-500"
                              }
                            >
                              優先序：{TASK_PRIORITY_LABELS[e.task.priority]}
                            </span>
                          )}
                          {e.task.tags.map((g) => (
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
