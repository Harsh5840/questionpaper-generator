import { Paper, PaperQuestion, PaperSection } from "./types";

export function isEmptyRichText(text?: string, richText?: string, imageAssets?: { id: string }[]): boolean {
  if (imageAssets && imageAssets.length > 0) return false;
  if (text?.trim()) return false;
  const stripped = richText?.replace(/<[^>]*>/g, "").trim() ?? "";
  return stripped.length === 0;
}

export function choiceHasContent(choice: PaperQuestion["optionalChoice"]): boolean {
  if (!choice) return false;
  return Boolean(
    choice.text?.trim() ||
      choice.richText?.replace(/<[^>]*>/g, "").trim() ||
      (choice.options && choice.options.some((option) => option.text?.trim() || option.richText?.replace(/<[^>]*>/g, "").trim())) ||
      (choice.subparts && choice.subparts.length > 0) ||
      (choice.imageAssets && choice.imageAssets.length > 0),
  );
}

export function countedQuestionMarks(question: PaperQuestion): number {
  const subpartTotal = (question.subparts ?? []).reduce((total, subpart) => total + Number(subpart.marks || 0), 0);
  return subpartTotal > 0 ? subpartTotal : Number(question.marks || 0);
}

export function questionWithComputedMarks(question: PaperQuestion): PaperQuestion {
  const marks = countedQuestionMarks(question);
  return marks !== Number(question.marks || 0) ? { ...question, marks } : question;
}

export function countedSectionMarks(section: PaperSection): number {
  const questionMarks = section.questions.map(countedQuestionMarks);
  const rawTotal = questionMarks.reduce((total, marks) => total + marks, 0);
  const rule = section.attemptRule;
  if (!rule || rule.required >= rule.offered || rule.required >= section.questions.length) return rawTotal;

  const uniformMarks = questionMarks.length > 0 && questionMarks.every((marks) => marks === questionMarks[0]);
  if (uniformMarks) return rule.required * (questionMarks[0] ?? 0);

  return questionMarks
    .slice()
    .sort((left, right) => right - left)
    .slice(0, rule.required)
    .reduce((total, marks) => total + marks, 0);
}

export function calculateSourceMix(paper: Paper): NonNullable<Paper["sourceMix"]> {
  const counts = { ncert: 0, pyq: 0, questionBank: 0, aiGenerated: 0, uncited: 0 };

  paper.sections.forEach((section) => {
    section.questions.forEach((question) => {
      const source = `${question.generationMode ?? ""} ${question.source ?? ""} ${(question.sourceCitations ?? []).join(" ")}`.toLowerCase();
      const hasCitation = Boolean(question.sourceCitations?.length);
      const isManual = source.includes("manual");
      const isGeneratedFromRequest = source.includes("ai generated") || source.includes("retrieved context") || source.includes("owned corpus");
      const paperUsedOwnedSources = /ncert|pyq/i.test(paper.metadata.source || "");

      if (question.generationMode === "direct_ncert" || source.includes("direct_ncert")) counts.ncert += 1;
      else if (question.generationMode === "direct_pyq" || source.includes("direct_pyq")) counts.pyq += 1;
      else if (question.generationMode === "question_bank" || source.includes("question bank")) counts.questionBank += 1;
      else if (question.generationMode === "ai_generated" || hasCitation || isGeneratedFromRequest || (paperUsedOwnedSources && !isManual)) counts.aiGenerated += 1;
      else counts.uncited += 1;
    });
  });

  return counts;
}

export function normalizeLatexChars(value: string): string {
  return value
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/π/g, "\\pi")
    .replace(/([A-Za-z0-9)\]}])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, base: string, digits: string) => `${base}^{${digits.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(digit).toString())}}`);
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

export function unescapeHtml(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

export function hasCorruptMathMarkup(value: string): boolean {
  const decoded = unescapeHtml(value);
  return (
    /data-latex=["'][\s\S]*?<\s*span/i.test(decoded) ||
    /data-latex=["'][\s\S]*?data-type\s*=\s*["']?inline-math/i.test(decoded) ||
    /&lt;\s*span[^&]*(data-type|data-latex)/i.test(value) ||
    /\bspandata\s*[–-]?\s*type\s*=/i.test(value)
  );
}

export function cleanCorruptMathArtifacts(value: string): string {
  if (!hasCorruptMathMarkup(value) && !/(?:<|&lt;)\s*span\b/i.test(value)) return value;

  return value
    .replace(/<span\b[^>]*data-latex=(["'])(.*?)\1[^>]*>\s*<\/span>/gi, (_match, _quote: string, latex: string) => `$${unescapeHtml(latex)}$`)
    .replace(/&lt;span\b[\s\S]*?data-latex=(?:&quot;|["'])(.*?)(?:&quot;|["'])[\s\S]*?&lt;\/span&gt;/gi, (_match, latex: string) => `$${unescapeHtml(latex)}$`)
    .replace(/&lt;\/?span[^&]*(?:&gt;)?/gi, "")
    .replace(/<\/?span[^>]*>/gi, "")
    .replace(/\bspandata\s*[–-]?\s*type\s*=\s*/gi, "")
    .replace(/["']?\s*&gt;/g, "")
    .replace(/["']?\s*>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
