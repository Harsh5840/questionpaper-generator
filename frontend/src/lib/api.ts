import { Socket } from "phoenix";
import {
  AiUsageSummary,
  DashboardSummary,
  GenerationStatus,
  Paper,
  PaperQuestion,
  PaperRequest,
  PaperVersion,
  QuestionBankItem,
  Refinement,
  RetrievalPreview,
  RetrievalResult,
} from "./types";
import { normalizePaperStructure, normalizeRawQuestion } from "./normalize-paper-structure";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api";
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, "").replace(/^http/, "ws");

type GenerationRun = {
  id: string;
  status: string;
  variants?: Record<string, unknown>[];
  paper_ids?: string[];
  warnings?: string[];
};

type GenerationCallbacks = {
  onStatus?: (status: GenerationStatus) => void;
};

export async function fetchDashboardViaApi(): Promise<DashboardSummary | null> {
  try {
    const response = await fetch(`${API_BASE}/dashboard`);
    if (!response.ok) throw new Error(await responseErrorMessage(response, "Dashboard failed"));
    return normalizeDashboard(await response.json());
  } catch {
    return null;
  }
}

export async function generateViaApi(request: PaperRequest, callbacks: GenerationCallbacks = {}): Promise<Paper[]> {
  try {
    const response = await fetch(`${API_BASE}/generation-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toGenerationPayload(request)),
    });

    if (!response.ok) throw new Error(await responseErrorMessage(response, "Generation failed"));

    const data = (await response.json()) as GenerationRun;
    callbacks.onStatus?.({
      runId: data.id,
      status: normalizeRunStatus(data.status),
      step: data.status,
      message: data.status === "queued" ? "Generation queued" : "Generation started",
      progress: data.status === "queued" ? 5 : 20,
    });

    const completed = data.status === "completed" ? data : await waitForGeneration(data.id, callbacks);
    const variants = Array.isArray(completed.variants) ? completed.variants : [];
    const paperIds = Array.isArray(completed.paper_ids) ? completed.paper_ids : [];

    if (variants.length === 0) throw new Error(completed.warnings?.[0] ?? "No variants returned from the AI provider.");

    return variants.map((variant: Record<string, unknown>, index: number) => normalizePaper(variant, paperIds[index]));
  } catch (error) {
    throw error instanceof TypeError ? new Error("Backend unavailable. Start Phoenix and retry generation.") : error;
  }
}

export async function refineViaApi(paper: Paper, instruction: string): Promise<Refinement> {
  try {
    if (!paper.paperId) throw new Error("No backend paper id");

    const response = await fetch(`${API_BASE}/papers/${paper.paperId}/refinements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction, paper: toBackendPaper(paper) }),
    });

    if (!response.ok) throw new Error(await responseErrorMessage(response, "Refinement failed"));

    const data = await response.json();

    return {
      message: String(data.message ?? "Review proposed edits."),
      patchOps: Array.isArray(data.patch_ops) ? data.patch_ops : [],
      preview: normalizePaper(data.preview ?? paper, paper.paperId),
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error("AI refinement failed");
  }
}

