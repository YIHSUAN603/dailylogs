import { useEffect, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import {
  listReportsInRange,
  saveSummary,
  listSummaries,
  getSummary,
  deleteSummary,
} from "../lib/api";
import { summarizeRange } from "../lib/ai";
import * as exporter from "../lib/export";
import DatePicker from "../components/DatePicker";
import type { Report, SummaryKind, SummaryMeta } from "../types";

interface Props {
  onClose: () => void;
}

/** 本週一 ~ 本週日 */
function thisWeek(): [string, string] {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 週一=0
  const mon = new Date(d);
  mon.setDate(d.getDate() - day);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return [fmt(mon), fmt(sun)];
}

/** 上週一 ~ 上週日 */
function lastWeek(): [string, string] {
  const [s, e] = thisWeek();
  const mon = new Date(s);
  mon.setDate(mon.getDate() - 7);
  const sun = new Date(e);
  sun.setDate(sun.getDate() - 7);
  return [fmt(mon), fmt(sun)];
}

/** 本月一日 ~ 月底 */
function thisMonth(): [string, string] {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [fmt(first), fmt(last)];
}

/** 上月一日 ~ 上月底 */
function lastMonth(): [string, string] {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return [fmt(first), fmt(last)];
}

/** 近 30 天（含今天） */
function last30Days(): [string, string] {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 29);
  return [fmt(start), fmt(end)];
}

