import { useRef } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

/** 圖片節點的縮放檢視：選取後右下角出現把手，拖曳自由縮放（等比） */
function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const width = node.attrs.width as number | null;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const img = imgRef.current;
    if (!img) return;
    const startX = e.clientX;
    const startWidth = img.offsetWidth;
    // 夾限上界：編輯區可用寬度
    const maxWidth = (img.parentElement?.parentElement?.clientWidth ?? startWidth) || startWidth;

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(40, Math.min(maxWidth, startWidth + (ev.clientX - startX)));
      // 拖曳期間直接改 style 即時預覽，不發 transaction
      img.style.width = `${Math.round(next)}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // 放開才寫回節點屬性（存進 raw_notes）
      updateAttributes({ width: img.offsetWidth });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <NodeViewWrapper
      className="relative inline-block leading-none"
      style={{ width: width ? `${width}px` : undefined }}
      data-drag-handle
    >
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ""}
        title={node.attrs.title ?? undefined}
        style={{ width: width ? `${width}px` : undefined, height: "auto", display: "block", maxWidth: "100%" }}
        className={selected ? "outline outline-2 outline-accent-500" : ""}
      />
      {selected && (
        <span
          onPointerDown={startResize}
          className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-accent-500"
          title="拖曳縮放"
        />
      )}
    </NodeViewWrapper>
  );
}

/** 可縮放圖片：擴充預設 Image，新增 width 屬性（以 inline style 輸出，貼進 Google Docs 會沿用尺寸） */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const styleW = parseInt(el.style.width);
          if (!Number.isNaN(styleW)) return styleW;
          const attrW = parseInt(el.getAttribute("width") ?? "");
          return Number.isNaN(attrW) ? null : attrW;
        },
        renderHTML: (attrs) =>
          attrs.width ? { style: `width: ${attrs.width}px; height: auto` } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
