import { Paper, PaperImageAsset, PaperQuestion, PaperQuestionOption, PaperSubpart } from "./types";
import { cleanCorruptMathArtifacts, escapeAttribute, escapeHtml, hasCorruptMathMarkup, unescapeHtml } from "./paper-utils";

type AnyRecord = Record<string, unknown>;

export function normalizePaperStructure(paper: Paper): Paper {
  return {
    ...paper,
    sections: paper.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => normalizeQuestionStructure(question)),
    })),
    sets: paper.sets?.map((set) => normalizePaperStructure(set)),
  };
}

function normalizeQuestionStructure(question: PaperQuestion): PaperQuestion {
  const normalized = normalizeQuestionLike(question);
  return normalized as PaperQuestion;
}

export function normalizeRawQuestion(record: AnyRecord): PaperQuestion {
  return normalizeQuestionStructure({
    id: stringValue(record.id, makeId()),
    text: stringValue(record.text ?? record.question, ""),
    richText: stringValue(record.richText ?? record.rich_text, ""),
    options: normalizeRawOptions(record.options),
    marks: numberValue(record.marks, 0),
    type: stringValue(record.type ?? record.question_type, ""),
    difficulty: stringValue(record.difficulty, ""),
    source: stringValue(record.source, ""),
    topic: optionalString(record.topic),
    tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
    sourceCitations: Array.isArray(record.sourceCitations ?? record.source_citations)
      ? ((record.sourceCitations ?? record.source_citations) as unknown[]).map(String)
      : undefined,
    generationMode: optionalGenerationMode(record.generationMode ?? record.generation_mode),
    diagramBlocks: normalizeDiagramBlocks(record.diagramBlocks ?? record.diagram_blocks),
    imageAssets: normalizeImageAssets(record.imageAssets ?? record.image_assets),
    subparts: normalizeRawSubparts(record.subparts ?? record.sub_parts),
    optionalChoice: normalizeRawChoice(record.optionalChoice ?? record.optional_choice),
    answer: stringValue(record.answer, ""),
    answerRichText: stringValue(record.answerRichText ?? record.answer_rich_text, ""),
  });
}

function normalizeImageAssets(value: unknown): PaperImageAsset[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const assets = value
    .map((item): PaperImageAsset | null => {
      const record = asRecord(item);
      const url = optionalString(record.url);
      if (!url) return null;

      return {
        id: stringValue(record.id, makeId()),
        filename: optionalString(record.filename),
        name: optionalString(record.name),
        url,
        mimeType: optionalString(record.mimeType ?? record.mime_type),
        width: numberOrUndefined(record.width),
        height: numberOrUndefined(record.height),
        altText: optionalString(record.altText ?? record.alt_text),
        caption: optionalString(record.caption),
      };
    })
    .filter((asset): asset is PaperImageAsset => Boolean(asset));

  return assets.length > 0 ? assets : undefined;
}

function normalizeDiagramBlocks(value: unknown): PaperQuestion["diagramBlocks"] {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.map((item) => {
    const record = asRecord(item);
    return {
      id: stringValue(record.id, makeId()),
      title: stringValue(record.title, "Diagram placeholder"),
      caption: optionalString(record.caption),
      status: "placeholder" as const,
    };
  });
  return blocks.length > 0 ? blocks : undefined;
}

function optionalGenerationMode(value: unknown): PaperQuestion["generationMode"] {
  const mode = optionalString(value);
  if (mode === "direct_ncert" || mode === "direct_pyq" || mode === "question_bank" || mode === "ai_generated") return mode;
  return undefined;
}

