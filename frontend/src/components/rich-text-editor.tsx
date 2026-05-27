"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
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
}

export function RichTextEditor({
  value,
  htmlValue,
  onChange,
  onHtmlChange,
  label,
  minHeight = "normal",
  placeholder = "Write here...",
}: RichTextEditorProps) {
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
      onChange(documentToPlainText(activeEditor.getJSON()).trim());
      onHtmlChange?.(activeEditor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;

    const nextContent = htmlValue?.trim() ? htmlValue : textToHtml(value);
    const currentText = documentToPlainText(editor.getJSON()).trim();

    if (editor.getHTML() !== nextContent && currentText !== value.trim()) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [editor, htmlValue, value]);

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
          </>
        )}
        {!activeFormula && (
          <>
            {/*
              Math snippet dropdown is paused for now. LaTeX still renders from
              pasted/generated text, and the hidden builder code stays nearby so
              we can bring it back once the UX is redesigned.
            */}
            {false && (
              <label className="math-snippet-select inline-flex min-h-8 items-center gap-1 rounded border border-transparent px-1 text-xs font-bold text-[var(--on-surface-variant)] hover:border-[var(--outline-variant)] hover:bg-white">
                <Sigma size={14} />
                <span>Math</span>
                <select
                  aria-label="Insert math or science notation"
                  className="max-w-28 bg-transparent text-xs font-bold outline-none"
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
                  <option value="">Insert...</option>
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
            )}
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
          </>
        )}
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
    <div className="grid min-h-8 flex-1 grid-cols-1 gap-2 rounded-md border border-[var(--primary-container)] bg-white px-2 py-1 lg:grid-cols-[auto_1fr_auto_auto] lg:items-center">
      <span className="inline-flex items-center gap-1 text-xs font-black text-[var(--primary)]">
        <Sigma size={14} />
        {formula.label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {formula.fields.map((field) => (
          <label key={field.key} className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--on-surface-variant)]">
            <span>{field.label}</span>
            <input
              aria-label={`${formula.label} ${field.label}`}
              className="h-7 w-16 rounded border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] px-2 text-xs text-[var(--on-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              value={values[field.key] ?? field.defaultValue}
              onChange={(event) => onChange(field.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onInsert();
                if (event.key === "Escape") onCancel();
              }}
            />
          </label>
        ))}
        <code className="min-w-0 rounded bg-[var(--surface-container-low)] px-2 py-1 text-[11px] font-bold text-[var(--on-surface)]">
          Preview: {preview}
        </code>
      </div>
      <button className="rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-black text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={onInsert} type="button">
        Insert formula
      </button>
      <button className="rounded px-3 py-1.5 text-xs font-black text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={onCancel} type="button">
        Cancel
      </button>
    </div>
  );
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
  if (value.trim().startsWith("<")) return value;

  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderParagraph(paragraph) || "<br>"}</p>`)
    .join("");
}

function renderParagraph(value: string) {
  return value
    .split("\n")
    .map((line) => renderInlineContent(line))
    .join("<br>");
}

function renderInlineContent(value: string) {
  const parts: string[] = [];
  const mathPattern = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mathPattern.exec(value)) !== null) {
    parts.push(renderImplicitMath(value.slice(cursor, match.index)));
    parts.push(renderMathNode(match[1] ?? match[2] ?? ""));
    cursor = match.index + match[0].length;
  }

  parts.push(renderImplicitMath(value.slice(cursor)));
  return parts.join("");
}

function renderImplicitMath(value: string) {
  if (!value) return "";
  if (isMostlyFormula(value)) return renderMathNode(value.trim());

  return escapeHtml(value)
    .replace(/\\frac\{[^{}]+\}\{[^{}]+\}/g, (match) => renderMathNode(unescapeHtml(match)))
    .replace(/\\sqrt\{[^{}]+\}/g, (match) => renderMathNode(unescapeHtml(match)))
    .replace(/\\(?:sin|cos|tan|theta|pi|triangle|rho|sum|bar|mathrm|text)(?:\{[^{}]*\})?(?:\^\{?[\w+\-]+\}?)?(?:\s+[A-Za-z0-9_\\{}^'+\-]+)?/g, (match) =>
      renderMathNode(unescapeHtml(match)),
    )
    .replace(/[A-Za-z0-9)]+(?:\^\{?[\w+\-]+\}?|_\{?[\w+\-]+\}?)+/g, (match) => renderMathNode(unescapeHtml(match)));
}

function isMostlyFormula(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const hasMathSignal = /\\|[_^=]|[+\-*/]|π|√|∑|≤|≥|≠|→/.test(trimmed);
  if (!hasMathSignal) return false;

  const words = trimmed.match(/[A-Za-z]{4,}/g) ?? [];
  const formulaCharacters = trimmed.replace(/[A-Za-z0-9_\\{}()[\]\s+\-*/=.,^'π√∑≤≥≠→]/g, "");

  return formulaCharacters.length === 0 && words.length <= 2;
}

function renderMathNode(latex: string) {
  const normalized = latex.trim();
  if (!normalized) return "";

  return `<span data-type="inline-math" data-latex="${escapeAttribute(normalized)}"></span>`;
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
  if (node.type === "inlineMath" || node.type === "blockMath") return String(node.attrs?.latex ?? "");

  const children = node.content?.map(documentToPlainText).join("") ?? "";
  if (["paragraph", "heading", "listItem"].includes(node.type ?? "")) return `${children}\n`;
  return children;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function unescapeHtml(value: string) {
  return value.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

function heightClass(height: RichTextEditorProps["minHeight"]) {
  if (height === "compact") return "min-h-12";
  if (height === "answer") return "min-h-16";
  return "min-h-24";
}
