import { useEffect, useRef, useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import type { Report, Task } from "../types";
import { reportToEditableText, dedupeCommits } from "../lib/format";
import * as exporter from "../lib/export";
import * as ai from "../lib/ai";
import * as api from "../lib/api";
import { toast, toastError } from "../lib/toast";

interface Props {
  report: Report;
  saving: boolean;
  tags: string[];
  tasks: Task[];
  dark: boolean;
  onChange: (patch: Partial<Report>) => void;
  onTagsChange: (tags: string[]) => void;
  onDelete: (date: string) => Promise<void>;
}

export default function ReportEditor({ report, saving, tags, tasks, dark, onChange, onTagsChange, onDelete }: Props) {
  const [aiBusy, setAiBusy] = useState("");
  // App 以 key={report.date} 掛載本元件：切換日期會卸載重建。
  // AI 完成時若元件已卸載（使用者已切到別天），丟棄結果避免寫進另一天的日報。
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const applyIfCurrent = (fn: () => void) => {
    if (!alive.current) throw new Error("已切換到其他日期，結果未套用");
    fn();
  };

  // 舊資料相容：raw_notes 空但有 categories 時，把結構化內容轉成 Markdown 一次性遷移
  useEffect(() => {
    if (!report.raw_notes.trim() && report.categories.length > 0) {
      onChange({ raw_notes: reportToEditableText(report) });
    }
    // 僅在切換日報時觸發一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.date]);

  const run = (action: () => void | Promise<unknown>, okMsg: string) => async () => {
    try {
      await action();
      toast(okMsg);
    } catch (e) {
      toastError(`失敗：${e}`);
    }
  };

  const runAi = (label: string, action: () => Promise<void>) => async () => {
    setAiBusy(label);
    try {
      await action();
      toast(`AI 已完成：${label}`);
    } catch (e) {
      toastError(`AI 失敗：${e}`);
    } finally {
      setAiBusy("");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 標頭 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{report.date}</h2>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {saving ? "儲存中…" : report.updated_at ? `已儲存 ${report.updated_at}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={report.status === "final"}
              onChange={(e) => onChange({ status: e.target.checked ? "final" : "draft" })}
            />
            標記完成
          </label>
          <button
            onClick={async () => {
              const ok = await ask(`確定刪除 ${report.date} 的日報？此動作無法復原。`, {
                title: "刪除日報",
                kind: "warning",
              });
              if (!ok) return;
              try {
                await onDelete(report.date);
              } catch (e) {
                toastError(`刪除失敗：${e}`);
              }
            }}
            className="rounded-md border border-rose-300 px-3 py-1 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            刪除
          </button>
        </div>
      </div>

      {/* 工具列：AI + 輸出 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2 dark:border-slate-700 dark:bg-slate-800">
        <span className="text-xs text-slate-400 dark:text-slate-500">AI：</span>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("整理成正式報告", async () => {
            const notes = await ai.organizeReport(report, tasks);
            applyIfCurrent(() => onChange({ raw_notes: notes }));
          })}
        >
          整理成正式報告
        </ToolBtn>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("潤稿", async () => {
            if (!report.raw_notes.trim()) throw new Error("內容是空的，先寫點東西");
            const notes = await ai.polishReport(report);
            applyIfCurrent(() => onChange({ raw_notes: notes }));
          })}
        >
          潤稿
        </ToolBtn>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("產生標籤", async () => {
            const newTags = await ai.generateTags(report);
            applyIfCurrent(() => onTagsChange(newTags));
          })}
        >
          產生標籤
        </ToolBtn>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("從 Git 草擬", async () => {
            const commits = await api.gitCollectCommits(report.date);
            if (!commits) throw new Error("今天沒有符合的 commit");
            const existing = report.raw_notes.trimEnd();
            if (!existing) {
              applyIfCurrent(() => onChange({ raw_notes: commits }));
              return;
            }
            const fresh = dedupeCommits(existing, commits);
            if (!fresh) throw new Error("沒有新的 commit（都已加入）");
            applyIfCurrent(() => onChange({ raw_notes: `${existing}\n\n${fresh}` }));
          })}
        >
          從 Git 草擬
        </ToolBtn>

        <span className="ml-3 text-xs text-slate-400 dark:text-slate-500">輸出：</span>
        <ToolBtn onClick={run(() => exporter.copyPlainText(report), "已複製純文字")}>複製文字</ToolBtn>
        <ToolBtn onClick={run(() => exporter.copyMarkdown(report), "已複製 Markdown")}>複製 MD</ToolBtn>
        <ToolBtn onClick={run(() => exporter.exportMarkdown(report), "已匯出 Markdown")}>存 .md</ToolBtn>
        <ToolBtn onClick={run(() => exporter.exportDocx(report), "已匯出 Word")}>存 Word</ToolBtn>
        <ToolBtn onClick={run(() => exporter.exportPdf(report), "已開啟列印")}>列印 / PDF</ToolBtn>

        {aiBusy && <span className="ml-2 text-xs font-medium text-accent-600 dark:text-accent-400">AI 處理中：{aiBusy}…</span>}
      </div>

      {/* 標籤列 */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-6 py-2 dark:border-slate-700">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 內容區：Markdown 編輯器（工具列 + 並排即時預覽） */}
      <div className="flex-1 overflow-hidden px-6 py-4" data-color-mode={dark ? "dark" : "light"}>
        <MDEditor
          value={report.raw_notes}
          onChange={(v) => onChange({ raw_notes: v ?? "" })}
          height="100%"
          preview="live"
          visibleDragbar={false}
          textareaProps={{
            placeholder:
              "直接用 Markdown 寫今天做了什麼、遇到什麼問題、明天要做什麼…\n可自由使用標題、清單、表格等語法；右側即時預覽。",
          }}
        />
      </div>
    </div>
  );
}

function ToolBtn({
  onClick,
  children,
  accent,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2.5 py-1 text-xs disabled:opacity-50 ${
        accent
          ? "border-accent-300 bg-accent-50 text-accent-700 hover:bg-accent-100 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-300 dark:hover:bg-accent-900/50"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
