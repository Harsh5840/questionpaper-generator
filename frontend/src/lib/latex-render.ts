// LaTeX rendering for the prod-aligned model: a question's text is a single
// string that may contain `$...$` / `$$...$$` math. We render math with KaTeX
// and sanitize the non-math parts with DOMPurify, then drop the result into the
// DOM via dangerouslySetInnerHTML.
//
//   renderLatex(text, "explicit")  → only balanced `$...$` is treated as math
//   renderLatex(text, "trusted")   → also detects bare LaTeX / greek per line
//
// This is the read/display contract — there is no rich_text HTML anymore.
import katex from "katex";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";

export type LatexMode = "explicit" | "trusted";

// Limited HTML that may legitimately appear in question text (tables for
// match-the-column, basic emphasis, scripts for chem/exponents, line breaks).
const ALLOWED_TAGS = [
  "table", "thead", "tbody", "tr", "th", "td",
  "strong", "b", "em", "i", "u", "sub", "sup", "br", "p", "ul", "ol", "li",
];
const ALLOWED_ATTR = ["colspan", "rowspan"];

const LATEX_CMD = /\\[a-zA-Z]+/;
const BARE_GREEK = /[α-ωΑ-Ω]/;
const MATH_PATTERN = /[∑∫√±×÷≤≥≠→⇒]|\^\{?\d|_\{?\d/;

export function renderLatex(text: string | null | undefined, mode: LatexMode = "explicit"): string {
  const input = text == null ? "" : String(text);
  if (!input) return "";
  return mode === "trusted" ? renderTrustedLatex(input) : renderExplicitLatex(input);
}

function renderExplicitLatex(text: string): string {
  const dollars = (text.match(/\$/g) || []).length;
  // No `$` at all, or an unbalanced (odd) count → there is no safe way to pair
  // delimiters, so render the whole thing as plain (sanitized) text.
  if (dollars === 0 || dollars % 2 !== 0) return sanitizeHtmlWithBreaks(text);

  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let html = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    html += sanitizeHtmlWithBreaks(text.slice(cursor, match.index));
    const display = match[1] !== undefined;
    const expr = (match[1] ?? match[2] ?? "").trim();
    html += renderMath(expr, display, match[0]);
    cursor = match.index + match[0].length;
  }
  html += sanitizeHtmlWithBreaks(text.slice(cursor));
  return html;
}

function renderTrustedLatex(text: string): string {
  if (text.includes("$")) return renderExplicitLatex(text);

  const looksMath = LATEX_CMD.test(text) || BARE_GREEK.test(text) || MATH_PATTERN.test(text);
  if (!looksMath) return sanitizeHtmlWithBreaks(text);

  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return "";
      const lineLooksMath = LATEX_CMD.test(line) || BARE_GREEK.test(line) || MATH_PATTERN.test(line);
      if (!lineLooksMath) return sanitizeHtml(line);
      try {
        return katex.renderToString(normalizeToLatex(line), { displayMode: false, throwOnError: false, strict: false });
      } catch {
        return sanitizeHtml(line);
      }
    })
    .join("<br/>");
}

function renderMath(expr: string, display: boolean, raw: string): string {
  if (!expr) return "";
  try {
    return katex.renderToString(expr, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    return escapeHtml(raw);
  }
}

function sanitizeHtmlWithBreaks(text: string): string {
  if (!text) return "";
  return sanitizeHtml(text.replace(/\r?\n/g, "<br/>"));
}

function sanitizeHtml(html: string): string {
  if (!html) return "";
  // DOMPurify needs a DOM; on the (rare) server pass, fall back to escaping.
  if (typeof window === "undefined") return escapeHtml(html);
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

// trusted-mode normalization: bare greek words → \greek, * → \times, arrows → \Rightarrow
export function normalizeToLatex(text: string): string {
  return text
    .replace(/\b(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|chi|psi|omega)\b/gi,
      (m) => "\\" + m.toLowerCase())
    .replace(/\*/g, "\\times ")
    .replace(/->|=>|→/g, "\\Rightarrow ");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
