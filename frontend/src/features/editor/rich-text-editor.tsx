import type React from "react";
import { useEffect, useMemo, useState } from "react";
import s from "./rich-text-editor.module.css";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Underline from "@tiptap/extension-underline";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import katex from "katex";
import "katex/dist/katex.min.css";
import { cleanCorruptMathArtifacts, escapeAttribute, escapeHtml, hasCorruptMathMarkup, unescapeHtml } from "@/lib/paper-utils";
import {
  AlignCenter,
  AlignLeft,
  Bold,
  ChevronDown,
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
  htmlValue?: string;
  onChange: (value: string) => void;
  onHtmlChange?: (value: string) => void;
  label: string;
  minHeight?: "compact" | "normal" | "answer";
  placeholder?: string;
  onFocus?: () => void;
  toolbarMode?: "always" | "focus";
}

let activeRichTextEditor: Editor | null = null;
const richTextEditors = new Map<string, Editor>();

export type MathToolkitInsert =
  | { type: "text"; value: string }
  | { type: "html"; value: string }
  | { type: "math"; value: string };

export function insertIntoActiveRichTextEditor(insert: MathToolkitInsert) {
  if (!activeRichTextEditor) return false;
  const chain = activeRichTextEditor.chain().focus();

  if (insert.type === "math") {
    const htmlBefore = activeRichTextEditor.getHTML();
    const inserted = chain.insertInlineMath({ latex: insert.value }).run();
    const htmlAfter = activeRichTextEditor.getHTML();

    if (inserted && htmlAfter !== htmlBefore) return true;

    return activeRichTextEditor.chain().focus().insertContent({ type: "inlineMath", attrs: { latex: insert.value } }).run();
  }

  chain.insertContent(insert.value).run();
  return true;
}

export function activateRichTextEditorFromElement(element: Element | null) {
  const editorId = element?.closest<HTMLElement>(".rich-text-surface")?.dataset.qpgEditorId;
  const editor = editorId ? richTextEditors.get(editorId) : null;
  if (!editor) return false;

  activeRichTextEditor = editor;
  return true;
}

export function commandActiveRichTextEditor(fn: (editor: Editor) => void) {
  if (!activeRichTextEditor) return false;
  fn(activeRichTextEditor);
  return true;
}

export function openMathLiveEditorForActiveRichTextEditor(initialLatex = "") {
  return insertIntoActiveRichTextEditor({ type: "math", value: initialLatex });
}

type MathLiveFieldElement = HTMLElement & {
  value: string;
  selection?: { ranges: [number, number][]; direction?: "forward" | "backward" | "none" };
  smartFence?: boolean;
  smartMode?: boolean;
  inlineShortcutTimeout?: number;
  mathModeSpace?: string;
  menuItems?: unknown[];
  executeCommand?: (command: string | [string, ...unknown[]]) => boolean;
};