export function richTextFromText(text: string) {
  const normalized = normalizeMathText(cleanCorruptMathArtifacts(text));
  if (!normalized.trim()) return "";

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${inlineMathHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function normalizeMathText(text: string) {
  return restoreProtectedSegments(protectLatexSegments(text), (value) =>
    value
    .replace(/\b([a-zA-Z])\^(\d+)\b/g, "$1$2")
    .replace(/\b([a-zA-Z])_(\d+)\b/g, "$1$2")
    .replace(/([a-z])(\d)(?=\b|[^a-zA-Z])/g, (_match, symbol: string, digit: string) => `${symbol}${toSuperscript(digit)}`)
    .replace(/(\d)([a-z])(\d)(?=\b|[^a-zA-Z])/g, (_match, coefficient: string, symbol: string, digit: string) => `${coefficient}${symbol}${toSuperscript(digit)}`)
    .replace(/(\([^()\n]+\))\s*(\d)(?=\b|[^a-zA-Z])/g, (_match, group: string, digit: string) => `${group}${toSuperscript(digit)}`)
    .replace(/\b([A-Z][a-z]?)(\d+)\b/g, (_match, element: string, digits: string) => `${element}${toSubscript(digits)}`)
    .replace(/\b([A-Z][a-z]?\d*){2,}\b/g, (formula) => formula.replace(/(\d+)/g, (digits) => toSubscript(digits))),
  );
}

function toRichTextHtml(text: string, existingHtml?: string) {
  if (existingHtml && hasMeaningfulHtml(existingHtml) && !looksLikeStaleBlob(existingHtml, text) && !hasCorruptMathMarkup(existingHtml)) {
    return upgradeRichTextHtml(existingHtml);
  }
  return richTextFromText(text);
}

function normalizeQuestionLike<T extends PaperQuestion | PaperSubpart | NonNullable<PaperQuestion["optionalChoice"]>>(
  question: T,
): T {
  const text = stringValue(question.text, "");
  const existingOptions = "options" in question ? normalizeRawOptions(question.options) : undefined;
  const questionType = "type" in question ? optionalString(question.type) : undefined;
  const split = existingOptions && existingOptions.length > 0 ? null : splitInlineBlocks(text, questionType);
  const cleanText = split ? split.stem : text;
  const richText = toRichTextHtml(cleanText, question.richText);
  const answer = "answer" in question ? stringValue(question.answer, "") : undefined;
  const normalized: AnyRecord = {
    ...question,
    text: cleanText,
    richText,
  };

  if ("options" in question) normalized.options = existingOptions && existingOptions.length > 0 ? existingOptions.map(normalizeOption) : split?.options;
  if ("subparts" in question) normalized.subparts = normalizeSubparts(question.subparts, split?.subparts);
  if ("optionalChoice" in question) normalized.optionalChoice = normalizeChoice(question.optionalChoice);
  if ("answerRichText" in question && answer !== undefined) normalized.answerRichText = toRichTextHtml(answer, question.answerRichText);

  return normalized as T;
}

function normalizeOption(option: PaperQuestionOption, index: number): PaperQuestionOption {
  const text = stringValue(option.text, "");
  return {
    ...option,
    id: option.id || makeId(),
    label: option.label || String.fromCharCode(65 + index),
    text,
    richText: toRichTextHtml(text, option.richText),
    imageAssets: normalizeImageAssets(option.imageAssets),
  };
}

function normalizeSubparts(current: PaperSubpart[] | undefined, extracted: PaperSubpart[] | undefined) {
  const subparts = current && current.length > 0 ? current : extracted;
  if (!subparts || subparts.length === 0) return undefined;

  return subparts.map((subpart, index) => {
    const normalized = normalizeQuestionLike({
      ...subpart,
      id: subpart.id || makeId(),
      label: String.fromCharCode(97 + index),
    });

    return normalized;
  });
}

function normalizeChoice(choice: PaperQuestion["optionalChoice"] | PaperSubpart["optionalChoice"] | undefined) {
  if (!choice) return undefined;
  return normalizeQuestionLike({
    ...choice,
    id: choice.id || makeId(),
    text: stringValue(choice.text, ""),
  });
}

function normalizeRawOptions(value: unknown): PaperQuestionOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.map((item, index) => {
    const record = asRecord(item);
    return normalizeOption(
      {
        id: optionalString(record.id),
        label: optionalString(record.label) || String.fromCharCode(65 + index),
        text: stringValue(record.text ?? record.value ?? item, ""),
      richText: optionalString(record.richText ?? record.rich_text),
      imageAssets: normalizeImageAssets(record.imageAssets ?? record.image_assets),
      isCorrect: Boolean(record.isCorrect ?? record.is_correct ?? false),
      },
      index,
    );
  });
  return options.length > 0 ? options : undefined;
}

function normalizeRawSubparts(value: unknown): PaperSubpart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const subparts = value.map((item, index) => {
    const record = asRecord(item);
    return {
      id: stringValue(record.id, makeId()),
      label: optionalString(record.label) || String.fromCharCode(97 + index),
      text: stringValue(record.text, ""),
      richText: optionalString(record.richText ?? record.rich_text),
      options: normalizeRawOptions(record.options),
      diagramBlocks: normalizeDiagramBlocks(record.diagramBlocks ?? record.diagram_blocks),
      imageAssets: normalizeImageAssets(record.imageAssets ?? record.image_assets),
      marks: record.marks === undefined ? undefined : numberValue(record.marks, 0),
      answer: optionalString(record.answer),
      answerRichText: optionalString(record.answerRichText ?? record.answer_rich_text),
      optionalChoice: normalizeRawChoice(record.optionalChoice ?? record.optional_choice) as PaperSubpart["optionalChoice"],
    };
  });
  return subparts.length > 0 ? subparts : undefined;
}

