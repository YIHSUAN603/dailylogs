import { useState, type ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import type { Report } from "../types";
import { reportToEditableText, reportToMarkdown } from "../lib/format";
import * as exporter from "../lib/export";
import * as ai from "../lib/ai";
import * as api from "../lib/api";

interface Props {
  report: Report;
  saving: boolean;
  tags: string[];
  onChange: (patch: Partial<Report>) => void;
  onTagsChange: (tags: string[]) => void;
  onDelete: (date: string) => Promise<void>;
}

export default function ReportEditor({ report, saving, tags, onChange, onTagsChange, onDelete }: Props) {
  const [toast, setToast] = useState("");
  const [aiBusy, setAiBusy] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  };

  const run = (action: () => void | Promise<unknown>, okMsg: string) => async () => {
    try {
      await action();
      flash(okMsg);
    } catch (e) {
      flash(`失敗：${e}`);
    }
  };

  const runAi = (label: string, action: () => Promise<void>) => async () => {
    setAiBusy(label);
    try {
      await action();
      flash(`AI 已完成：${label}`);
    } catch (e) {
      flash(`AI 失敗：${e}`);
    } finally {
      setAiBusy("");
    }
  };

  // 文字框內容：相容舊資料（raw_notes 空但有 categories）做懶遷移
  const editText = report.raw_notes.trim() ? report.raw_notes : reportToEditableText(report);

  return (
    <div className="flex h-full flex-col">
      {/* 標頭 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-800">{report.date}</h2>
          <span className="text-xs text-slate-400">
            {saving ? "儲存中…" : report.updated_at ? `已儲存 ${report.updated_at}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={report.status === "final"}
              onChange={(e) => onChange({ status: e.target.checked ? "final" : "draft" })}
            />
            標記完成
          </label>
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            {showPreview ? "編輯" : "預覽"}
          </button>
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
                flash(`刪除失敗：${e}`);
              }
            }}
            className="rounded-md border border-rose-300 px-3 py-1 text-sm text-rose-600 hover:bg-rose-50"
          >
            刪除
          </button>
        </div>
      </div>

      {/* 工具列：AI + 輸出 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2">
        <span className="text-xs text-slate-400">AI：</span>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("整理成正式報告", async () => {
            if (!report.raw_notes.trim()) throw new Error("內容是空的，先寫點東西");
            const categories = await ai.organizeReport(report);
            onChange({ categories, raw_notes: reportToEditableText({ ...report, categories }) });
          })}
        >
          整理成正式報告
        </ToolBtn>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("潤稿", async () => {
            const categories = await ai.polishReport(report);
            onChange({ categories, raw_notes: reportToEditableText({ ...report, categories }) });
          })}
        >
          潤稿
        </ToolBtn>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("產生標籤", async () => onTagsChange(await ai.generateTags(report)))}
        >
          產生標籤
        </ToolBtn>
        <ToolBtn
          accent
          disabled={!!aiBusy}
          onClick={runAi("從 Git 草擬", async () => {
            const commits = await api.gitCollectCommits(report.date);
            if (!commits) throw new Error("今天沒有符合的 commit");
            onChange({ raw_notes: commits });
          })}
        >
          從 Git 草擬
        </ToolBtn>

        <span className="ml-3 text-xs text-slate-400">輸出：</span>
        <ToolBtn onClick={run(() => exporter.copyPlainText(report), "已複製純文字")}>複製文字</ToolBtn>
        <ToolBtn onClick={run(() => exporter.copyMarkdown(report), "已複製 Markdown")}>複製 MD</ToolBtn>
        <ToolBtn onClick={run(() => exporter.exportMarkdown(report), "已匯出 Markdown")}>存 .md</ToolBtn>
        <ToolBtn onClick={run(() => exporter.exportDocx(report), "已匯出 Word")}>存 Word</ToolBtn>
        <ToolBtn onClick={run(() => exporter.exportPdf(report), "已開啟列印")}>列印 / PDF</ToolBtn>

        {aiBusy && <span className="ml-2 text-xs font-medium text-sky-600">AI 處理中：{aiBusy}…</span>}
        {toast && <span className="ml-2 text-xs font-medium text-emerald-600">{toast}</span>}
      </div>

      {/* 標籤列 */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-6 py-2">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* 內容區 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {showPreview ? (
          <article className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-base">
            <ReactMarkdown>{reportToMarkdown(report)}</ReactMarkdown>
          </article>
        ) : (
          <textarea
            value={editText}
            placeholder="直接寫今天做了什麼、遇到什麼問題、明天要做什麼…
再按上方『整理成正式報告』，即可整理成 # 專案 / ## 子分類 / ### 面向 / - 條列 格式並繼續編輯。"
            onChange={(e) =>
              onChange({ raw_notes: e.target.value, categories: ai.parseCategories(e.target.value) })
            }
            className="h-full w-full resize-none rounded-md border border-slate-200 px-4 py-3 text-sm leading-relaxed text-slate-800 outline-none focus:border-sky-400"
          />
        )}
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
          ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