const LiveInlineMath = InlineMath.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement("span");
      let mathField: MathLiveFieldElement | null = null;
      let currentLatex = String(node.attrs.latex || "");
      let isDestroyed = false;
      let hasPlacedInitialCaret = false;

      wrapper.className = "qpg-inline-math-live";
      wrapper.dataset.type = "inline-math";
      wrapper.setAttribute("data-latex", currentLatex);
      wrapper.contentEditable = "false";
      wrapper.setAttribute("tabindex", "-1");

      // Show KaTeX fallback while MathLive is loading
      try {
        const fallback = document.createElement("span");
        fallback.className = "qpg-math-katex-fallback";
        katex.render(currentLatex, fallback, { throwOnError: false, strict: false, displayMode: false });
        wrapper.appendChild(fallback);
      } catch {
        // ignore — MathLive will replace
      }

      const commitLatex = (latex: string) => {
        currentLatex = latex;
        wrapper.setAttribute("data-latex", latex);

        const pos = getPos();
        if (typeof pos !== "number") return;

        const currentNode = editor.state.doc.nodeAt(pos);
        if (!currentNode || currentNode.type.name !== "inlineMath" || currentNode.attrs.latex === latex) return;

        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, latex }));
      };

      const focusEditorContext = () => {
        activeRichTextEditor = editor;
        window.dispatchEvent(new CustomEvent("qpg:rich-text-focus", { detail: { label: "Math formula" } }));
      };

      const focusMathField = () => {
        focusEditorContext();
        if (!mathField || hasPlacedInitialCaret) return;

        hasPlacedInitialCaret = true;
        requestAnimationFrame(() => {
          if (!mathField || !document.contains(mathField)) return;
          mathField.focus();
          placeCaretAtFormulaEnd(mathField);
        });
      };

      const mountMathLive = async () => {
        await import("mathlive");
        if (isDestroyed) return;

        // Remove the KaTeX fallback now that MathLive is ready
        wrapper.querySelector(".qpg-math-katex-fallback")?.remove();

        mathField = document.createElement("math-field") as MathLiveFieldElement;
        mathField.value = currentLatex;
        mathField.setAttribute("default-mode", "inline-math");
        mathField.setAttribute("math-virtual-keyboard-policy", "manual");
        mathField.setAttribute("math-mode-space", "\\ ");
        mathField.setAttribute("smart-fence", "true");
        mathField.setAttribute("smart-mode", "true");
        mathField.smartFence = true;
        mathField.smartMode = true;
        mathField.inlineShortcutTimeout = 0;
        mathField.mathModeSpace = "\\ ";

        mathField.addEventListener("input", handleInput);
        mathField.addEventListener("focus", focusMathField);
        mathField.addEventListener("pointerdown", focusMathField);
        mathField.addEventListener("mousedown", focusMathField);
        mathField.addEventListener("click", focusMathField);
        mathField.addEventListener("contextmenu", handleMathContextMenu);
        mathFieldEventsToOwn.forEach((eventName) => mathField?.addEventListener(eventName, stopProseMirrorEvent));
        wrapper.appendChild(mathField);

        // Disable MathLive's built-in (dark) context menu so only our single
        // light menu shows on right-click — and drop its cut/copy/paste items.
        // This MUST run after the field is connected to the DOM, otherwise the
        // setter throws "Mathfield not mounted".
        try {
          mathField.menuItems = [];
        } catch {
          // older/newer MathLive without a menuItems setter — safe to ignore
        }
      };

      // Only focus math-field when clicking directly on the math-field itself.
      // Clicks on the outer wrapper (padding area) must reach ProseMirror so it can
      // place its cursor adjacent to the node — that's what lets users type text
      // next to a formula-only paragraph.
      const handleWrapperPointerDown = (e: Event) => {
        const target = e.target as Element | null;
        if (mathField && (target === mathField || mathField.contains(target as Node))) {
          focusMathField();
        } else {
          focusEditorContext();
        }
      };
      wrapper.addEventListener("pointerdown", handleWrapperPointerDown);
      wrapper.addEventListener("mousedown", handleWrapperPointerDown);
      void mountMathLive();

      return {
        dom: wrapper,
        update(nextNode) {
          if (nextNode.type.name !== "inlineMath") return false;

          currentLatex = String(nextNode.attrs.latex || "");
          wrapper.setAttribute("data-latex", currentLatex);
          if (mathField) {
            if (document.activeElement !== mathField && mathField.value !== currentLatex) {
              mathField.value = currentLatex;
            }
          } else {
            // MathLive not mounted yet — refresh the KaTeX fallback
            const fallback = wrapper.querySelector(".qpg-math-katex-fallback");
            if (fallback) {
              try {
                katex.render(currentLatex, fallback as HTMLElement, { throwOnError: false, strict: false, displayMode: false });
              } catch {
                // ignore
              }
            }
          }

          return true;
        },
        stopEvent(event) {
          if (!(event.target instanceof globalThis.Node)) return false;
          // Only stop events that target the math-field itself (or its internals).
          // Events on the outer wrapper must reach ProseMirror so it can position
          // its cursor adjacent to the node — this is what allows typing text
          // next to a formula-only paragraph.
          if (!mathField) return false;
          return mathField === event.target || mathField.contains(event.target);
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          isDestroyed = true;
          mathField?.removeEventListener("input", handleInput);
          mathField?.removeEventListener("focus", focusMathField);
          mathField?.removeEventListener("pointerdown", focusMathField);
          mathField?.removeEventListener("mousedown", focusMathField);
          mathField?.removeEventListener("click", focusMathField);
          mathField?.removeEventListener("contextmenu", handleMathContextMenu);
          mathFieldEventsToOwn.forEach((eventName) => mathField?.removeEventListener(eventName, stopProseMirrorEvent));
          mathField?.remove();
        },
      };

      function handleInput(event: Event) {
        event.stopPropagation();
        commitLatex(mathField?.value ?? "");
      }

      function handleMathContextMenu(event: Event) {
        event.preventDefault();
        event.stopPropagation();
        const mouseEvent = event as MouseEvent;
        wrapper.dispatchEvent(new CustomEvent("qpg:math-contextmenu", {
          bubbles: true,
          detail: { x: mouseEvent.clientX, y: mouseEvent.clientY, latex: mathField?.value ?? "" },
        }));
      }

      function stopProseMirrorEvent(event: Event) {
        event.stopPropagation();
      }
    };
  },
});

const mathFieldEventsToOwn = [
  "beforeinput",
  "keydown",
  "keyup",
  "keypress",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "selection-change",
] as const;

function placeCaretAtFormulaEnd(mathField: MathLiveFieldElement) {
  try {
    mathField.selection = { ranges: [[-1, -1]], direction: "none" };
    return;
  } catch {
    // Fall through to command selectors below. MathLive versions differ slightly
    // in the public selection surface, but command selectors are stable.
  }

  if (mathField.executeCommand?.("moveToMathfieldEnd")) return;
  mathField.executeCommand?.("move-to-mathfield-end");
}

// ── LaTeX paste interception ──────────────────────────────────────────────────

type PasteSegment = { type: "text" | "math"; value: string };

// Matches raw LaTeX commands with no surrounding delimiters (e.g. \frac{a}{b})
const RAW_LATEX_RE =
  /^\\(?:f?rac|dfrac|tfrac|sqrt|int|iint|iiint|oint|sum|prod|lim|log|ln|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|alpha|beta|gamma|delta|epsilon|varepsilon|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|infty|cdot|cdots|ldots|times|div|pm|mp|leq|geq|neq|approx|equiv|sim|propto|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow|partial|nabla|forall|exists|vec|hat|bar|tilde|dot|ddot|mathbb|mathbf|mathcal|mathrm|mathit|text|overline|underline|overbrace|underbrace|binom|begin|left|right|Big|bigg|Bigg|pmatrix|bmatrix|vmatrix|cases)\b/;

