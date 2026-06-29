interface Props {
  value: string;
  onChange: (v: string) => void;
  projects: string[];
  placeholder?: string;
  /** 文字輸入框的 className（讓各處沿用既有外觀） */
  inputClassName: string;
}

/**
 * 專案欄位：可自由輸入 + 旁邊一個原生 <select> 從既有/匯入專案挑選。
 * 用 <select> 而非 <datalist>，因 WebKitGTK 不支援 datalist 下拉（同 DatePicker 自繪的原因）。
 */
export default function ProjectInput({ value, onChange, projects, placeholder, inputClassName }: Props) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "（可空）"}
        className={inputClassName}
      />
      {projects.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
          aria-label="選擇專案"
          className="rounded-md border border-slate-300 bg-white px-1 py-1 text-sm text-slate-500 outline-none focus:border-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
        >
          <option value="">選擇…</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
