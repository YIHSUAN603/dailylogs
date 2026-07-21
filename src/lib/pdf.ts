import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** 把 PDF 內容萃取成純文字（逐頁串接；掃描影像檔無文字層會回傳空字串） */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
      }
      pages.push(text.trim());
    }
    return pages.filter(Boolean).join("\n\n").trim();
  } finally {
    await doc.destroy();
  }
}
