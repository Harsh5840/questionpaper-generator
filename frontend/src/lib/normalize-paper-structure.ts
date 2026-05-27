import { Paper, PaperQuestion, PaperQuestionOption, PaperSubpart } from "./types";

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

export function normalizeQuestionStructure(question: PaperQuestion): PaperQuestion {
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
    subparts: normalizeRawSubparts(record.subparts ?? record.sub_parts),
    optionalChoice: normalizeRawChoice(record.optionalChoice ?? record.optional_choice),
    answer: stringValue(record.answer, ""),
    answerRichText: stringValue(record.answerRichText ?? record.answer_rich_text, ""),
  });
}

export function richTextFromText(text: string) {
  const normalized = normalizeMathText(text);
  if (!normalized.trim()) return "";

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${inlineMathHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function normalizeMathText(text: string) {
  return text
    .replace(/\b([a-zA-Z])\^(\d+)\b/g, "$1$2")
    .replace(/\b([a-zA-Z])_(\d+)\b/g, "$1$2")
    .replace(/([a-z])(\d)(?=\b|[^a-zA-Z])/g, (_match, symbol: string, digit: string) => `${symbol}${toSuperscript(digit)}`)
    .replace(/(\d)([a-z])(\d)(?=\b|[^a-zA-Z])/g, (_match, coefficient: string, symbol: string, digit: string) => `${coefficient}${symbol}${toSuperscript(digit)}`)
    .replace(/(\([^()\n]+\))\s*(\d)(?=\b|[^a-zA-Z])/g, (_match, group: string, digit: string) => `${group}${toSuperscript(digit)}`)
    .replace(/\b([A-Z][a-z]?)(\d+)\b/g, (_match, element: string, digits: string) => `${element}${toSubscript(digits)}`)
    .replace(/\b([A-Z][a-z]?\d*){2,}\b/g, (formula) => formula.replace(/(\d+)/g, (digits) => toSubscript(digits)));
}

export function toRichTextHtml(text: string, existingHtml?: string) {
  if (existingHtml && !looksLikeStaleBlob(existingHtml, text)) return existingHtml;
  return richTextFromText(text);
}

function normalizeQuestionLike<T extends PaperQuestion | PaperSubpart | NonNullable<PaperQuestion["optionalChoice"]>>(
  question: T,
): T {
  const text = stringValue(question.text, "");
  const existingOptions = "options" in question ? normalizeRawOptions(question.options) : undefined;
  const split = existingOptions && existingOptions.length > 0 ? null : splitInlineBlocks(text);
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
  if (!choice || (!choice.text && !choice.richText)) return undefined;
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
  if (!record.text && !record.richText && !record.rich_text) return undefined;
  return {
    id: optionalString(record.id),
    text: stringValue(record.text, ""),
    richText: optionalString(record.richText ?? record.rich_text),
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

function splitInlineBlocks(text: string) {
  const matches = Array.from(text.matchAll(/(?:^|\s)(\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[a-eA-E])\)|[A-D][.)])\s*/giu));
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

  if (blocks.every((block) => /^\([a-e]\)$/i.test(block.label))) {
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
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, "<sup>$1</sup>")
    .replace(/([₀₁₂₃₄₅₆₇₈₉]+)/g, "<sub>$1</sub>");
}

function looksLikeStaleBlob(html: string, text: string) {
  if (!html) return false;
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > text.length + 20 && /\((?:i{1,3}|iv|v|[A-D])\)|[A-D][.)]/i.test(plain);
}

function toSuperscript(value: string) {
  const map: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return value.replace(/\d/g, (digit) => map[digit] || digit);
}

function toSubscript(value: string) {
  const map: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  return value.replace(/\d/g, (digit) => map[digit] || digit);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}`;
}