function parseLaTeXPaste(text: string): PasteSegment[] {
  const segments: PasteSegment[] = [];
  // Match $$...$$, $...$, \[...\], \(...\)
  const DELIM = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DELIM.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    // Strip outer delimiters: $$, $, \[...\], \(...\) are all 2-char pairs
    const latex = (raw.startsWith("$$") ? raw.slice(2, -2) : raw.startsWith("$") ? raw.slice(1, -1) : raw.slice(2, -2)).trim();
    if (latex) segments.push({ type: "math", value: latex });
    lastIndex = match.index + raw.length;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    // Whole paste (no delimiters found) that looks like a raw LaTeX expression
    if (segments.length === 0 && RAW_LATEX_RE.test(tail.trim())) {
      segments.push({ type: "math", value: tail.trim() });
    } else {
      segments.push({ type: "text", value: tail });
    }
  }

  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────

export function RichTextEditor({
  value,
  htmlValue,
  onChange,
  onHtmlChange,
  label,
  minHeight = "normal",
  placeholder = "Write here...",
  onFocus,
  toolbarMode = "focus",
}: RichTextEditorProps) {
  const editorId = useMemo(() => crypto.randomUUID(), []);
  const [activeFormulaId, setActiveFormulaId] = useState<string | null>(null);
  const [formulaValues, setFormulaValues] = useState<Record<string, string>>({});
  const activeFormula = useMemo(
    () => formulaSnippets.flatMap((group) => group.items).find((item) => item.id === activeFormulaId),
    [activeFormulaId],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        underline: false,
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      Underline,
      BlockMath,
      LiveInlineMath,
      TextAlign.configure({
        types: ["paragraph"],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: editorContent(value, htmlValue),
    editorProps: {
      attributes: {
        "aria-label": label,
        class: `rich-text-surface ${heightClass(minHeight)}`,
        "data-qpg-editor-id": editorId,
        spellcheck: "false",
      },
    },
    onUpdate({ editor: activeEditor }) {
      onChange(documentToPlainText(activeEditor.getJSON()).trim());
      onHtmlChange?.(activeEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;

    richTextEditors.set(editorId, editor);
    return () => {
      richTextEditors.delete(editorId);
      if (activeRichTextEditor === editor) activeRichTextEditor = null;
    };
  }, [editor, editorId]);

  useEffect(() => {
    if (!editor) return;

    const nextContent = editorContent(value, htmlValue);

    const mathFieldFocused =
      document.activeElement?.tagName?.toLowerCase() === "math-field" ||
      document.activeElement?.closest?.(".qpg-inline-math-live") !== null;
    if (!editor.isFocused && !mathFieldFocused && editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [editor, htmlValue, value]);

  // Intercept paste in capture phase so we run before ProseMirror's own handler.
  // If the clipboard text contains LaTeX delimiters or looks like a raw LaTeX
  // expression, prevent the default paste and insert math nodes instead.
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;

    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;

      const segments = parseLaTeXPaste(text);
      if (!segments.some((s) => s.type === "math")) return;

      e.preventDefault();
      e.stopPropagation();

      editor.commands.focus();
      for (const seg of segments) {
        if (seg.type === "math") {
          editor.chain().insertInlineMath({ latex: seg.value }).run();
        } else if (seg.value) {
          editor.chain().insertContent(seg.value).run();
        }
      }
    };

    el.addEventListener("paste", onPaste, true);
    return () => el.removeEventListener("paste", onPaste, true);
  }, [editor]);

  if (!editor) {
    return (
      <div className={s.loadingShell}>
        Loading editor...
      </div>
    );
  }

  const activateEditor = () => {
    activeRichTextEditor = editor;
    onFocus?.();
    window.dispatchEvent(new CustomEvent("qpg:rich-text-focus", { detail: { label } }));
  };

  const openLocalMathLive = () => {
    activateEditor();
    insertIntoActiveRichTextEditor({ type: "math", value: selectedLatex(editor) });
  };

  const activateEditorFromClick = () => {
    activateEditor();
  };

  return (
    <div
      className={`rich-text-shell ${toolbarMode === "focus" ? "toolbar-focus-only" : ""}`}
    >
      <div className={s.toolbar}>
        {activeFormula ? (
          <FormulaBuilder
            formula={activeFormula}
            values={formulaValues}
            onCancel={() => {
              setActiveFormulaId(null);
              setFormulaValues({});
            }}
            onChange={(key, value) => setFormulaValues((current) => ({ ...current, [key]: value }))}
            onInsert={() => {
              editor.chain().focus().insertInlineMath({ latex: activeFormula.build(formulaValues) }).run();
              setActiveFormulaId(null);
              setFormulaValues({});
            }}
          />
        ) : toolbarMode === "focus" ? (
          /* Compact toolbar for MCQ option editing — Bold, Italic, Highlight only */
          <>
            <ToolbarButton active={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold size={15} />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic size={15} />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive("highlight")} label="Highlight" onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff2a8" }).run()}>
              <Highlighter size={15} />
            </ToolbarButton>
          </>
        ) : (
          <>
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
            <span className={s.toolbarSep} aria-hidden="true" />
            <ToolbarButton label="Insert live MathLive formula" onClick={openLocalMathLive}>
              <Sigma size={15} />
              <span className={s.liveLabel}>Live</span>
            </ToolbarButton>
            <span className={s.toolbarSep} aria-hidden="true" />
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
            <span className={s.toolbarSep} aria-hidden="true" />
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
            <span className={s.toolbarSep} aria-hidden="true" />
            <label className={s.colorLabel}>
              <span className={s.srOnly}>Text color</span>
              <input
                aria-label="Text color"
                className={s.colorInput}
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
          </>
        )}
        {!activeFormula && toolbarMode !== "focus" && (
          <>
            <span className={s.toolbarSep} aria-hidden="true" />
            <label className={`math-snippet-select ${s.mathSelect}`}>
              <Sigma size={14} />
              <span>Math &amp; Science</span>
              <select
                aria-label="Insert math or science notation"
                className={s.mathSelectInner}
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) {
                    setActiveFormulaId(value);
                    const formula = formulaSnippets.flatMap((group) => group.items).find((item) => item.id === value);
                    setFormulaValues(formula ? Object.fromEntries(formula.fields.map((field) => [field.key, field.defaultValue])) : {});
                  }
                  event.currentTarget.value = "";
                }}
              >
                <option value="">Insert formula…</option>
                {formulaSnippets.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <ToolbarButton label="Insert quick symbol ±" onClick={() => editor.chain().focus().insertContent("±").run()}>
              <span className={s.plusMinusLabel}>±</span>
            </ToolbarButton>
          </>
        )}
      </div>
      <EditorContent
        editor={editor}
        onClick={activateEditorFromClick}
        onContextMenu={activateEditor}
        onFocus={activateEditor}
        onMouseDown={activateEditor}
      />
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
      className={`focus-ring ${s.toolbarButton} ${active ? s.toolbarButtonActive : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

interface FormulaField {
  key: string;
  label: string;
  defaultValue: string;
}

interface FormulaSnippet {
  id: string;
  label: string;
  fields: FormulaField[];
  build: (values: Record<string, string>) => string;
}

interface FormulaBuilderProps {
  formula: FormulaSnippet;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onCancel: () => void;
  onInsert: () => void;
}

function FormulaBuilder({ formula, values, onChange, onCancel, onInsert }: FormulaBuilderProps) {
  const preview = formula.build(values);

  return (
    <div className={s.formulaBuilder}>
      <span className={s.formulaTitle}>
        <Sigma size={14} />
        {formula.label}
      </span>
      <div className={s.formulaFields}>
        {formula.fields.map((field) => (
          <label key={field.key} className={s.formulaFieldLabel}>
            <span>{field.label}</span>
            <input
              aria-label={`${formula.label} ${field.label}`}
              className={s.formulaFieldInput}
              value={values[field.key] ?? field.defaultValue}
              onChange={(event) => onChange(field.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onInsert();
                if (event.key === "Escape") onCancel();
              }}
            />
          </label>
        ))}
        <code className={s.formulaPreview}>
          Preview: {preview}
        </code>
      </div>
      <button className={s.formulaInsertBtn} onClick={onInsert} type="button">
        Insert formula
      </button>
      <button className={s.formulaCancelBtn} onClick={onCancel} type="button">
        Cancel
      </button>
    </div>
  );
}

function selectedLatex(editor: Editor) {
  const { from, to } = editor.state.selection;
  if (from === to) return "";

  return editor.state.doc.textBetween(from, to, " ").replace(/^\$+|\$+$/g, "").trim();
}

const getValue = (values: Record<string, string>, key: string, fallback: string) => values[key]?.trim() || fallback;

const formulaSnippets: { label: string; items: FormulaSnippet[] }[] = [
  {
    label: "Algebra",
    items: [
      {
        id: "quadratic",
        label: "Quadratic",
        fields: [
          { key: "a", label: "a", defaultValue: "a" },
          { key: "b", label: "b", defaultValue: "b" },
          { key: "c", label: "c", defaultValue: "c" },
          { key: "x", label: "var", defaultValue: "x" },
          { key: "rhs", label: "rhs", defaultValue: "0" },
        ],
        build: (values) => `${getValue(values, "a", "a")}${getValue(values, "x", "x")}^2 + ${getValue(values, "b", "b")}${getValue(values, "x", "x")} + ${getValue(values, "c", "c")} = ${getValue(values, "rhs", "0")}`,
      },
      {
        id: "quadratic-formula",
        label: "Formula",
        fields: [
          { key: "a", label: "a", defaultValue: "a" },
          { key: "b", label: "b", defaultValue: "b" },
          { key: "c", label: "c", defaultValue: "c" },
          { key: "x", label: "var", defaultValue: "x" },
        ],
        build: (values) => `${getValue(values, "x", "x")} = \\frac{-${getValue(values, "b", "b")} \\pm \\sqrt{${getValue(values, "b", "b")}^2 - 4${getValue(values, "a", "a")}${getValue(values, "c", "c")}}}{2${getValue(values, "a", "a")}}`,
      },
      {
        id: "linear-pair",
        label: "Linear pair",
        fields: [
          { key: "a1", label: "a1", defaultValue: "a_1" },
          { key: "b1", label: "b1", defaultValue: "b_1" },
          { key: "c1", label: "c1", defaultValue: "c_1" },
          { key: "a2", label: "a2", defaultValue: "a_2" },
          { key: "b2", label: "b2", defaultValue: "b_2" },
          { key: "c2", label: "c2", defaultValue: "c_2" },
        ],
        build: (values) => `${getValue(values, "a1", "a_1")}x + ${getValue(values, "b1", "b_1")}y + ${getValue(values, "c1", "c_1")} = 0,\\ ${getValue(values, "a2", "a_2")}x + ${getValue(values, "b2", "b_2")}y + ${getValue(values, "c2", "c_2")} = 0`,
      },
      {
        id: "ap-nth",
        label: "AP nth term",
        fields: [
          { key: "an", label: "term", defaultValue: "a_n" },
          { key: "a", label: "a", defaultValue: "a" },
          { key: "n", label: "n", defaultValue: "n" },
          { key: "d", label: "d", defaultValue: "d" },
        ],
        build: (values) => `${getValue(values, "an", "a_n")} = ${getValue(values, "a", "a")} + (${getValue(values, "n", "n")} - 1)${getValue(values, "d", "d")}`,
      },
      {
        id: "ap-sum",
        label: "AP sum",
        fields: [
          { key: "sn", label: "sum", defaultValue: "S_n" },
          { key: "n", label: "n", defaultValue: "n" },
          { key: "a", label: "a", defaultValue: "a" },
          { key: "d", label: "d", defaultValue: "d" },
        ],
        build: (values) => `${getValue(values, "sn", "S_n")} = \\frac{${getValue(values, "n", "n")}}{2}[2${getValue(values, "a", "a")} + (${getValue(values, "n", "n")} - 1)${getValue(values, "d", "d")}]`,
      },
      {
        id: "ratio-condition",
        label: "Linear ratio",
        fields: [
          { key: "a1", label: "a1", defaultValue: "a_1" },
          { key: "a2", label: "a2", defaultValue: "a_2" },
          { key: "b1", label: "b1", defaultValue: "b_1" },
          { key: "b2", label: "b2", defaultValue: "b_2" },
          { key: "c1", label: "c1", defaultValue: "c_1" },
          { key: "c2", label: "c2", defaultValue: "c_2" },
        ],
        build: (values) => `\\frac{${getValue(values, "a1", "a_1")}}{${getValue(values, "a2", "a_2")}} = \\frac{${getValue(values, "b1", "b_1")}}{${getValue(values, "b2", "b_2")}} \\ne \\frac{${getValue(values, "c1", "c_1")}}{${getValue(values, "c2", "c_2")}}`,
      },
    ],
  },
  {
    label: "Trigonometry",
    items: [
      {
        id: "trig-identity",
        label: "Identity",
        fields: [
          { key: "theta", label: "angle", defaultValue: "\\theta" },
        ],
        build: (values) => `\\sin^2 ${getValue(values, "theta", "\\theta")} + \\cos^2 ${getValue(values, "theta", "\\theta")} = 1`,
      },
      {
        id: "tan-ratio",
        label: "Tan ratio",
        fields: [
          { key: "theta", label: "angle", defaultValue: "\\theta" },
          { key: "perp", label: "perp", defaultValue: "P" },
          { key: "base", label: "base", defaultValue: "B" },
        ],
        build: (values) => `\\tan ${getValue(values, "theta", "\\theta")} = \\frac{${getValue(values, "perp", "P")}}{${getValue(values, "base", "B")}}`,
      },
    ],
  },
  {
    label: "Geometry",
    items: [
      {
        id: "similarity",
        label: "Similarity",
        fields: [
          { key: "tri1", label: "tri 1", defaultValue: "ABC" },
          { key: "tri2", label: "tri 2", defaultValue: "PQR" },
        ],
        build: (values) => `\\triangle ${getValue(values, "tri1", "ABC")} \\sim \\triangle ${getValue(values, "tri2", "PQR")}`,
      },
      {
        id: "pythagoras",
        label: "Pythagoras",
        fields: [
          { key: "a", label: "side 1", defaultValue: "AB" },
          { key: "b", label: "side 2", defaultValue: "BC" },
          { key: "c", label: "hyp", defaultValue: "AC" },
        ],
        build: (values) => `${getValue(values, "a", "AB")}^2 + ${getValue(values, "b", "BC")}^2 = ${getValue(values, "c", "AC")}^2`,
      },
      {
        id: "circle-area",
        label: "Circle area",
        fields: [
          { key: "area", label: "area", defaultValue: "A" },
          { key: "r", label: "r", defaultValue: "r" },
        ],
        build: (values) => `${getValue(values, "area", "A")} = \\pi ${getValue(values, "r", "r")}^2`,
      },
      {
        id: "sector-area",
        label: "Sector area",
        fields: [
          { key: "theta", label: "theta", defaultValue: "\\theta" },
          { key: "r", label: "r", defaultValue: "r" },
        ],
        build: (values) => `\\frac{${getValue(values, "theta", "\\theta")}}{360^\\circ}\\pi ${getValue(values, "r", "r")}^2`,
      },
      {
        id: "cylinder-volume",
        label: "Cylinder volume",
        fields: [
          { key: "volume", label: "vol", defaultValue: "V" },
          { key: "r", label: "r", defaultValue: "r" },
          { key: "h", label: "h", defaultValue: "h" },
        ],
        build: (values) => `${getValue(values, "volume", "V")} = \\pi ${getValue(values, "r", "r")}^2${getValue(values, "h", "h")}`,
      },
      {
        id: "cone-volume",
        label: "Cone volume",
        fields: [
          { key: "volume", label: "vol", defaultValue: "V" },
          { key: "r", label: "r", defaultValue: "r" },
          { key: "h", label: "h", defaultValue: "h" },
        ],
        build: (values) => `${getValue(values, "volume", "V")} = \\frac{1}{3}\\pi ${getValue(values, "r", "r")}^2${getValue(values, "h", "h")}`,
      },
    ],
  },
  {
    label: "Stats",
    items: [
      {
        id: "mean",
        label: "Mean",
        fields: [
          { key: "x", label: "mean", defaultValue: "\\bar{x}" },
          { key: "f", label: "freq", defaultValue: "f_i" },
          { key: "xi", label: "value", defaultValue: "x_i" },
        ],
        build: (values) => `${getValue(values, "x", "\\bar{x}")} = \\frac{\\sum ${getValue(values, "f", "f_i")} ${getValue(values, "xi", "x_i")}}{\\sum ${getValue(values, "f", "f_i")}}`,
      },
      {
        id: "probability",
        label: "Probability",
        fields: [
          { key: "event", label: "event", defaultValue: "E" },
          { key: "fav", label: "fav", defaultValue: "\\text{favourable outcomes}" },
          { key: "total", label: "total", defaultValue: "\\text{total outcomes}" },
        ],
        build: (values) => `P(${getValue(values, "event", "E")})=\\frac{${getValue(values, "fav", "\\text{favourable outcomes}")}}{${getValue(values, "total", "\\text{total outcomes}")}}`,
      },
      {
        id: "median",
        label: "Median",
        fields: [
          { key: "l", label: "l", defaultValue: "l" },
          { key: "n", label: "N", defaultValue: "N" },
          { key: "cf", label: "cf", defaultValue: "cf" },
          { key: "f", label: "f", defaultValue: "f" },
          { key: "h", label: "h", defaultValue: "h" },
        ],
        build: (values) => `\\text{Median} = ${getValue(values, "l", "l")} + \\frac{\\frac{${getValue(values, "n", "N")}}{2} - ${getValue(values, "cf", "cf")}}{${getValue(values, "f", "f")}} \\times ${getValue(values, "h", "h")}`,
      },
    ],
  },
  {
    label: "Science",
    items: [
      {
        id: "chemical-equation",
        label: "Chemical equation",
        fields: [
          { key: "reactants", label: "reactants", defaultValue: "Reactants" },
          { key: "products", label: "products", defaultValue: "Products" },
        ],
        build: (values) => `\\mathrm{${getValue(values, "reactants", "Reactants")} \\rightarrow ${getValue(values, "products", "Products")}}`,
      },
      {
        id: "ohm-law",
        label: "Ohm law",
        fields: [
          { key: "v", label: "V", defaultValue: "V" },
          { key: "i", label: "I", defaultValue: "I" },
          { key: "r", label: "R", defaultValue: "R" },
        ],
        build: (values) => `${getValue(values, "v", "V")} = ${getValue(values, "i", "I")}${getValue(values, "r", "R")}`,
      },
      {
        id: "electric-power",
        label: "Electric power",
        fields: [
          { key: "p", label: "P", defaultValue: "P" },
          { key: "v", label: "V", defaultValue: "V" },
          { key: "i", label: "I", defaultValue: "I" },
          { key: "r", label: "R", defaultValue: "R" },
        ],
        build: (values) => `${getValue(values, "p", "P")} = ${getValue(values, "v", "V")}${getValue(values, "i", "I")} = ${getValue(values, "i", "I")}^2${getValue(values, "r", "R")}`,
      },
      {
        id: "resistance",
        label: "Resistance",
        fields: [
          { key: "r", label: "R", defaultValue: "R" },
          { key: "rho", label: "rho", defaultValue: "\\rho" },
          { key: "l", label: "l", defaultValue: "l" },
          { key: "a", label: "A", defaultValue: "A" },
        ],
        build: (values) => `${getValue(values, "r", "R")} = ${getValue(values, "rho", "\\rho")}\\frac{${getValue(values, "l", "l")}}{${getValue(values, "a", "A")}}`,
      },
      {
        id: "lens-formula",
        label: "Lens formula",
        fields: [
          { key: "v", label: "v", defaultValue: "v" },
          { key: "u", label: "u", defaultValue: "u" },
          { key: "f", label: "f", defaultValue: "f" },
        ],
        build: (values) => `\\frac{1}{${getValue(values, "v", "v")}} - \\frac{1}{${getValue(values, "u", "u")}} = \\frac{1}{${getValue(values, "f", "f")}}`,
      },
      {
        id: "magnification",
        label: "Magnification",
        fields: [
          { key: "m", label: "m", defaultValue: "m" },
          { key: "hi", label: "h'", defaultValue: "h'" },
          { key: "ho", label: "h", defaultValue: "h" },
          { key: "v", label: "v", defaultValue: "v" },
          { key: "u", label: "u", defaultValue: "u" },
        ],
        build: (values) => `${getValue(values, "m", "m")} = \\frac{${getValue(values, "hi", "h'")}}{${getValue(values, "ho", "h")}} = \\frac{${getValue(values, "v", "v")}}{${getValue(values, "u", "u")}}`,
      },
      {
        id: "newton-second",
        label: "Newton 2nd law",
        fields: [
          { key: "f", label: "F", defaultValue: "F" },
          { key: "m", label: "m", defaultValue: "m" },
          { key: "a", label: "a", defaultValue: "a" },
        ],
        build: (values) => `${getValue(values, "f", "F")} = ${getValue(values, "m", "m")}${getValue(values, "a", "a")}`,
      },
      {
        id: "kinetic-energy",
        label: "Kinetic energy",
        fields: [
          { key: "m", label: "m", defaultValue: "m" },
          { key: "v", label: "v", defaultValue: "v" },
        ],
        build: (values) => `E_k = \\frac{1}{2}${getValue(values, "m", "m")}${getValue(values, "v", "v")}^2`,
      },
      {
        id: "gravitation",
        label: "Gravitation",
        fields: [
          { key: "m1", label: "m1", defaultValue: "m_1" },
          { key: "m2", label: "m2", defaultValue: "m_2" },
          { key: "r", label: "r", defaultValue: "r" },
        ],
        build: (values) => `F = G\\frac{${getValue(values, "m1", "m_1")}${getValue(values, "m2", "m_2")}}{${getValue(values, "r", "r")}^2}`,
      },
      {
        id: "density",
        label: "Density",
        fields: [
          { key: "m", label: "mass", defaultValue: "m" },
          { key: "v", label: "vol", defaultValue: "V" },
        ],
        build: (values) => `\\rho = \\frac{${getValue(values, "m", "m")}}{${getValue(values, "v", "V")}}`,
      },
      {
        id: "speed",
        label: "Speed",
        fields: [
          { key: "s", label: "dist", defaultValue: "s" },
          { key: "t", label: "time", defaultValue: "t" },
        ],
        build: (values) => `v = \\frac{${getValue(values, "s", "s")}}{${getValue(values, "t", "t")}}`,
      },
      {
        id: "mole-concept",
        label: "Mole concept",
        fields: [
          { key: "n", label: "n", defaultValue: "n" },
          { key: "m", label: "mass", defaultValue: "m" },
          { key: "mm", label: "molar", defaultValue: "M" },
        ],
        build: (values) => `${getValue(values, "n", "n")} = \\frac{${getValue(values, "m", "m")}}{${getValue(values, "mm", "M")}}`,
      },
      {
        id: "photosynthesis",
        label: "Photosynthesis",
        fields: [
          { key: "co2", label: "CO2", defaultValue: "6CO_2" },
          { key: "h2o", label: "H2O", defaultValue: "6H_2O" },
          { key: "glucose", label: "glucose", defaultValue: "C_6H_{12}O_6" },
          { key: "o2", label: "O2", defaultValue: "6O_2" },
        ],
        build: (values) => `\\mathrm{${getValue(values, "co2", "6CO_2")} + ${getValue(values, "h2o", "6H_2O")} \\rightarrow ${getValue(values, "glucose", "C_6H_{12}O_6")} + ${getValue(values, "o2", "6O_2")}}`,
      },
      {
        id: "custom-latex",
        label: "Custom LaTeX",
        fields: [
          { key: "latex", label: "latex", defaultValue: "x^2 + y^2 = r^2" },
        ],
        build: (values) => `${getValue(values, "latex", "x^2 + y^2 = r^2")}`,
      },
    ],
  },
];

function textToHtml(value: string) {
  const cleanedValue = cleanCorruptMathArtifacts(value);
  if (cleanedValue.trim().startsWith("<") && !hasCorruptMathMarkup(cleanedValue)) return cleanedValue;

  return cleanedValue
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderParagraph(paragraph) || "<br>"}</p>`)
    .join("");
}

function editorContent(value: string, htmlValue?: string) {
  const content = htmlValue?.trim() && !hasCorruptMathMarkup(htmlValue) ? sanitizeMathHtml(htmlValue) : textToHtml(value);
  return enhanceMathMarkup(content);
}

function sanitizeMathHtml(html: string) {
  return html.replace(/data-latex=(["'])(.*?)\1/g, (_match, quote: string, latex: string) => {
    const normalized = normalizeLatexForKatex(unescapeHtml(latex));
    return `data-latex=${quote}${escapeAttribute(normalized)}${quote}`;
  });
}

function enhanceMathMarkup(html: string) {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith("<")) return part;
      return renderInlineContent(unescapeHtml(part));
    })
    .join("");
}

