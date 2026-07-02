/** 標題含任一關鍵字（不分大小寫）即視為「未完事項」段落 */
export const CARRYOVER_KEYWORDS = ["進行中", "明日", "明天", "待辦", "未完", "todo"];

/**
 * 從 Markdown 擷取「未完事項」段落（給「帶入昨日」用）。
 * 標題文字包含任一關鍵字即命中；段落範圍從該標題行起，
 * 到下一個層級 ≤ 命中標題層級的標題行為止（巢狀子標題一併帶入）。
 * 多個命中段落以空行串接、保留原順序；沒有任何命中回傳 null。
 */
export function extractCarryover(md: string, keywords = CARRYOVER_KEYWORDS): string | null {
  const lowered = keywords.map((k) => k.toLowerCase());
  const sections: string[] = [];
  let current: string[] | null = null; // 收集中的命中段落
  let level = 0; // 命中標題的層級，遇到 ≤ 此層級的標題就結束收集
  for (const line of md.split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current !== null && m[1].length <= level) {
        sections.push(current.join("\n").trimEnd());
        current = null;
      }
      if (current === null) {
        const title = m[2].toLowerCase();
        if (lowered.some((k) => title.includes(k))) {
          current = [line];
          level = m[1].length;
        }
        continue;
      }
    }
    if (current !== null) current.push(line);
  }
  if (current !== null) sections.push(current.join("\n").trimEnd());
  return sections.length ? sections.join("\n\n") : null;
}
