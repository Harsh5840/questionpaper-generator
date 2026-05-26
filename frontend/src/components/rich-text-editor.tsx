"use client";

import type React from "react";
import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Mathematics } from "@tiptap/extension-mathematics";
import "katex/dist/katex.min.css";
import {
  AlignCenter,
  AlignLeft,
  Bold,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Sigma,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
} from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onHtmlChange?: (value: string) => void;
  label: string;
  minHeight?: "compact" | "normal" | "answer";
  placeholder?: string;
}

export function RichTextEditor({
  value,
  onChange,
  onHtmlChange,
  label,
  minHeight = "normal",
  placeholder = "Write here...",
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      Mathematics,
      TextAlign.configure({
        types: ["paragraph"],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: textToHtml(value),
    editorProps: {
      attributes: {
        "aria-label": label,
        class: `rich-text-surface ${heightClass(minHeight)}`,
      },
    },
    onUpdate({ editor: activeEditor }) {
      onChange(activeEditor.getText({ blockSeparator: "\n" }).trim());
      onHtmlChange?.(activeEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;

    const currentText = editor.getText({ blockSeparator: "\n" }).trim();
    if (currentText !== value.trim()) {
      editor.commands.setContent(textToHtml(value), { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return (
      <div className="rounded-md border border-[var(--outline-variant)] bg-white px-3 py-2 text-sm font-semibold text-[var(--on-surface-variant)]">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="rich-text-shell rounded-md border border-[var(--outline-variant)] bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-1">
        <ToolbarButton
          active={editor.isActive("bold")}
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          label="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("superscript")}
          label="Superscript"
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        >
          <SuperscriptIcon size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("subscript")}
          label="Subscript"
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        >
          <SubscriptIcon size={15} />
        </ToolbarButton>
        <span className="mx-1 h-6 w-px bg-[var(--outline-variant)]" aria-hidden="true" />
        <ToolbarButton
          active={editor.isActive("bulletList")}
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={15} />
        </ToolbarButton>
        <span className="mx-1 h-6 w-px bg-[var(--outline-variant)]" aria-hidden="true" />
        <ToolbarButton
          active={editor.isActive({ textAlign: "left" })}
          label="Align left"
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "center" })}
          label="Align center"
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("paragraph")}
          label="Paragraph"
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          <Pilcrow size={15} />
        </ToolbarButton>
        <ToolbarButton
          label="Insert formula"
          onClick={() => editor.chain().focus().insertContent("$x^2 + bx + c = 0$").run()}
        >
          <Sigma size={15} />
        </ToolbarButton>
        <label className="inline-flex min-h-8 items-center gap-1 rounded border border-transparent px-1 text-xs font-semibold text-[var(--on-surface-variant)] hover:border-[var(--outline-variant)]">
          <span className="sr-only">Text color</span>
          <input
            aria-label="Text color"
            className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
            type="color"
            defaultValue="#141b2b"
            onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          />
        </label>
        <ToolbarButton
          active={editor.isActive("highlight")}
          label="Highlight"
          onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff2a8" }).run()}
        >
          <Highlighter size={15} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

interface ToolbarButtonProps {
  active?: boolean;
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ToolbarButton({ active = false, children, label, onClick }: ToolbarButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`focus-ring inline-flex min-h-8 min-w-8 items-center justify-center rounded border text-[var(--on-surface)] transition motion-reduce:transition-none ${
        active ? "border-[var(--primary)] bg-[var(--surface-container-high)]" : "border-transparent hover:border-[var(--outline-variant)] hover:bg-white"
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function textToHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>") || "<br>"}</p>`)
    .join("");
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function heightClass(height: RichTextEditorProps["minHeight"]) {
  if (height === "compact") return "min-h-12";
  if (height === "answer") return "min-h-16";
  return "min-h-24";
}
