import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import MDEditor from "@uiw/react-md-editor";
import { emptyTask, type Task, type TaskStatus } from "../types";
import * as api from "../lib/api";
import * as ai from "../lib/ai";
import * as exporter from "../lib/export";
import { toast, toastError } from "../lib/toast";
import TaskEditCard from "../components/TaskEditCard";
import TaskBreakdownPanel from "../components/TaskBreakdownPanel";
import TaskListPanel from "./TaskListPanel";
import TaskBoardPanel from "./TaskBoardPanel";
import TaskCalendarPanel from "./TaskCalendarPanel";

interface Props {
  tasks: Task[];
  onChanged: () => Promise<void>;
  onClose: () => void;
  dark: boolean;
}

type Mode = "list" | "board" | "calendar";

/** 工作面板容器：清單 / 看板 / 月曆三種檢視共用任務資料、篩選與工具（AI 拆解 / 儲存庫匯入 / AI 彙整），切模式時不重置 */
export default function WorkView({ tasks, onChanged, onClose, dark }: Props) {
  const [mode, setMode] = useState<Mode>("calendar");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [importedProjects, setImportedProjects] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [summary, setSummary] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const editDirty = useRef(false); // 編輯卡是否有未儲存變更（由 TaskEditCard 回報）

  // 關閉編輯彈窗；有未儲存變更時先確認，避免點背景 / Esc 誤丟編輯內容
  const closeEditor = async () => {
    if (editDirty.current) {
      const ok = await ask("尚未儲存的變更將會遺失，確定關閉？", {
        title: "關閉編輯",
        kind: "warning",
      });
      if (!ok) return;
    }
    editDirty.current = false;
    setEditing(null);
  };

  // 載入先前匯入的專案/儲存庫名稱（找不到時退回舊版 github_repos key）
  useEffect(() => {
    (async () => {
      try {
        const raw =
          (await api.getSetting(api.REPO_PROJECTS_KEY)) ??
          (await api.getSetting(api.LEGACY_GITHUB_REPOS_KEY));
        if (raw) setImportedProjects(JSON.parse(raw));
      } catch {
        // 略過解析失敗
      }
    })();
  }, []);

  // Esc 關閉編輯彈窗（有未儲存變更時會先確認）
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void closeEditor();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing]);

  // 專案清單（任務既有 ∪ 匯入的專案/儲存庫，去重、去空）
  const projects = useMemo(
    () =>
      Array.from(
        new Set([...tasks.map((t) => t.project.trim()).filter(Boolean), ...importedProjects]),
      ).sort(),
    [tasks, importedProjects],
  );

  const importProjects = async () => {
    setBusy("匯入專案中");
    try {
      const list = await api.listRepoProjects();
      await api.setSetting(api.REPO_PROJECTS_KEY, JSON.stringify(list));
      setImportedProjects(list);
      toast(`已匯入 ${list.length} 個專案/儲存庫`);
    } catch (e) {
      toastError(`匯入失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const summarizeProject = async () => {
    if (projectFilter === "all") return;
    const ofProject = tasks.filter((t) => t.project.trim() === projectFilter);
    if (ofProject.length === 0) return;
    setBusy("AI 彙整中");
    try {
      setSummary(await ai.summarizeProject(ofProject, projectFilter));
    } catch (e) {
      toastError(`AI 彙整失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  // 切專案時清掉上一個專案的彙整結果
  const changeProject = (p: string) => {
    setProjectFilter(p);
    setSummary("");
  };

  const saveTask = async (t: Task) => {
    await api.saveTask(t);
    await onChanged();
    editDirty.current = false;
    setEditing(null);
  };

  const removeTask = async (id: number) => {
    await api.deleteTask(id);
    await onChanged();
    editDirty.current = false;
    setEditing(null);
  };

  const panelProps = {
    tasks,
    projects,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    projectFilter,
    onProjectFilterChange: changeProject,
    onEdit: (t: Task) => setEditing({ ...t }),
  };

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">工作面板</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ["list", "清單"],
                ["board", "看板"],
                ["calendar", "月曆"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  mode === m
                    ? "bg-white font-medium text-accent-700 shadow-sm dark:bg-slate-700 dark:text-accent-300"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            返回
          </button>
        </div>
      </div>

      {/* 共用工具：兩種檢視通用 */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => setEditing(emptyTask())}
          className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
        >
          + 新增工作項目
        </button>
        <button
          onClick={() => setSplitting(true)}
          className="rounded-md border border-accent-300 bg-accent-50 px-3 py-1.5 text-sm font-medium text-accent-700 hover:bg-accent-100 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50"
        >
          ✨ AI 拆解工項
        </button>
        <button
          onClick={importProjects}
          disabled={!!busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {busy === "匯入專案中" ? "匯入中…" : "匯入專案/儲存庫"}
        </button>
        {projectFilter !== "all" && (
          <button
            onClick={summarizeProject}
            disabled={!!busy}
            className="rounded-md border border-accent-300 bg-accent-50 px-3 py-1.5 text-sm text-accent-700 hover:bg-accent-100 disabled:opacity-50 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50"
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
          <div className="max-h-72 overflow-y-auto" data-color-mode={dark ? "dark" : "light"}>
            <MDEditor.Markdown source={summary} style={{ background: "transparent" }} />
          </div>
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

      {mode === "list" ? (
        <TaskListPanel {...panelProps} />
      ) : mode === "board" ? (
        <TaskBoardPanel {...panelProps} onChanged={onChanged} />
      ) : (
        <TaskCalendarPanel {...panelProps} />
      )}

      {/* 編輯 / 新增彈窗（兩種檢視共用） */}
      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
          onClick={() => void closeEditor()}
        >
          <div className="mt-10 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <TaskEditCard
              key={editing.id ?? "new"}
              task={editing}
              projects={projects}
              onSave={saveTask}
              onDelete={removeTask}
              onCancel={() => void closeEditor()}
              onDirtyChange={(d) => (editDirty.current = d)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