function fmt(d: Date): string {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

const KIND_LABEL: Record<SummaryKind, string> = {
  weekly: "週報",
  monthly: "月報",
  custom: "報告",
};

/** 快捷區間預設 */
const PRESETS = [
  { id: "thisWeek", label: "本週", kind: "weekly", range: thisWeek },
  { id: "lastWeek", label: "上週", kind: "weekly", range: lastWeek },
  { id: "thisMonth", label: "本月", kind: "monthly", range: thisMonth },
  { id: "lastMonth", label: "上月", kind: "monthly", range: lastMonth },
  { id: "last30", label: "近 30 天", kind: "custom", range: last30Days },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

/** 依種類與區間組出預設標題 */
function defaultTitle(kind: SummaryKind, start: string, end: string): string {
  return `${KIND_LABEL[kind]} ${start} ~ ${end}`;
}

export default function WeeklyView({ onClose }: Props) {
  const [start, setStart] = useState(thisWeek()[0]);
  const [end, setEnd] = useState(thisWeek()[1]);
  const [kind, setKind] = useState<SummaryKind>("weekly");
  const [preset, setPreset] = useState<PresetId | null>("thisWeek");
  const [title, setTitle] = useState("");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState("");
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [history, setHistory] = useState<SummaryMeta[]>([]);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const refreshHistory = async () => {
    setHistory(await listSummaries());
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  /** 套用快捷區間 */
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const [s, e] = p.range();
    setKind(p.kind);
    setStart(s);
    setEnd(e);
    setPreset(p.id);
  };

  const load = async () => {
    setReports(await listReportsInRange(start, end));
  };

  const summarize = async () => {
    setBusy("彙整中");
    try {
      const rs = await listReportsInRange(start, end);
      setReports(rs);
      if (rs.length === 0) {
        setResult("");
        throw new Error("此區間沒有日報");
      }
      const md = await summarizeRange(rs, `${start} ~ ${end}`);
      setResult(md);
      // 新一次彙整視為新的一份：清掉 currentId、帶入預設標題
      setCurrentId(null);
      setTitle(defaultTitle(kind, start, end));
    } catch (e) {
      alert(`彙整失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!result.trim()) return;
    setBusy("儲存中");
    try {
      const id = await saveSummary({
        id: currentId ?? undefined,
        kind,
        start_date: start,
        end_date: end,
        title: title.trim() || defaultTitle(kind, start, end),
        content: result,
      });
      setCurrentId(id);
      await refreshHistory();
    } catch (e) {
      alert(`儲存失敗：${e}`);
    } finally {
      setBusy("");
    }
  };

  const loadSummary = async (id: number) => {
    const s = await getSummary(id);
    if (!s) return;
    setCurrentId(s.id ?? id);
    setKind(s.kind);
    setStart(s.start_date);
    setEnd(s.end_date);
    setPreset(null);
    setTitle(s.title);
    setResult(s.content);
    setReports(null);
  };

  const removeSummary = async (id: number) => {
    await deleteSummary(id);
    if (currentId === id) setCurrentId(null);
    setConfirmDel(null);
    await refreshHistory();
  };

  const printPdf = () => {
    const heading = title.trim() || `工作${KIND_LABEL[kind]} ${start} ~ ${end}`;
    const name = title.trim() || `${KIND_LABEL[kind]}_${start}_${end}`;
    exporter.printMarkdown(name, `# ${heading}\n\n${result}`);
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">週報 / 月報彙整</h2>
        <button
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
        >
          返回
        </button>
      </div>

      {/* 區間選擇 */}
      <div className="mb-4 space-y-4 rounded-lg border border-slate-200 p-4">
        {/* 快捷區間 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-500">快捷區間</div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  preset === p.id
                    ? "bg-white font-medium text-sky-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 自訂日期 + 動作 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-col">
              <label className="mb-1 text-xs text-slate-500">起</label>
              <DatePicker
                value={start}
                onChange={(v) => {
                  setStart(v);
                  setPreset(null);
                }}
              />
            </div>
            <span className="pb-1.5 text-slate-400">~</span>
            <div className="flex flex-col">
              <label className="mb-1 text-xs text-slate-500">迄</label>
              <DatePicker
                value={end}
                onChange={(v) => {
                  setEnd(v);
                  setPreset(null);
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              查詢
            </button>
            <button
              onClick={summarize}
              disabled={!!busy}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {busy === "彙整中" ? "AI 彙整中…" : "AI 彙整成報告"}
            </button>
          </div>
        </div>
      </div>

      {/* 區間內日報概況 */}
      {reports && (
        <p className="mb-4 text-sm text-slate-500">
          區間內 {reports.length} 份日報
          {reports.length > 0 && `：${reports.map((r) => r.date).join("、")}`}
        </p>
      )}

      {/* 結果：可編輯 + 預覽 */}
      {result && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="報告標題"
              className="min-w-48 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 outline-none focus:border-sky-500"
            />
            <button
              onClick={save}
              disabled={!!busy}
              className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "儲存中" ? "儲存中…" : currentId ? "💾 更新" : "💾 儲存到 DB"}
            </button>
            <button
              onClick={() => exporter.copyText(result)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              複製
            </button>
            <button
              onClick={() =>
                exporter.saveMarkdownText(result, `${title.trim() || `${KIND_LABEL[kind]}_${start}_${end}`}.md`)
              }
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              存 .md
            </button>
            <button
              onClick={printPdf}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              列印 / PDF
            </button>
          </div>
          <div data-color-mode="light">
            <MDEditor
              value={result}
              onChange={(v) => setResult(v ?? "")}
              height={420}
              preview="live"
              visibleDragbar={false}
            />
          </div>
        </>
      )}

      {/* 歷史報告清單 */}
      <div className="mt-8">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">已儲存的報告</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">尚無已儲存的報告。彙整後點「儲存到 DB」即可保存。</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {history.map((h) => (
              <li
                key={h.id}
                className={`flex items-center justify-between gap-2 px-3 py-2 ${
                  currentId === h.id ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <button onClick={() => loadSummary(h.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {h.title || `${KIND_LABEL[h.kind]} ${h.start_date} ~ ${h.end_date}`}
                  </div>
                  <div className="text-xs text-slate-400">
                    {KIND_LABEL[h.kind]}・{h.start_date} ~ {h.end_date}・更新於 {h.updated_at}
                  </div>
                </button>
                {confirmDel === h.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => removeSummary(h.id)}
                      className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                    >
                      確認刪除
                    </button>
                    <button
                      onClick={() => setConfirmDel(null)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDel(h.id)}
                    className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  >
                    刪除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