export async function saveVersionViaApi(paper: Paper, changeSource: string) {
  if (!paper.paperId) return null;

  try {
    const response = await fetch(`${API_BASE}/papers/${paper.paperId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ change_source: changeSource, payload: toBackendPaper(paper) }),
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function saveCanvasVersionViaApi(paper: Paper, changeSource: string, documentHtml: string, documentText: string) {
  if (!paper.paperId) return null;

  try {
    const payload = {
      ...toBackendPaper(paper),
      document_html: documentHtml,
      document_text: documentText,
    };

    const response = await fetch(`${API_BASE}/papers/${paper.paperId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ change_source: changeSource, payload }),
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function getPaperViaApi(paperId: string): Promise<{ versions: PaperVersion[] } | null> {
  try {
    const response = await fetch(`${API_BASE}/papers/${paperId}`);
    if (!response.ok) return null;
    const data = await response.json();

    return {
      versions: Array.isArray(data.versions)
        ? data.versions.map((version: Record<string, unknown>) => ({
            id: String(version.id ?? ""),
            versionNumber: Number(version.version_number ?? version.versionNumber ?? 0),
            changeSource: String(version.change_source ?? version.changeSource ?? ""),
            payload: asRecord(version.payload),
            marksTotal: version.marks_total === undefined ? undefined : Number(version.marks_total),
            insertedAt: version.inserted_at ? String(version.inserted_at) : undefined,
          }))
        : [],
    };
  } catch {
    return null;
  }
}

export async function getStructuredPaperViaApi(paperId: string): Promise<{ version?: PaperVersion; paper?: Paper } | null> {
  try {
    const response = await fetch(`${API_BASE}/papers/${paperId}/structured`);
    if (!response.ok) return null;
    const data = asRecord(await response.json());
    const versionRecord = asRecord(data.version);
    const version = versionRecord.id
      ? {
          id: String(versionRecord.id),
          versionNumber: Number(versionRecord.version_number ?? versionRecord.versionNumber ?? 0),
          changeSource: String(versionRecord.change_source ?? versionRecord.changeSource ?? ""),
          payload: asRecord(versionRecord.payload),
          marksTotal: versionRecord.marks_total === undefined ? undefined : Number(versionRecord.marks_total),
          insertedAt: versionRecord.inserted_at ? String(versionRecord.inserted_at) : undefined,
        }
      : undefined;

    return {
      version,
      paper: data.payload ? normalizePaper(asRecord(data.payload), paperId) : undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchChaptersViaApi(request: Pick<PaperRequest, "board" | "classLevel" | "subject">): Promise<string[]> {
  try {
    const subjects = Array.from(new Set([sourceSubjectFor(request.subject), request.subject].filter(Boolean)));
    const chapterLists = await Promise.all(
      subjects.map(async (subject) => {
        const params = new URLSearchParams({
          board: request.board,
          class_level: request.classLevel,
          subject,
        });
        const response = await fetch(`${API_BASE}/catalog/chapters?${params.toString()}`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data.chapters) ? data.chapters.map(String) : [];
      }),
    );
    const chapters = Array.from(new Set(chapterLists.flat()));
    return filterChaptersForSubject(request.subject, chapters);
  } catch {
    return [];
  }
}

export async function fetchRetrievalPreviewViaApi(request: PaperRequest): Promise<RetrievalPreview | null> {
  try {
    const params = new URLSearchParams();
    Object.entries(toBackendRequest(request)).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((item) => params.append(`${key}[]`, String(item)));
      else if (value !== undefined && value !== null && typeof value !== "object") params.set(key, String(value));
    });

    const response = await fetch(`${API_BASE}/retrieval/preview?${params.toString()}`);
    if (!response.ok) return null;
    return normalizeRetrievalPreview(await response.json());
  } catch {
    return null;
  }
}

export async function fetchQuestionBankViaApi(request: Partial<PaperRequest> = {}): Promise<QuestionBankItem[]> {
  try {
    const params = new URLSearchParams();
    if (request.board) params.set("board", request.board);
    if (request.classLevel) params.set("class_level", request.classLevel);
    if (request.subject) params.set("subject", request.subject);
    if (request.chapter) params.set("chapter", request.chapter);
    if (request.topic) params.set("topic", request.topic);

    const response = await fetch(`${API_BASE}/question-bank?${params.toString()}`);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.items) ? data.items.map(normalizeQuestionBankItem) : [];
  } catch {
    return [];
  }
}

export async function saveQuestionToBankViaApi(question: PaperQuestion, request: PaperRequest): Promise<QuestionBankItem | null> {
  try {
    const response = await fetch(`${API_BASE}/question-bank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        board: request.board,
        class_level: request.classLevel,
        subject: request.subject,
        chapter: request.chapter,
        topic: question.topic || request.topic,
        question_type: question.type,
        marks: question.marks,
        difficulty: question.difficulty,
        source: question.source,
        text: question.text,
        rich_text: question.richText,
        answer: question.answer,
        answer_rich_text: question.answerRichText,
        tags: question.tags || [],
        payload: question,
      }),
    });

    if (!response.ok) return null;
    return normalizeQuestionBankItem(await response.json());
  } catch {
    return null;
  }
}

export async function importQuestionFromSourceViaApi(attrs: {
  sourceType: string;
  id: string;
  request: PaperRequest;
}): Promise<PaperQuestion> {
  try {
    const response = await fetch(`${API_BASE}/questions/import-from-source`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_type: attrs.sourceType,
        id: attrs.id,
        request: toBackendRequest(attrs.request),
      }),
    });

    if (!response.ok) throw new Error(await responseErrorMessage(response, "Source import failed"));
    const data = await response.json();
    return normalizeRawQuestion(asRecord(data.question));
  } catch (error) {
    throw error instanceof TypeError ? new Error("Backend unavailable. Start Phoenix and retry import.") : error;
  }
}

export async function importQuestionFromImageViaApi(attrs: {
  fileName: string;
  mimeType: string;
  base64: string;
  request: PaperRequest;
}): Promise<PaperQuestion> {
  try {
    const response = await fetch(`${API_BASE}/questions/import-from-image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_name: attrs.fileName,
        mime_type: attrs.mimeType,
        image_base64: attrs.base64,
        request: toBackendRequest(attrs.request),
      }),
    });

    if (!response.ok) throw new Error(await responseErrorMessage(response, "Image import failed"));
    const data = await response.json();
    return normalizeRawQuestion(asRecord(data.question));
  } catch (error) {
    throw error instanceof TypeError ? new Error("Backend unavailable. Start Phoenix and retry image import.") : error;
  }
}

