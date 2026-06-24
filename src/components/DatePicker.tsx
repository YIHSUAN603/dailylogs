import { useEffect, useRef, useState } from "react";

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** YYYY-MM-DD → Date（本地時區），空字串回傳今天 */
function parse(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

/** Date → YYYY-MM-DD（本地時區） */
function fmt(d: Date): string {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * 自繪日期選擇器。用 DOM 畫日曆、完全由 React 控制開關，
 * 避開 WebKitGTK 原生 <input type="date"> 在 Tauri 裡 popover 關不掉的問題。
 */
export default function DatePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parse(value)); // 目前顯示的月份
  const ref = useRef<HTMLDivElement>(null);

  // 開啟時：點選範圍外、按 Esc 都關閉
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setView(parse(value)); // 開啟時對齊目前值的月份
    setOpen((o) => !o);
  };

  const year = view.getFullYear();
  const month = view.getMonth();
  const startPad = (new Date(year, month, 1).getDay() + 6) % 7; // 週一=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="w-32 rounded-md border border-slate-300 px-2.5 py-1.5 text-left text-sm text-slate-800 outline-none hover:border-sky-500 focus:border-sky-500"
      >
        {value || "選擇日期"}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(new Date(year, month - 1, 1))}
              className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-slate-700">
              {year} 年 {month + 1} 月
            </span>
            <button
              type="button"
              onClick={() => setView(new Date(year, month + 1, 1))}
              className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />;
              const iso = fmt(new Date(year, month, d));
              const isSelected = iso === value;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={`rounded py-1 ${
                    isSelected
                      ? "bg-sky-600 text-white"
                      : "text-slate-700 hover:bg-sky-100"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
