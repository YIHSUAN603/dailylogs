import { useEffect, useRef, type ReactNode } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3, List, ListOrdered, Quote,
  AlignLeft, AlignCenter, AlignRight, Link as LinkIcon,
  Image as ImageIcon, Table as TableIcon, Eraser,
} from "lucide-react";

interface Props {
  value: string; // HTML
  onChange: (html: string) => void;
  dark: boolean;
  placeholder?: string;
}

export default function RichEditor({ value, onChange, placeholder }: Props) {
  // editorProps 的 paste/drop handler 在 useEditor 建立時就固定，用 ref 取最新 editor 實例
  const editorRef = useRef<Editor | null>(null);

  const insertImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      editorRef.current?.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
  };

  const handleFiles = (files: FileList | null | undefined, event: Event): boolean => {
    const imgs = files ? Array.from(files).filter((f) => f.type.startsWith("image/")) : [];
    if (!imgs.length) return false;
    event.preventDefault();
    imgs.forEach(insertImageFile);
    return true;
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image,
      TableKit.configure({ table: { resizable: true } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "prose dark:prose-invert max-w-none focus:outline-none min-h-full",
      },
      handlePaste: (_view, event) => handleFiles(event.clipboardData?.files, event),
      handleDrop: (_view, event) => handleFiles((event as DragEvent).dataTransfer?.files, event),
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  editorRef.current = editor;

  // 外部（AI / 帶入昨日 / 從 Git / 舊資料遷移）改動 value 時，同步進編輯器（避免打字迴圈）
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  const s = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            strike: editor.isActive("strike"),
            h1: editor.isActive("heading", { level: 1 }),
            h2: editor.isActive("heading", { level: 2 }),
            h3: editor.isActive("heading", { level: 3 }),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            quote: editor.isActive("blockquote"),
            left: editor.isActive({ textAlign: "left" }),
            center: editor.isActive({ textAlign: "center" }),
            right: editor.isActive({ textAlign: "right" }),
            link: editor.isActive("link"),
          }
        : null,
  });

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) insertImageFile(file);
    };
    input.click();
  };

  const setLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("連結網址（https://…）");
    if (url) editor.chain().focus().setLink({ href: url }).run();
  };

  if (!editor) return null;

  return (
    <div className="flex h-full flex-col rounded-md border border-slate-200 dark:border-slate-700">
      {/* 工具列 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
        <Btn active={s?.bold} title="粗體" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></Btn>
        <Btn active={s?.italic} title="斜體" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></Btn>
        <Btn active={s?.underline} title="底線" onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} /></Btn>
        <Btn active={s?.strike} title="刪除線" onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></Btn>
        <Sep />
        <Btn active={s?.h1} title="標題 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Btn>
        <Btn active={s?.h2} title="標題 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Btn>
        <Btn active={s?.h3} title="標題 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></Btn>
        <Sep />
        <Btn active={s?.bullet} title="項目清單" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Btn>
        <Btn active={s?.ordered} title="編號清單" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
        <Btn active={s?.quote} title="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></Btn>
        <Sep />
        <Btn active={s?.left} title="靠左" onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={16} /></Btn>
        <Btn active={s?.center} title="置中" onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={16} /></Btn>
        <Btn active={s?.right} title="靠右" onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={16} /></Btn>
        <Sep />
        <Btn active={s?.link} title="連結" onClick={setLink}><LinkIcon size={16} /></Btn>
        <Btn title="插入圖片" onClick={pickImage}><ImageIcon size={16} /></Btn>
        <Btn title="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} /></Btn>
        <Sep />
        <Btn title="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser size={16} /></Btn>
      </div>

      {/* 內容區 */}
      <EditorContent
        editor={editor}
        className="flex-1 overflow-y-auto px-4 py-3 [&_img]:max-w-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}

function Btn({
  onClick, children, active, title,
}: {
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 ${
        active ? "bg-slate-200 text-slate-900 dark:bg-slate-600 dark:text-white" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-600" />;
}