export async function fetchUsageViaApi(runId?: string): Promise<AiUsageSummary | null> {
  if (!runId) return null;

  try {
    const response = await fetch(`${API_BASE}/generation-runs/${runId}/usage`);
    if (!response.ok) return null;
    const data = await response.json();
    const events: unknown[] = Array.isArray(data.events) ? data.events : [];

    return {
      inputTokens: Number(data.input_tokens ?? 0),
      outputTokens: Number(data.output_tokens ?? 0),
      totalTokens: Number(data.total_tokens ?? 0),
      estimatedCostUsd: Number(data.estimated_cost_usd ?? 0),
      events: events.map((event) => {
        const record = asRecord(event);
        return {
          id: String(record.id ?? ""),
          model: String(record.model ?? ""),
          operation: String(record.operation ?? ""),
          inputTokens: Number(record.input_tokens ?? 0),
          outputTokens: Number(record.output_tokens ?? 0),
          totalTokens: Number(record.total_tokens ?? 0),
          estimatedCostUsd: Number(record.estimated_cost_usd ?? 0),
          insertedAt: record.inserted_at ? String(record.inserted_at) : undefined,
        };
      }),
    };
  } catch {
    return null;
  }
}

export async function exportToClassroomViaApi(paper: Paper, attrs: { courseId: string; attachmentUrl: string; title?: string }) {
  if (!paper.paperId) return null;

  try {
    const response = await fetch(`${API_BASE}/papers/${paper.paperId}/classroom`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        course_id: attrs.courseId,
        attachment_url: attrs.attachmentUrl,
        title: attrs.title || paper.title,
      }),
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function toGenerationPayload(request: PaperRequest) {
  if (request.freePrompt) {
    return {
      mode: "free_prompt",
      free_prompt: request.freePrompt,
      parameters: toBackendRequest(request),
      template: request.template ? toBackendTemplate(request.template) : undefined,
    };
  }

  return {
    mode: "structured",
    parameters: toBackendRequest(request),
    template: request.template ? toBackendTemplate(request.template) : undefined,
  };
}

async function waitForGeneration(runId: string, callbacks: GenerationCallbacks): Promise<GenerationRun> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: Socket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollingStarted = false;
    let pollCount = 0;
    const timeoutTimer = setTimeout(() => finishWithError(new Error("Generation timed out")), 300_000);

    const cleanup = () => {
      settled = true;
      clearTimeout(timeoutTimer);
      if (pollTimer) clearTimeout(pollTimer);
      socket?.disconnect();
    };

    const finish = (run: GenerationRun) => {
      if (settled) return;
      cleanup();
      resolve(run);
    };

    const finishWithError = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const handlePayload = (event: string, payload: Record<string, unknown>) => {
      const run = asRecord(payload.run) as unknown as GenerationRun;

      callbacks.onStatus?.({
        runId,
        status: normalizeRunStatus(String(run.status ?? event)),
        step: String(payload.step ?? event),
        message: String(payload.message ?? "Generation update"),
        progress: Number(payload.progress ?? 20),
      });

      if ((event === "completed" || run.status === "completed") && run.id) finish(run);
      if (event === "failed" || run.status === "failed") {
        finishWithError(new Error(run.warnings?.[0] ?? String(payload.message ?? "Generation failed")));
      }
    };

    const startPolling = () => {
      if (pollingStarted || settled) return;
      pollingStarted = true;

      const poll = async () => {
        if (settled) return;
        try {
          const response = await fetch(`${API_BASE}/generation-runs/${runId}`);
          if (!response.ok) throw new Error(`Polling failed with ${response.status}`);
          const run = (await response.json()) as GenerationRun;

          callbacks.onStatus?.({
            runId,
            status: normalizeRunStatus(run.status),
            step: run.status,
            message: messageForRun(run.status),
            progress: progressForRun(run.status, pollCount),
          });
          pollCount += 1;

          if (run.status === "completed") finish(run);
          else if (run.status === "failed") finishWithError(new Error(run.warnings?.[0] ?? "Generation failed"));
          else pollTimer = setTimeout(poll, 1200);
        } catch (error) {
          if (pollCount > 6) {
            finishWithError(error instanceof Error ? error : new Error("Could not poll generation status"));
            return;
          }
          pollTimer = setTimeout(poll, 1500);
        }
      };

      void poll();
    };

    try {
      socket = new Socket(`${SOCKET_BASE}/socket`, {});
      socket.connect();
      const channel = socket.channel(`generation:${runId}`, {});

      startPolling();

      channel
        .join()
        .receive("ok", (payload: Record<string, unknown>) => {
          handlePayload("snapshot", payload);
        })
        .receive("error", () => startPolling())
        .receive("timeout", () => startPolling());

      channel.on("progress", (payload: Record<string, unknown>) => handlePayload("running", payload));
      channel.on("queued", (payload: Record<string, unknown>) => handlePayload("queued", payload));
      channel.on("completed", (payload: Record<string, unknown>) => handlePayload("completed", payload));
      channel.on("failed", (payload: Record<string, unknown>) => handlePayload("failed", payload));
    } catch {
      startPolling();
    }
  });
}