function normalizeRawChoice(value: unknown): PaperQuestion["optionalChoice"] | undefined {
  const record = asRecord(value);
  if (!value || typeof value !== "object") return undefined;
  return {
    id: optionalString(record.id),
    text: stringValue(record.text, ""),
    richText: optionalString(record.richText ?? record.rich_text),
    options: normalizeRawOptions(record.options),
    subparts: normalizeRawSubparts(record.subparts ?? record.sub_parts),
    imageAssets: normalizeImageAssets(record.imageAssets ?? record.image_assets),
    marks: record.marks === undefined ? undefined : numberValue(record.marks, 0),
    type: optionalString(record.type ?? record.question_type),
    difficulty: optionalString(record.difficulty),
    source: optionalString(record.source),
    topic: optionalString(record.topic),
    tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
    answer: optionalString(record.answer),
    answerRichText: optionalString(record.answerRichText ?? record.answer_rich_text),
  };
}

function splitInlineBlocks(text: string, questionType?: string) {
  const matches = Array.from(text.matchAll(/(?:^|\s)(\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[a-zA-Z])\)|[A-Z][.)])\s*/giu));
  if (matches.length < 2) return null;

  const firstIndex = matches[0].index ?? 0;
  const stem = text.slice(0, firstIndex).trim();
  const blocks = matches.map((match, index) => {
    const rawLabel = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    return {
      id: makeId(),
      label: rawLabel,
      text: text.slice(start, end).trim(),
      richText: "",
    };
  });

  const isMcq = String(questionType || "").toLowerCase().includes("mcq");
  const allLowerAlpha = blocks.every((block) => /^\([a-z]\)$/.test(block.label));
  const allRoman = blocks.every((block) => /^\((?:i{1,3}|iv|v|vi{0,3}|ix|x)\)$/i.test(block.label));

  if (!isMcq && (allLowerAlpha || allRoman)) {
    return {
      stem,
      subparts: blocks.map((block, index) => ({ ...block, label: String.fromCharCode(97 + index), marks: 1, answer: "" })),
      options: undefined,
    };
  }

  return {
    stem,
    options: blocks.map((block, index) => ({
      ...block,
      label: block.label || String.fromCharCode(65 + index),
      richText: richTextFromText(block.text),
    })),
    subparts: undefined,
  };
}

function inlineMathHtml(text: string) {
  return escapeHtml(text)
    .replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/g, (_match, blockLatex: string, inlineLatex: string) => mathSpan(blockLatex ?? inlineLatex ?? ""))
    .replace(/\\frac\{[^{}]+\}\{[^{}]+\}/g, (match) => mathSpan(match))
    .replace(/\\sqrt\{[^{}]+\}/g, (match) => mathSpan(match))
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, "<sup>$1</sup>")
    .replace(/([₀₁₂₃₄₅₆₇₈₉]+)/g, "<sub>$1</sub>");
}

function mathSpan(latex: string) {
  return `<span data-type="inline-math" data-latex="${escapeAttribute(normalizeLatex(latex))}"></span>`;
}

function normalizeLatex(latex: string) {
  return latex.trim().replace(/^\${1,2}/, "").replace(/\${1,2}$/, "").replace(/[−–]/g, "-").replace(/π/g, "\\pi");
}

function protectLatexSegments(text: string) {
  const segments: string[] = [];
  const tokenized = text.replace(/\$\$[^$]+\$\$|\$[^$\n]+\$|\\(?:frac|sqrt|mathrm|text)\{[^{}]*\}(?:\{[^{}]*\})?/g, (segment) => {
    const token = `\uE000${segments.length}\uE001`;
    segments.push(segment);
    return token;
  });

  return { tokenized, segments };
}

function restoreProtectedSegments(protectedText: { tokenized: string; segments: string[] }, transform: (value: string) => string) {
  const transformed = transform(protectedText.tokenized);
  return transformed.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedText.segments[Number(index)] ?? "");
}

function looksLikeStaleBlob(html: string, text: string) {
  if (!html) return false;
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > text.length + 20 && /\((?:i{1,3}|iv|v|[A-D])\)|[A-D][.)]/i.test(plain);
}

function hasMeaningfulHtml(html: string) {
  return (
    html
      .replace(/<br\s*\/?>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim().length > 0 || /data-latex=/.test(html)
  );
}

function upgradeRichTextHtml(html: string) {
  return html.replace(/>([^<]*\\(?:frac|sqrt)\{[^<]+)<\/p>/g, (_match, content: string) => `>${inlineMathHtml(content)}</p>`);
}

function toSuperscript(value: string) {
  const map: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return value.replace(/\d/g, (digit) => map[digit] || digit);
}

function toSubscript(value: string) {
  const map: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  return value.replace(/\d/g, (digit) => map[digit] || digit);
}

function stringValue(value: unknown, fallback: string) {
  return value === undefined || value === null ? fallback : String(value);
}

function optionalString(value: unknown) {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}`;
}
