import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReportMeta, SearchHit } from "../types";
import { todayStr } from "../lib/format";

const pad2 = (n: number) => String(n).padStart(2, "0");
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** 自繪月曆（不依賴原生 picker，開關完全可控）。選某天即回傳 YYYY-MM-DD */
function MonthCalendar({ value, onSelect }: { value: string; onSelect: (date: string) => void }) {
  const base = value ? new Date(value + "T00:00:00") : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() }); // m: 0-11
  const today = todayStr();

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const shift = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div className="w-60 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
      <div className="flex items-center justify-between px-1 pb-1">
        <button onClick={() => shift(-1)} aria-label="上個月" className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100">
          ‹
        </button>
        <span className="text-sm font-medium text-slate-700">
          {view.y} 年 {view.m + 1} 月
        </span>
        <button onClick={() => shift(1)} aria-label="下個月" className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {WEEK.map((w) => (
          <span key={w} className="py-1 text-slate-400">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const ds = `${view.y}-${pad2(view.m + 1)}-${pad2(d)}`;
          const isToday = ds === today;
          const isSel = ds === value;
          return (
            <button
              key={i}
              onClick={() => onSelect(ds)}
              className={`rounded py-1 hover:bg-sky-100 ${
                isSel
                  ? "bg-sky-600 text-white hover:bg-sky-600"
                  : isToday
                    ? "font-bold text-sky-600"
                    : "text-slate-700"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  reports: ReportMeta[];
  selectedDate: string;
  search: string;
  onSearchChange: (q: string) => void;
  hits: SearchHit[];
  onSelect: (date: string) => void;
  onPickDate: (date: string) => void;
  onOpenSettings: () => void;
  onOpenWeekly: () => void;
}

/** 狀態 badge（草稿/完成） */
function StatusBadge({ status }: { status: ReportMeta["status"] }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        status === "final" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {status === "final" ? "完成" : "草稿"}
    </span>
  );
}

/** 把片段中（大小寫不敏感）命中的關鍵字包成 <mark> */
function highlight(text: string, keyword: string): ReactNode[] {
  const kw = keyword.trim();
  if (!kw) return [text];
  const lower = text.toLowerCase();
  const target = kw.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let i = lower.indexOf(target, from);
  let key = 0;
  while (i !== -1) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(
      <mark key={key++} className="rounded bg-yellow-200 px-0.5 text-slate-900">
        {text.slice(i, i + kw.length)}
      </mark>,
    );
    from = i + kw.length;
    i = lower.indexOf(target, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

export default function Sidebar({
  reports,
  selectedDate,
  search,
  onSearchChange,
  hits,
  onSelect,
  onPickDate,
  onOpenSettings,
  onOpenWeekly,
}: Props) {
  const searching = search.trim().length > 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const activeDate = selectedDate || todayStr();
  const isToday = activeDate === todayStr();

  // 點月曆外 / 按 Esc 收合
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setPickerOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [pickerOpen]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-base font-bold text-slate-800">日報告</h1>
        <div ref={pickerRef} className="relative flex items-center">
          {/* split button：左邊開啟目前日期（預設今日），右邊小箭頭展開自繪月曆 */}
          <button
            onClick={() => onPickDate(activeDate)}
            className="rounded-l-md bg-sky-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-sky-700"
          >
            + {isToday ? "今日" : activeDate.slice(5)}
          </button>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            title="選擇其他日期"
            aria-label="選擇其他日期"
            aria-expanded={pickerOpen}
            className="rounded-r-md border-l border-sky-500 bg-sky-600 px-1.5 py-1 text-sm text-white hover:bg-sky-700"
          >
            ▾
          </button>
          {pickerOpen && (
            <div className="absolute right-0 top-full z-10 mt-1">
              <MonthCalendar
                value={activeDate}
                onSelect={(date) => {
                  onPickDate(date);
                  setPickerOpen(false); // 選完即關閉
                }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜尋日報…"
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 pr-7 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
          />
          {searching && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:text-slate-600"
              aria-label="清除搜尋"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {searching ? (
          hits.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-400">找不到符合的日報</p>
          ) : (
            <ul className="space-y-1">
              {hits.map((h) => {
                const active = h.date === selectedDate;
                return (
                  <li key={h.date}>
                    <button
                      onClick={() => onSelect(h.date)}
                      className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left ${
                        active ? "bg-sky-100 text-sky-900" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="flex items-center justify-between text-sm">
                        <span className="font-medium">{h.date}</span>
                        <StatusBadge status={h.status} />
                      </span>
                      <span className="line-clamp-2 text-xs text-slate-500">
                        {highlight(h.snippet, search)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <>
            {reports.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-slate-400">尚無日報，點「+ 今日」開始</p>
            )}
            <ul className="space-y-1">
              {reports.map((r) => {
                const active = r.date === selectedDate;
                return (
                  <li key={r.date}>
                    <button
                      onClick={() => onSelect(r.date)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                        active ? "bg-sky-100 text-sky-900" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="font-medium">{r.date}</span>
                      <StatusBadge status={r.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <button
        onClick={onOpenWeekly}
        className="border-t border-slate-200 px-4 py-3 text-left text-sm text-slate-600 hover:bg-slate-100"
      >
        📅 週報 / 月報
      </button>
      <button
        onClick={onOpenSettings}
        className="border-t border-slate-200 px-4 py-3 text-left text-sm text-slate-600 hover:bg-slate-100"
      >
        ⚙ 設定
      </button>
    </aside>
  );
}
