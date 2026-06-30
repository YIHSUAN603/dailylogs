import { useEffect, useMemo, useState } from "react";
import {
  emptyTask,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from "../types";
import * as api from "../lib/api";
import * as ai from "../lib/ai";
import * as exporter from "../lib/export";
import TaskEditCard from "../components/TaskEditCard";
import TaskBreakdownPanel from "../components/TaskBreakdownPanel";

interface Props {
  tasks: Task[];
  onChanged: () => Promise<void>;
  onClose: () => void;
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

export default function WorkPanelView({ tasks, onChanged, onClose }: Props) {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [busy, setBusy] = useState("");
  const [summary, setSummary] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [importedProjects, setImportedProjects] = useState<string[]>([]);

  // 載入先前匯入的 TFS 專案名稱
  useEffect(() => {
    (async () => {
      try {
        const raw = await api.getSetting(api.TFS_PROJECTS_KEY);
        if (raw) setImportedProjects(JSON.parse(raw));
      } catch {
        // 略過解析失敗
      }
    })();
  }, []);

  // 專案清單（任務既有 ∪ 匯入的 TFS 專案，去重、去空）
  const projects = useMemo(
    () =>
      Array.from(
        new Set([
          ...tasks.map((t) => t.project.trim()).filter(Boolean),
          ...importedProjects,
        ]),
      ).sort(),
    [tasks, importedProjects],
  );

  const importProjects = async () => {
    setBusy("匯入專案中");
    try {
      const list = await api.tfsListProjects();
      await api.setSetting(api.TFS_PROJECTS_KEY, JSON.stringify(list));
      setImportedProjects(list);
      alert(`已匯入 ${list.length} 個專案`);
    } catch (e) {
      alert(`匯入失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

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

  const openNew = () => {
    setSplitting(false);
    setEditing(emptyTask());
  };

  const openEdit = (t: Task) => {
    setSplitting(false);
    setEditing({ ...t });
  };

  const openSplit = () => {
    setEditing(null);
    setSplitting(true);
  };

  const saveTask = async (t: Task) => {
    await api.saveTask(t);
    await onChanged();
    setEditing(null);
  };

  const removeTask = async (id: number) => {
    await api.deleteTask(id);
    await onChanged();
    setEditing(null);
  };

  const summarizeProject = async () => {
    if (projectFilter === "all") return;
    const ofProject = tasks.filter((t) => t.project.trim() === projectFilter);
    if (ofProject.length === 0) return;
    setBusy("AI 彙整中");
    try {
      setSummary(await ai.summarizeProject(ofProject, projectFilter));
    } catch (e) {
      alert(`AI 彙整失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">工作面板</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={openNew}
            className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
          >
            + 新增工作項目
          </button>
          <button
            onClick={openSplit}
            className="rounded-md border border-accent-300 bg-accent-50 px-3 py-1.5 text-sm font-medium text-accent-700 hover:bg-accent-100 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50"
          >
            ✨ AI 拆解工項
          </button>
          <button
            onClick={importProjects}
            disabled={!!busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {busy === "匯入專案中" ? "匯入中…" : "匯入 TFS 專案"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            返回
          </button>
        </div>
      </div>

      {/* 篩選列 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(["all", ...TASK_STATUSES.map((s) => s.key)] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
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
          onChange={(e) => {
            setProjectFilter(e.target.value);
            setSummary("");
          }}
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
        {projectFilter !== "all" && (
          <button
            onClick={summarizeProject}
            disabled={!!busy}
            className="rounded border border-accent-300 bg-accent-50 px-2.5 py-1.5 text-xs text-accent-700 hover:bg-accent-100 disabled:opacity-50 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50"
          >
            {busy === "AI 彙整中" ? "AI 彙整中…" : "AI 彙整進度"}
          </button>
        )}
      </div>

      {/* 專案進度彙整結果 */}
      {summary && (
        <div className="mb-4 rounded-lg border border-accent-200 bg-accent-50/50 p-4 dark:border-accent-800 dark:bg-accent-900/20">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              「{projectFilter}」進度彙整
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exporter.copyText(summary)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                複製
              </button>
              <button
                onClick={() => setSummary("")}
                className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>
          </div>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
            {summary}
          </pre>
        </div>
      )}

      {/* AI 拆解工項 */}
      {splitting && (
        <TaskBreakdownPanel
          projects={projects}
          onCreated={onChanged}
          onClose={() => setSplitting(false)}
        />
      )}

      {/* 編輯卡 */}
      {editing && (
        <div className="mb-4">
          <TaskEditCard
            key={editing.id ?? "new"}
            task={editing}
            projects={projects}
            onSave={saveTask}
            onDelete={removeTask}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

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
                onClick={() => openEdit(t)}
                className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${
                  editing?.id === t.id ? "bg-accent-50 dark:bg-accent-900/30" : ""
                }`}
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
    </div>
  );
}
