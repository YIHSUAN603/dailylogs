/** 標題含任一關鍵字（不分大小寫）即視為「未完事項」段落 */
export const CARRYOVER_KEYWORDS = ["進行中", "明日", "明天", "待辦", "未完", "todo"];

/**
 * 從 HTML 擷取「未完事項」段落（給「帶入昨日」用）。
 * 走訪 body 頂層節點（TipTap 輸出為扁平結構），標題（h1–h6）文字含任一關鍵字即命中；
 * 段落範圍從該標題起，到下一個層級 ≤ 命中標題層級的標題為止（巢狀子標題一併帶入）。
 * 多個命中段落以原順序串接的 HTML 回傳；沒有任何命中回傳 null。
 */
export function extractCarryover(html: string, keywords = CARRYOVER_KEYWORDS): string | null {
  const lowered = keywords.map((k) => k.toLowerCase());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const isHeading = (el: Element) => /^H[1-6]$/.test(el.tagName);
  const level = (el: Element) => Number(el.tagName[1]);

  const sections: string[] = [];
  let current: string[] | null = null; // 收集中的命中段落（outerHTML）
  let curLevel = 0; // 命中標題層級，遇到 ≤ 此層級的標題就結束收集
  for (const el of Array.from(doc.body.children)) {
    if (isHeading(el)) {
      if (current !== null && level(el) <= curLevel) {
        sections.push(current.join(""));
        current = null;
      }
      if (current === null) {
        const title = (el.textContent ?? "").toLowerCase();
        if (lowered.some((k) => title.includes(k))) {
          current = [el.outerHTML];
          curLevel = level(el);
        }
        continue;
      }
    }
    if (current !== null) current.push(el.outerHTML);
  }
  if (current !== null) sections.push(current.join(""));
  return sections.length ? sections.join("") : null;
}
