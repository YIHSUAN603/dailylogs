import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import ReportEditor from "./components/ReportEditor";
import SettingsView from "./views/SettingsView";
import WeeklyView from "./views/WeeklyView";
import WorkPanelView from "./views/WorkPanelView";
import CalendarView from "./views/CalendarView";
import { emptyReport, type Report, type ReportMeta, type SearchHit, type Task } from "./types";
import { todayStr } from "./lib/format";
import * as api from "./lib/api";
import {
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  applyAccent,
  applyMode,
  isAccentName,
  isThemeMode,
  resolveMode,
  type AccentName,
  type ThemeMode,
} from "./lib/theme";

export default function App() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"editor" | "settings" | "weekly" | "tasks" | "calendar">(
    "editor",
  );
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState("");
  const [accent, setAccent] = useState<AccentName>(DEFAULT_ACCENT);
  const [mode, setMode] = useState<ThemeMode>(DEFAULT_MODE);
  const [dark, setDark] = useState(false); // 解析後的實際深淺（system 依系統偏好）
  const saveTimer = useRef<number | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setReports(await api.listReports());
    } catch (e) {
      setError(`載入清單失敗：${e}`);
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
    } catch (e) {
      setError(`載入工作項目失敗：${e}`);
    }
  }, []);

  // 載入某日日報（不存在則開新的空白日報）與其標籤
  const openDate = useCallback(async (date: string) => {
    try {
      const existing = await api.getReport(date);
      setReport(existing ?? emptyReport(date));
      setTags(await api.getReportTags(date));
      setView("editor");
    } catch (e) {
      setError(`開啟日報失敗：${e}`);
    }
  }, []);

  // 初次載入：列出清單並開啟今天
  useEffect(() => {
    (async () => {
      await refreshList();
      await refreshTasks();
      await openDate(todayStr());
    })();
  }, [refreshList, refreshTasks, openDate]);

  // 初次載入：套用已存的主題設定（主色 + 模式；模式的套用交給下方 effect）
  useEffect(() => {
    (async () => {
      const savedAccent = await api.getSetting(api.THEME_ACCENT_KEY);
      const savedMode = await api.getSetting(api.THEME_MODE_KEY);
      const a = isAccentName(savedAccent) ? savedAccent : DEFAULT_ACCENT;
      setAccent(a);
      applyAccent(a);
      setMode(isThemeMode(savedMode) ? savedMode : DEFAULT_MODE);
    })();
  }, []);

  // 套用模式並解析實際深淺；mode 為 system 時跟隨系統偏好變化
  useEffect(() => {
    applyMode(mode);
    setDark(resolveMode(mode) === "dark");
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyMode("system");
      setDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const changeAccent = useCallback((name: AccentName) => {
    setAccent(name);
    applyAccent(name);
    api.setSetting(api.THEME_ACCENT_KEY, name);
  }, []);

  const changeMode = useCallback((m: ThemeMode) => {
    setMode(m); // 套用由上方 effect 處理
    api.setSetting(api.THEME_MODE_KEY, m);
  }, []);

  // 關鍵字搜尋：250ms 防抖；空字串則清空結果
  useEffect(() => {
    if (!search.trim()) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        setHits(await api.searchReports(search));
      } catch (e) {
        setError(`搜尋失敗：${e}`);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // 編輯：本地立即更新 + 防抖存檔
  const handleChange = useCallback(
    (patch: Partial<Report>) => {
      setReport((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
          setSaving(true);
          try {
            const updatedAt = await api.saveReport(next);
            setReport((r) => (r && r.date === next.date ? { ...r, updated_at: updatedAt } : r));
            await refreshList();
          } catch (e) {
            setError(`存檔失敗：${e}`);
          } finally {
            setSaving(false);
          }
        }, 600);
        return next;
      });
    },
    [refreshList],
  );

  // 標籤變更：立即存檔
  const handleTagsChange = useCallback(
    async (newTags: string[]) => {
      if (!report) return;
      setTags(newTags);
      try {
        await api.setReportTags(report.date, newTags);
      } catch (e) {
        setError(`標籤存檔失敗：${e}`);
      }
    },
    [report],
  );

  // 刪除日報：刪除後刷新清單，開啟剩下最新一份（無則退回今天）
  const handleDelete = useCallback(
    async (date: string) => {
      await api.deleteReport(date);
      const list = await api.listReports();
      setReports(list);
      const next = list.find((r) => r.date !== date)?.date ?? todayStr();
      await openDate(next);
    },
    [openDate],
  );

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      {error && (
        <div className="absolute inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-rose-600 px-4 py-2 text-sm text-white">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError("")}
            className="shrink-0 rounded px-2 py-0.5 hover:bg-rose-700"
            aria-label="關閉錯誤訊息"
          >
            ✕
          </button>
        </div>
      )}
      <Sidebar
        reports={reports}
        selectedDate={view === "editor" ? report?.date ?? "" : ""}
        search={search}
        onSearchChange={setSearch}
        hits={hits}
        onSelect={openDate}
        onPickDate={openDate}
        onOpenSettings={() => setView("settings")}
        onOpenWeekly={() => setView("weekly")}
        onOpenTasks={() => setView("tasks")}
        onOpenCalendar={() => setView("calendar")}
      />
      <main className="flex-1 overflow-y-auto">
        {view === "settings" ? (
          <SettingsView
            onClose={() => setView("editor")}
            accent={accent}
            mode={mode}
            onAccentChange={changeAccent}
            onModeChange={changeMode}
          />
        ) : view === "weekly" ? (
          <WeeklyView onClose={() => setView("editor")} dark={dark} />
        ) : view === "tasks" ? (
          <WorkPanelView tasks={tasks} onChanged={refreshTasks} onClose={() => setView("editor")} />
        ) : view === "calendar" ? (
          <CalendarView tasks={tasks} onChanged={refreshTasks} onClose={() => setView("editor")} />
        ) : report ? (
          <ReportEditor
            report={report}
            saving={saving}
            tags={tags}
            tasks={tasks}
            dark={dark}
            onChange={handleChange}
            onTagsChange={handleTagsChange}
            onDelete={handleDelete}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400 dark:text-slate-500">載入中…</div>
        )}
      </main>
    </div>
  );
}