function normalizeRunStatus(status: string): GenerationStatus["status"] {
  if (status === "queued" || status === "running" || status === "completed" || status === "failed") return status;
  return "running";
}

function sourceSubjectFor(subject: PaperRequest["subject"] | string | undefined) {
  return subject === "Physics" || subject === "Chemistry" || subject === "Biology" ? "Science" : subject || "Maths";
}

function filterChaptersForSubject(subject: PaperRequest["subject"], chapters: string[]) {
  const normalized = subject.toLowerCase();
  const groups: Record<string, string[]> = {
    physics: [
      "Light Reflection And Refraction",
      "The Human Eye And The Colourful World",
      "Electricity",
      "Magnetic Effects Of Electric Current",
    ],
    chemistry: [
      "Chemical Reactions And Equations",
      "Acids Bases And Salts",
      "Metals And Non-Metals",
      "Carbon And Its Compounds",
    ],
    biology: [
      "Life Processes",
      "Control And Coordination",
      "How Do Organisms Reproduce",
      "Heredity",
      "Our Environment",
    ],
  };

  const allowed = groups[normalized];
  if (!allowed) return chapters;

  const chapterSet = new Set(chapters.map((chapter) => chapter.toLowerCase()));
  return allowed.filter((chapter) => chapterSet.has(chapter.toLowerCase()));
}

function messageForRun(status: string) {
  if (status === "queued") return "Generation queued";
  if (status === "running") return "Generating paper variants";
  if (status === "completed") return "Question papers ready";
  if (status === "failed") return "Generation failed";
  return "Generation update";
}

function progressForRun(status: string, pollCount = 0) {
  if (status === "queued") return 5;
  if (status === "running") return Math.min(85, 35 + pollCount * 3);
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  return 20;
}