function renderParagraph(value: string) {
  return value
    .split("\n")
    .map((line) => renderInlineContent(line))
    .join("<br>");
}

function renderInlineContent(value: string) {
  const separatedValue = separateOptionEntries(value);
  const parts: string[] = [];
  const mathPattern = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mathPattern.exec(separatedValue)) !== null) {
    parts.push(renderImplicitMath(separatedValue.slice(cursor, match.index)));
    parts.push(renderMathNode(match[1] ?? match[2] ?? ""));
    cursor = match.index + match[0].length;
  }

  parts.push(renderImplicitMath(separatedValue.slice(cursor)));
  return parts.join("");
}

function separateOptionEntries(value: string) {
  const optionMarker = /\s+(\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[A-D])\)|[A-D][.)])\s*/gi;
  const matches = Array.from(value.matchAll(optionMarker));

  if (matches.length < 2) return value;

  return value.replace(optionMarker, "<br>$1 ");
}

function renderImplicitMath(value: string) {
  if (!value) return "";
  if (isMostlyFormula(value)) return renderMathNode(value.trim());

  return renderVisualScripts(escapeHtml(value).replaceAll("&lt;br&gt;", "<br>"))
    .replace(/\\frac\{[^{}]+\}\{[^{}]+\}/g, (match) => renderMathNode(unescapeHtml(match)))
    .replace(/\\sqrt\{[^{}]+\}/g, (match) => renderMathNode(unescapeHtml(match)))
    .replace(/\\(?:sin|cos|tan|theta|pi|triangle|rho|sum|bar|mathrm|text)(?:\{[^{}]*\})?(?:\^\{?[\w+\-]+\}?)?(?:\s+[A-Za-z0-9_\\{}^'+\-]+)?/g, (match) =>
      renderMathNode(unescapeHtml(match)),
    )
    .replace(/[A-Za-z0-9)]+(?:\^\{?[\w+\-]+\}?|_\{?[\w+\-]+\}?)+/g, (match) => renderMathNode(unescapeHtml(match)));
}

function renderVisualScripts(value: string) {
  return value
    .replace(/\(([A-Za-z0-9\s+\-−–*/=.,]+)\)([23])(?=\b|[^A-Za-z0-9])/g, "($1)<sup>$2</sup>")
    .replace(/([a-z])([23])(?=\b|[^A-Za-z0-9])/g, "$1<sup>$2</sup>")
    .replace(/\b([A-Z][a-z]?)(\d+)(?=[A-Z]|$)/g, "$1<sub>$2</sub>");
}

function isMostlyFormula(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const hasMathSignal = /\\|[_^=]|[+\-*/]|π|√|∑|≤|≥|≠|→/.test(trimmed);
  if (!hasMathSignal) return false;

  const words = trimmed.match(/[A-Za-z]{4,}/g) ?? [];
  const formulaCharacters = trimmed.replace(/[A-Za-z0-9_\\{}()[\]\s+\-*/=.,^'π√∑≤≥≠→⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/g, "");

  return formulaCharacters.length === 0 && words.length <= 2;
}

function renderMathNode(latex: string) {
  const normalized = normalizeLatexForKatex(latex);
  if (!normalized) return "";

  return `<span data-type="inline-math" data-latex="${escapeAttribute(normalized)}"></span>`;
}

function normalizeLatexForKatex(latex: string) {
  let normalized = latex.trim();
  if (!normalized) return "";

  normalized = normalized
    .replace(/^\${1,2}/, "")
    .replace(/\${1,2}$/, "")
    .replace(/[−–]/g, "-")
    .replace(/π/g, "\\pi")
    .replace(/√\s*\(([^()]+)\)/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}");

  normalized = normalized.replace(/([A-Za-z0-9)\]}])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, base: string, digits: string) => {
    const ascii = fromUnicodeDigits(digits, "sup");
    return ascii.length === 1 ? `${base}^${ascii}` : `${base}^{${ascii}}`;
  });

  normalized = normalized.replace(/([A-Za-z0-9)\]}])([₀₁₂₃₄₅₆₇₈₉]+)/g, (_match, base: string, digits: string) => {
    const ascii = fromUnicodeDigits(digits, "sub");
    return ascii.length === 1 ? `${base}_${ascii}` : `${base}_{${ascii}}`;
  });

  return normalized;
}

function fromUnicodeDigits(value: string, mode: "sup" | "sub") {
  const map =
    mode === "sup"
      ? { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" }
      : { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

  return value
    .split("")
    .map((digit) => map[digit as keyof typeof map] ?? digit)
    .join("");
}

interface RichTextJsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: RichTextJsonNode[];
}

function documentToPlainText(node: RichTextJsonNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  // Serialize math back into `$...$` / `$$...$$` so the plain `text` IS the
  // single source of truth (rendered later by the KaTeX LaTeX pipeline).
  if (node.type === "inlineMath") {
    const latex = String(node.attrs?.latex ?? "").trim();
    return latex ? `$${latex}$` : "";
  }
  if (node.type === "blockMath") {
    const latex = String(node.attrs?.latex ?? "").trim();
    return latex ? `$$${latex}$$` : "";
  }

  const children = node.content?.map(documentToPlainText).join("") ?? "";
  if (["paragraph", "heading", "listItem"].includes(node.type ?? "")) return `${children}\n`;
  return children;
}

function heightClass(height: RichTextEditorProps["minHeight"]) {
  if (height === "compact") return "min-h-8";
  if (height === "answer") return "min-h-12";
  return "min-h-14";
}
