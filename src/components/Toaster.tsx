import { useEffect, useState } from "react";
import { subscribeToast, type ToastMsg } from "../lib/toast";

/** 全域 toast 顯示層：右下角堆疊，成功 3.2 秒、錯誤 6.4 秒後自動消失，點擊可提前關閉 */
export default function Toaster() {
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);

  useEffect(
    () =>
      subscribeToast((m) => {
        setMsgs((prev) => [...prev, m]);
        const ttl = m.kind === "error" ? 6400 : 3200;
        window.setTimeout(() => setMsgs((prev) => prev.filter((x) => x.id !== m.id)), ttl);
      }),
    [],
  );

  if (msgs.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {msgs.map((m) => (
        <button
          key={m.id}
          onClick={() => setMsgs((prev) => prev.filter((x) => x.id !== m.id))}
          className={`pointer-events-auto rounded-md px-4 py-2 text-left text-sm text-white shadow-lg ${
            m.kind === "error" ? "bg-rose-600" : "bg-emerald-600"
          }`}
        >
          {m.text}
        </button>
      ))}
    </div>
  );
}