function toBackendRequest(request: PaperRequest) {
  return {
    board: request.board,
    class_level: request.classLevel,
    subject: sourceSubjectFor(request.subject),
    subject_focus: request.subject,
    chapter: request.chapter,
    chapter_scope: request.chapterScope,
    chapters: request.chapters,
    topic: request.topic,
    source: request.source,
    question_types: request.questionTypes,
    marking_scheme: request.markingScheme,
    difficulty: request.difficulty,
    total_marks: request.totalMarks,
    duration_minutes: request.durationMinutes,
    variant_count: request.variantCount,
    template: request.template ? toBackendTemplate(request.template) : undefined,
  };
}

function normalizePaper(raw: Record<string, unknown>, paperId?: string): Paper {
  const metadata = asRecord(raw.metadata);
  const summary = asRecord(raw.summary);
  const sourceCitations = raw.sourceCitations ?? raw.source_citations;

  return normalizePaperStructure({
    id: String(raw.id ?? crypto.randomUUID()),
    paperId,
    title: String(raw.title ?? "Generated Question Paper"),
    metadata: {
      board: String(metadata.board ?? ""),
      classLevel: String(metadata.classLevel ?? metadata.class_level ?? ""),
      subject: String(metadata.subject ?? ""),
      chapter: String(metadata.chapter ?? ""),
      topic: String(metadata.topic ?? ""),
      durationMinutes: Number(metadata.durationMinutes ?? metadata.duration_minutes ?? 180),
      source: String(metadata.source ?? ""),
      format: metadata.format ? String(metadata.format) : undefined,
      qpCode: metadata.qpCode || metadata.qp_code ? String(metadata.qpCode ?? metadata.qp_code) : undefined,
    },
    summary: {
      totalMarks: Number(summary.totalMarks ?? summary.total_marks ?? 0),
      questionCount: Number(summary.questionCount ?? summary.question_count ?? 0),
      difficulty: String(summary.difficulty ?? ""),
      sourceCoverage: String(summary.sourceCoverage ?? summary.source_coverage ?? ""),
    },
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((section) => {
          const sectionRecord = asRecord(section);
          return {
            id: String(sectionRecord.id ?? crypto.randomUUID()),
            title: String(sectionRecord.title ?? ""),
            instructions: String(sectionRecord.instructions ?? ""),
            difficulty: sectionRecord.difficulty ? String(sectionRecord.difficulty) : undefined,
            targetMarks: sectionRecord.targetMarks || sectionRecord.target_marks ? Number(sectionRecord.targetMarks ?? sectionRecord.target_marks) : undefined,
            questions: Array.isArray(sectionRecord.questions)
              ? sectionRecord.questions.map((question) => normalizeQuestion(asRecord(question)))
              : [],
          };
        })
      : [],
    sets: Array.isArray(raw.sets) ? raw.sets.map((set) => normalizePaper(asRecord(set))) : undefined,
    topicWeightage: normalizeNumberRecord(raw.topicWeightage ?? raw.topic_weightage),
    sourceCitations: Array.isArray(sourceCitations) ? sourceCitations.map(String) : undefined,
    retrievalTrace: raw.retrievalTrace || raw.retrieval_trace ? normalizeRetrievalPreview(raw.retrievalTrace ?? raw.retrieval_trace) : undefined,
    documentStyle: asRecord(raw.documentStyle ?? raw.document_style),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
  });
}

function normalizeQuestion(questionRecord: Record<string, unknown>): PaperQuestion {
  return normalizeRawQuestion(questionRecord);
}

function toBackendPaper(paper: Paper) {
  const normalized = normalizePaperStructure(paper);
  return {
    id: normalized.id,
    title: normalized.title,
    metadata: {
      board: normalized.metadata.board,
      class_level: normalized.metadata.classLevel,
      subject: normalized.metadata.subject,
      chapter: normalized.metadata.chapter,
      topic: normalized.metadata.topic,
      duration_minutes: normalized.metadata.durationMinutes,
      source: normalized.metadata.source,
      format: normalized.metadata.format,
      qp_code: normalized.metadata.qpCode,
    },
    summary: {
      total_marks: normalized.summary.totalMarks,
      question_count: normalized.summary.questionCount,
      difficulty: normalized.summary.difficulty,
      source_coverage: normalized.summary.sourceCoverage,
      model_route: null,
    },
    sections: normalized.sections,
    sets: normalized.sets,
    topic_weightage: normalized.topicWeightage,
    source_citations: normalized.sourceCitations,
    retrieval_trace: normalized.retrievalTrace,
    document_style: normalized.documentStyle,
    warnings: normalized.warnings,
  };
}

function normalizeRetrievalPreview(raw: unknown): RetrievalPreview {
  const record = asRecord(raw);
  return {
    catalog: asRecord(record.catalog),
    ncert: normalizeRetrievalResults(record.ncert),
    pyq: normalizeRetrievalResults(record.pyq),
    questionBank: normalizeRetrievalResults(record.question_bank ?? record.questionBank),
    sectionSources: normalizeSectionSources(record.section_sources ?? record.sectionSources),
    markingScheme: asRecord(record.marking_scheme ?? record.markingScheme),
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : [],
  };
}

function normalizeRetrievalResults(value: unknown): RetrievalResult[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const record = asRecord(item);
    const metadata = asRecord(record.metadata ?? record.catalog);
    const signals = asRecord(record.signals);

    return {
      id: String(record.id ?? record.chunk_id ?? ""),
      sourceType: String(record.source_type ?? record.sourceType ?? "source"),
      title: String(record.title ?? record.citation ?? "Source result"),
      excerpt: String(record.excerpt ?? record.content_excerpt ?? record.text ?? ""),
      citation: record.citation ? String(record.citation) : undefined,
      marks: record.marks || signals.marks ? Number(record.marks ?? signals.marks) : undefined,
      difficulty: record.difficulty ? String(record.difficulty) : undefined,
      questionType: record.question_type || signals.probable_question_type ? String(record.question_type ?? signals.probable_question_type) : undefined,
      chapter: metadata.chapter ? String(metadata.chapter) : undefined,
      topic: metadata.topic ? String(metadata.topic) : undefined,
      sectionLabel: metadata.section_label || signals.section_label ? String(metadata.section_label ?? signals.section_label) : undefined,
      sectionType: metadata.section_type ? String(metadata.section_type) : undefined,
    };
  });
}

function normalizeSectionSources(value: unknown): RetrievalPreview["sectionSources"] {
  const record = asRecord(value);
  const chapters = Array.isArray(record.chapters) ? record.chapters : [];

  if (chapters.length === 0) return undefined;

  return {
    ncertCount: Number(record.ncert_count ?? record.ncertCount ?? 0),
    pyqCount: Number(record.pyq_count ?? record.pyqCount ?? 0),
    chapters: chapters.map((chapter) => {
      const chapterRecord = asRecord(chapter);
      const sections = Array.isArray(chapterRecord.sections) ? chapterRecord.sections : [];

      return {
        name: String(chapterRecord.name ?? "Chapter"),
        position: chapterRecord.position === undefined ? undefined : Number(chapterRecord.position),
        sections: sections.map((section) => {
          const sectionRecord = asRecord(section);

          return {
            name: String(sectionRecord.name ?? "Direct questions"),
            sectionType: sectionRecord.section_type || sectionRecord.sectionType ? String(sectionRecord.section_type ?? sectionRecord.sectionType) : undefined,
            ncert: normalizeRetrievalResults(sectionRecord.ncert),
            pyq: normalizeRetrievalResults(sectionRecord.pyq),
          };
        }),
      };
    }),
  };
}

function normalizeQuestionBankItem(raw: unknown): QuestionBankItem {
  const record = asRecord(raw);

  return {
    id: String(record.id ?? ""),
    text: String(record.text ?? ""),
    richText: record.rich_text || record.richText ? String(record.rich_text ?? record.richText) : undefined,
    answer: record.answer ? String(record.answer) : undefined,
    answerRichText: record.answer_rich_text || record.answerRichText ? String(record.answer_rich_text ?? record.answerRichText) : undefined,
    board: record.board ? String(record.board) : undefined,
    classLevel: record.class_level || record.classLevel ? String(record.class_level ?? record.classLevel) : undefined,
    subject: record.subject ? String(record.subject) : undefined,
    chapter: record.chapter ? String(record.chapter) : undefined,
    topic: record.topic ? String(record.topic) : undefined,
    questionType: record.question_type || record.questionType ? String(record.question_type ?? record.questionType) : undefined,
    marks: record.marks === undefined ? undefined : Number(record.marks),
    difficulty: record.difficulty ? String(record.difficulty) : undefined,
    source: record.source ? String(record.source) : undefined,
    tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
    payload: asRecord(record.payload),
  };
}

function normalizeNumberRecord(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  const entries = Object.entries(record);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, item]) => [key, Number(item)]));
}

function normalizeDashboard(raw: unknown): DashboardSummary {
  const record = asRecord(raw);
  const counts = asRecord(record.counts);

  return {
    counts: {
      papers: Number(counts.papers ?? 0),
      templates: Number(counts.templates ?? 0),
      generationRuns: Number(counts.generation_runs ?? counts.generationRuns ?? 0),
      completedRuns: Number(counts.completed_runs ?? counts.completedRuns ?? 0),
      ncertQuestions: Number(counts.ncert_questions ?? counts.ncertQuestions ?? 0),
      pyqQuestions: Number(counts.pyq_questions ?? counts.pyqQuestions ?? 0),
      questionBankItems: Number(counts.question_bank_items ?? counts.questionBankItems ?? 0),
      chapters: Number(counts.chapters ?? 0),
    },
    recentPapers: normalizeDashboardArray(record.recent_papers ?? record.recentPapers).map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.title ?? "Untitled paper"),
      board: String(item.board ?? ""),
      classLevel: String(item.class_level ?? item.classLevel ?? ""),
      subject: String(item.subject ?? ""),
      status: String(item.status ?? ""),
      versionCount: Number(item.version_count ?? item.versionCount ?? 0),
      marksTotal: Number(item.marks_total ?? item.marksTotal ?? 0),
      updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    })),
    recentRuns: normalizeDashboardArray(record.recent_runs ?? record.recentRuns).map((item) => ({
      id: String(item.id ?? ""),
      status: String(item.status ?? ""),
      request: asRecord(item.request),
      insertedAt: item.inserted_at ? String(item.inserted_at) : undefined,
    })),
    templates: normalizeDashboardArray(record.templates).map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? "Untitled template"),
      description: item.description ? String(item.description) : undefined,
      payload: asRecord(item.payload),
      formatting: asRecord(item.formatting),
      inferredParams: asRecord(item.inferred_params ?? item.inferredParams),
      updatedAt: item.updated_at ? String(item.updated_at) : undefined,
    })),
    chapterCoverage: normalizeDashboardArray(record.chapter_coverage ?? record.chapterCoverage).map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? "Chapter"),
      position: item.position === undefined || item.position === null ? undefined : Number(item.position),
      ncertCount: Number(item.ncert_count ?? item.ncertCount ?? 0),
      pyqCount: Number(item.pyq_count ?? item.pyqCount ?? 0),
      bankCount: Number(item.bank_count ?? item.bankCount ?? 0),
      totalSources: Number(item.total_sources ?? item.totalSources ?? 0),
      coverageScore: Number(item.coverage_score ?? item.coverageScore ?? 0),
    })),
    difficultyDistribution: normalizeDashboardArray(record.difficulty_distribution ?? record.difficultyDistribution).map((item) => ({
      difficulty: String(item.difficulty ?? "Unknown"),
      count: Number(item.count ?? 0),
    })),
    sourceMix: normalizeDashboardArray(record.source_mix ?? record.sourceMix).map((item) => ({
      source: String(item.source ?? "Source"),
      count: Number(item.count ?? 0),
    })),
  };
}

function normalizeDashboardArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function toBackendTemplate(template: NonNullable<PaperRequest["template"]>) {
  return {
    name: template.name,
    description: template.description,
    instructions: template.instructions,
    sections: template.sections,
    inferred_params: template.inferredParams,
    formatting: template.formatting,
    layout_notes: template.layoutNotes,
    image_notes: template.imageNotes,
    marking_scheme_position: template.markingSchemePosition,
    answer_key_position: template.answerKeyPosition,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function responseErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json();
    const record = asRecord(body);
    const detail = record.error ?? record.message ?? record.reason;
    return detail ? `${fallback}: ${String(detail)}` : `${fallback} with ${response.status}`;
  } catch {
    try {
      const text = await response.text();
      return text ? `${fallback}: ${text}` : `${fallback} with ${response.status}`;
    } catch {
      return `${fallback} with ${response.status}`;
    }
  }
}
