import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Download,
  FileText,
  ArrowRight,
  Bookmark,
  Check,
  LayoutDashboard,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { PaperEditor } from "@/features/editor/paper-editor";
import {
  activateRichTextEditorFromElement,
  commandActiveRichTextEditor,
  insertIntoActiveRichTextEditor,
  MathToolkitInsert,
  openMathLiveEditorForActiveRichTextEditor,
} from "@/features/editor/rich-text-editor";
import { insertIntoActiveMathBoxField } from "@/features/editor/math-live-box";
import {
  fetchChaptersViaApi,
  fetchDashboardViaApi,
  fetchQuestionBankViaApi,
  fetchRetrievalPreviewViaApi,
  fetchSubjectsViaApi,
  fetchUsageViaApi,
  generateViaApi,
  getPaperViaApi,
  getStructuredPaperViaApi,
  importQuestionFromImageViaApi,
  importQuestionFromSourceViaApi,
  refineViaApi,
  saveQuestionToBankViaApi,
  saveVersionViaApi,
  uploadImageAssetViaApi,
} from "@/api";
import { defaultRequest, requestFromPrompt } from "@/lib/request-defaults";
import { normalizePaperStructure, normalizeRawQuestion, richTextFromText } from "@/lib/normalize-paper-structure";
import { calculateSourceMix, choiceHasContent, countedQuestionMarks, countedSectionMarks, escapeAttribute, escapeHtml, normalizeLatexChars, questionWithComputedMarks, unescapeHtml } from "@/lib/paper-utils";
import {
  AiUsageSummary,
  CatalogSubject,
  DashboardSummary,
  DirectSourceMix,
  DocumentStyle,
  GenerationStatus,
  Paper,
  PaperImageAsset,
  PaperQuestion,
  PaperQuestionOption,
  PaperSection,
  PaperRequest,
  PaperSubpart,
  PaperTemplate,
  PaperVersion,
  QuestionBankItem,
  RetrievalPreview,
  RetrievalResult,
  SectionBlueprint,
  SourceAvailability,
} from "@/lib/types";
import s from "./studio-app.module.css";

type Mode = "structured" | "prompt";
type RightPanel = "chat" | "retrieval";
type AppView = "studio" | "library" | "analytics" | "templates";
type CreateFlow = "choose" | "params" | "prompt" | null;
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const emptyStatus: GenerationStatus = {
  status: "idle",
  step: "idle",
  message: "Ready",
  progress: 0,
};

const defaultDocumentStyle: DocumentStyle = {
  margin: 42,
  lineHeight: 1.35,
  fontSize: 11,
  textColor: "#111827",
  accentColor: "#1a4799",
  pageColor: "#ffffff",
  watermark: undefined,
};

const questionTypeOptions = ["MCQ", "Fill in the Blanks", "True/False", "Very Short Answer", "Short Answer", "Long Answer", "Case Study"];
const difficultyPresets = {
  Easy: { easy: 80, medium: 20, hard: 0 },
  Medium: { easy: 20, medium: 60, hard: 20 },
  Hard: { easy: 20, medium: 40, hard: 40 },
  Mixed: { easy: 34, medium: 33, hard: 33 },
} as const;

const sourceMixPresets: Record<PaperRequest["source"], DirectSourceMix> = {
  NCERT: { ncertDirect: 70, pyqDirect: 0, questionBank: 0, aiGenerated: 30 },
  PYQ: { ncertDirect: 0, pyqDirect: 70, questionBank: 0, aiGenerated: 30 },
  "NCERT + PYQ": { ncertDirect: 40, pyqDirect: 30, questionBank: 0, aiGenerated: 30 },
};

export function StudioApp() {
  const [appView, setAppView] = useState<AppView>("studio");
  const [mode, setMode] = useState<Mode>("structured");
  const [rightPanel, setRightPanel] = useState<RightPanel>("chat");
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [createFlow, setCreateFlow] = useState<CreateFlow>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [request, setRequest] = useState<PaperRequest>({
    ...defaultRequest,
    chapter: "Quadratic Equations",
    chapterScope: "single",
    chapters: ["Quadratic Equations"],
    topic: "Quadratic Equations",
    totalMarks: 50,
    durationMinutes: 120,
    variantCount: 1,
    questionTypes: ["MCQ", "Short Answer", "Long Answer"],
    sectionBlueprint: [],
    difficultyMix: difficultyPresets.Medium,
    directSourceMix: sourceMixPresets["NCERT + PYQ"],
    sourceWeights: sourceMixPresets["NCERT + PYQ"],
    sourceWeightsNormalized: false,
    provider: "gemini",
  });
  const [prompt, setPrompt] = useState("CBSE class 10 maths 50 marks from Quadratic Equations using NCERT and PYQ format");
  const [availableChapters, setAvailableChapters] = useState<string[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<CatalogSubject[]>([]);
  const [documentStyle, setDocumentStyle] = useState<DocumentStyle>(defaultDocumentStyle);
  const [openPapers, setOpenPapers] = useState<Paper[]>([]);
  const [variantPapers, setVariantPapers] = useState<Paper[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [versions, setVersions] = useState<PaperVersion[]>([]);
  const [retrievalPreview, setRetrievalPreview] = useState<RetrievalPreview | null>(null);
  const [questionBank, setQuestionBank] = useState<QuestionBankItem[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [lastRunId, setLastRunId] = useState<string | undefined>();
  const [status, setStatus] = useState<GenerationStatus>(emptyStatus);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string; tone: "info" | "error" }[]>([]);
  // #173: stack of up to 5 pre-AI snapshots; last entry is most recent
  const [undoStack, setUndoStack] = useState<Paper[]>([]);
  // #170: synchronous in-flight guard — prevents concurrent AI requests from
  // bypassing the isChatting state check before the first React re-render
  const aiInFlightRef = useRef(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Generate a paper first. Then use question controls or ask me to replace, rebalance, format, or move content.",
    },
  ]);

  const requestPreview = useMemo(() => (mode === "prompt" ? requestFromPrompt(prompt) : request), [mode, prompt, request]);

  useEffect(() => {
    let cancelled = false;

    void fetchSubjectsViaApi({
      board: request.board,
      classLevel: request.classLevel,
    }).then((subjects) => {
      if (cancelled) return;
      setAvailableSubjects(subjects);

      setRequest((current) => {
        if (subjects.length === 0 || subjects.some((subject) => sameSubjectValue(subject.value, current.subject))) return current;
        const firstSubject = subjects[0];

        return {
          ...current,
          subject: firstSubject.value,
          chapter: "",
          chapters: [],
          topic: "",
          chapterScope: "single",
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [request.board, request.classLevel]);

  useEffect(() => {
    let cancelled = false;

    void fetchChaptersViaApi({
      board: request.board,
      classLevel: request.classLevel,
      subject: request.subject,
    }).then((chapters) => {
      if (!cancelled) setAvailableChapters(chapters);
    });

    return () => {
      cancelled = true;
    };
  }, [request.board, request.classLevel, request.subject]);

  useEffect(() => {
    void refreshQuestionBank();
    void refreshRetrievalPreview();
    void refreshDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.board, request.classLevel, request.subject, request.chapter, request.topic, request.chapterScope, request.chapters.join("|")]);

  const updateRequest = <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => {
    setRequest((current) => ({ ...current, [key]: value }));
  };

  const toggleQuestionType = (questionType: string) => {
    setRequest((current) => {
      const exists = current.questionTypes.includes(questionType);
      const nextTypes = exists ? current.questionTypes.filter((item) => item !== questionType) : [...current.questionTypes, questionType];
      return { ...current, questionTypes: nextTypes.length > 0 ? nextTypes : [questionType] };
    });
  };

  function applyDashboardTemplate(template: DashboardSummary["templates"][number]) {
    const paperTemplate = dashboardTemplateToPaperTemplate(template);
    const formatting = paperTemplate.formatting ?? {};

    setRequest((current) => ({
      ...current,
      ...paperTemplate.inferredParams,
      template: paperTemplate,
    }));
    setDocumentStyle((current) => ({ ...current, ...formatting }));
    setSelectedPaper((current) => (current ? applyTemplateToExistingPaper(current, paperTemplate) : current));
    setOpenPapers((papers) => papers.map((paper) => applyTemplateToExistingPaper(paper, paperTemplate)));
    setVariantPapers((papers) => papers.map((paper) => applyTemplateToExistingPaper(paper, paperTemplate)));
    addAssistantMessage(`Template selected: ${template.name}`);
  }

  async function refreshRetrievalPreview(nextRequest = requestPreview) {
    const preview = await fetchRetrievalPreviewViaApi(nextRequest);
    setRetrievalPreview(preview);
    reconcileRequestWithAvailability(preview?.availability);
  }

  function reconcileRequestWithAvailability(availability?: SourceAvailability) {
    if (!availability) return;

    setRequest((current) => {
      const hasNcert = availability.totals.ncert > 0;
      const hasPyq = availability.totals.pyq > 0;
      const availableBooks = new Set(availability.books.flatMap((book) => [book.sourceGroup, book.title].filter(Boolean)));
      const availableCategories = new Set(availability.categories.map((category) => category.category));
      let source = current.source;

      if (source === "PYQ" && !hasPyq && hasNcert) source = "NCERT";
      if (source === "NCERT" && !hasNcert && hasPyq) source = "PYQ";
      if (source === "NCERT + PYQ" && (!hasNcert || !hasPyq)) source = hasNcert ? "NCERT" : hasPyq ? "PYQ" : source;

      const nextSourceBooks = (current.sourceBooks ?? []).filter((book) => availableBooks.has(book));
      const nextSourceCategories = (current.sourceCategories ?? []).filter((category) => availableCategories.has(category));
      const changed =
        source !== current.source ||
        nextSourceBooks.length !== (current.sourceBooks ?? []).length ||
        nextSourceCategories.length !== (current.sourceCategories ?? []).length;

      if (!changed) return current;

      return {
        ...current,
        source,
        sourceBooks: source === current.source ? nextSourceBooks : [],
        sourceCategories: source === current.source ? nextSourceCategories : [],
        directSourceMix: source === current.source ? current.directSourceMix : sourceMixPresets[source],
      };
    });
  }

  async function refreshQuestionBank() {
    const items = await fetchQuestionBankViaApi(request);
    setQuestionBank(items);
  }

  async function refreshDashboard() {
    setDashboard(await fetchDashboardViaApi());
  }

  function samePaper(left: Paper, right: Paper) {
    return left.id === right.id || Boolean(left.paperId && right.paperId && left.paperId === right.paperId);
  }

  function mergeOpenPapers(current: Paper[], incoming: Paper[]) {
    return incoming.reduce((papers, paper) => {
      const normalized = applyDocumentStyle(recalculatePaper(normalizePaperStructure(paper)), { ...documentStyle, ...paper.documentStyle });
      const exists = papers.some((item) => samePaper(item, normalized));

      if (exists) {
        return papers.map((item) => (samePaper(item, normalized) ? normalized : item));
      }

      return [...papers, normalized];
    }, current);
  }

  function activatePaper(paper: Paper) {
    const normalized = applyDocumentStyle(recalculatePaper(normalizePaperStructure(paper)), { ...documentStyle, ...paper.documentStyle });
    setSelectedPaper(normalized);
    setOpenPapers((papers) => mergeOpenPapers(papers, [normalized]));
    setDocumentStyle((current) => ({ ...current, ...normalized.documentStyle }));
  }

  async function switchOpenPaper(paper: Paper) {
    activatePaper(paper);
    await refreshVersions(paper.paperId);
  }

  async function runGeneration() {
    if (isGenerating) return;

    const nextRequest = finalizeGenerationRequest(mode === "prompt" ? requestFromPrompt(prompt) : request);
    setVariantPapers([]);
    setUsage(null);
    setLastError(null);
    setIsGenerating(true);
    setStatus({ status: "queued", step: "queued", message: "Starting generation", progress: 3 });
    addUserMessage(mode === "prompt" ? prompt : describeRequest(nextRequest));
    addAssistantMessage("Working from owned NCERT/PYQ context. I will create structured paper cards, not placeholder text.");

    try {
      let activeRunId: string | undefined;
      const papers = await generateViaApi(nextRequest, {
        onStatus: (nextStatus) => {
          if (nextStatus.runId) {
            activeRunId = nextStatus.runId;
            setLastRunId(nextStatus.runId);
          }
          setStatus(nextStatus);
        },
      });
      const normalizedPapers = papers.map((paper) => applyDocumentStyle(recalculatePaper(paper), documentStyle));
      const paper = normalizedPapers[0];
      setVariantPapers(normalizedPapers);
      setOpenPapers((current) => mergeOpenPapers(current, normalizedPapers));
      if (paper) activatePaper(paper);
      await refreshVersions(paper?.paperId);
      await refreshRetrievalPreview(nextRequest);
      setUsage(await fetchUsageViaApi(activeRunId ?? lastRunId));
      setStatus({ status: "completed", step: "completed", message: "Paper ready", progress: 100 });
      addAssistantMessage(`Done. ${normalizedPapers.length} set${normalizedPapers.length === 1 ? "" : "s"} generated with editable questions.`);
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      setStatus({ status: "failed", step: "failed", message, progress: 100 });
      addAssistantMessage(`Generation failed: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function selectVariant(paper: Paper) {
    activatePaper(paper);
    await refreshVersions(paper.paperId);
  }

  async function refreshVersions(paperId?: string) {
    if (!paperId) {
      setVersions([]);
      return;
    }

    const paper = await getPaperViaApi(paperId);
    setVersions(paper?.versions ?? []);
  }

  async function loadPaperFromLibrary(paperId: string) {
    const structured = await getStructuredPaperViaApi(paperId);
    const paper = structured?.paper ? null : await getPaperViaApi(paperId);
    const latestVersion = structured?.version ?? paper?.versions?.[0];

    if (!structured?.paper && !latestVersion) {
      addAssistantMessage("I could not load that paper. It has no saved version payload yet.");
      return;
    }

    const restored = structured?.paper ?? normalizeVersionPayload(latestVersion?.payload ?? {}, paperId);
    const mergedStyle = { ...documentStyle, ...restored.documentStyle };
    activatePaper(applyDocumentStyle(restored, mergedStyle));
    setDocumentStyle(mergedStyle);
    await refreshVersions(paperId);
    addAssistantMessage(`Loaded ${restored.title} from the library.`);
  }

  function stopGeneration() {
    setIsGenerating(false);
    setStatus({ status: "idle", step: "stopped", message: "Stopped locally", progress: 0 });
  }

  function updateSelectedPaper(paper: Paper) {
    const styledPaper = applyDocumentStyle(recalculatePaper(normalizePaperStructure(paper)), documentStyle);
    setSelectedPaper(styledPaper);
    setOpenPapers((papers) => mergeOpenPapers(papers, [styledPaper]));
    setVariantPapers((papers) => papers.map((item) => (item.id === styledPaper.id ? styledPaper : item)));
  }

  async function askAi(instructionOverride?: string) {
    const instruction = (instructionOverride ?? chatInput).trim();
    // #170: synchronous ref guard prevents concurrent requests even before React re-renders
    if (!instruction || isChatting || aiInFlightRef.current) return;

    // #202: strip HTML tags to prevent XSS-style injection via chat input
    const cleanInstruction = instruction.replace(/<[^>]*>/g, "").replace(/&(?:lt|gt|amp|quot|#\d+);/g, "").trim();

    setChatInput("");
    addUserMessage(instruction);

    if (!selectedPaper) {
      addAssistantMessage("Generate a paper first, then I can edit it.");
      return;
    }

    // #235: intercept "undo" before sending to AI
    if (/^\s*undo\s*$/i.test(cleanInstruction)) {
      if (undoStack.length > 0) {
        const prev = undoStack[undoStack.length - 1];
        setUndoStack((stack) => stack.slice(0, -1));
        updateSelectedPaper(prev);
        addAssistantMessage("Reverted the last AI edit.");
      } else {
        addAssistantMessage("Nothing to undo. The Undo button appears after an AI edit is applied.");
      }
      return;
    }

    // #171: catch question-targeted commands on an empty paper
    const totalQuestions = selectedPaper.sections.reduce((t, s) => t + s.questions.length, 0);
    if (totalQuestions === 0 && /\b(?:q|ques|question)\s*\d+\b/i.test(cleanInstruction)) {
      addAssistantMessage("This paper has no questions yet. Add a blank question or generate content first.");
      return;
    }

    // #195: cap unreasonably large bulk-generation requests
    const bulkMatch = /\b(?:add|generate|create)\s+(\d+)\s+(?:questions?|q\b)/i.exec(cleanInstruction);
    if (bulkMatch && Number(bulkMatch[1]) > 20) {
      addAssistantMessage(`Adding ${bulkMatch[1]} questions at once is too large. Try a batch of up to 20 and repeat.`);
      return;
    }

    if (isImageImportCommand(cleanInstruction)) {
      const section = findSectionForChatCommand(selectedPaper, cleanInstruction);
      if (!section) {
        addAssistantMessage("I could not find a section for the image import.");
        return;
      }

      await importQuestionImage(section.id);
      addAssistantMessage(`Choose an image to import into ${section.title}.`);
      return;
    }

    const command = applyChatPaperCommand(selectedPaper, cleanInstruction, documentStyle);
    if (command.handled) {
      // #176/#173: only push undo snapshot when the paper actually changed
      if (command.paper !== selectedPaper) setUndoStack((stack) => [...stack.slice(-4), selectedPaper]);
      const nextPaper = applyDocumentStyle(recalculatePaper(command.paper), documentStyle);
      if (command.bankQuestion) {
        await saveQuestionToBankViaApi(command.bankQuestion, request);
        await refreshQuestionBank();
      }
      updateSelectedPaper(nextPaper);
      if (!command.skipVersion) {
        await saveVersionViaApi(nextPaper, command.versionLabel ?? "chat_structured_edit");
        await refreshVersions(nextPaper.paperId);
      }
      setStatus({ status: "completed", step: "chat_edit", message: "Structured edit applied", progress: 100 });
      addAssistantMessage(command.toolName ? `Tool ${command.toolName}: ${command.message}` : command.message);
      return;
    }

    // #227: intercept "generate N questions from topic" — route to generation API, not refinement
    const genCmd = parseGenerateQuestionsCommand(cleanInstruction);
    if (genCmd) {
      const { count, questionType, topic } = genCmd;
      const typeLabel = questionType ?? "question";
      const typePlural = questionType ? `${questionType} question` : "question";
      const genPrompt = [
        `Generate exactly ${count} ${typePlural}${count !== 1 ? "s" : ""} about "${topic}".`,
        questionType === "MCQ" ? "Each MCQ must have exactly 4 options labeled A, B, C, D with one correct answer indicated." : "",
        "Use clear, exam-appropriate language.",
      ].filter(Boolean).join(" ");

      aiInFlightRef.current = true;
      setIsChatting(true);
      setStatus({ status: "running", step: "generating", message: `Generating ${count} ${typeLabel}${count !== 1 ? "s" : ""}…`, progress: 40 });

      try {
        const genRequest = finalizeGenerationRequest({ ...request, freePrompt: genPrompt, variantCount: 1 });
        const papers = await generateViaApi(genRequest, { onStatus: (s) => setStatus(s) });
        const generated = papers[0];
        if (!generated) throw new Error("No questions were generated.");

        const newQuestions = generated.sections.flatMap((s) => s.questions).slice(0, count);
        if (newQuestions.length === 0) throw new Error("The generator returned no questions.");

        setUndoStack((stack) => [...stack.slice(-4), selectedPaper]);
        let nextSections;
        if (selectedPaper.sections.length > 0) {
          const lastIdx = selectedPaper.sections.length - 1;
          nextSections = selectedPaper.sections.map((s, i) =>
            i === lastIdx ? { ...s, questions: [...s.questions, ...newQuestions] } : s,
          );
        } else {
          nextSections = [{ id: crypto.randomUUID(), title: "Section A", instructions: "", questions: newQuestions }];
        }
        const nextPaper = applyDocumentStyle(recalculatePaper({ ...selectedPaper, sections: nextSections }), documentStyle);
        updateSelectedPaper(nextPaper);
        await saveVersionViaApi(nextPaper, "chat_generate_questions");
        await refreshVersions(nextPaper.paperId);
        setStatus({ status: "completed", step: "generated", message: "Questions added", progress: 100 });
        addAssistantMessage(
          `Added ${newQuestions.length} ${typeLabel}${newQuestions.length !== 1 ? "s" : ""} about "${topic}" to the paper.`,
        );
      } catch (error) {
        const message = getErrorMessage(error);
        setLastError(message);
        setStatus({ status: "failed", step: "generate_failed", message, progress: 100 });
        addAssistantMessage(`I couldn't generate those questions: ${message}`);
      } finally {
        setIsChatting(false);
        aiInFlightRef.current = false;
      }
      return;
    }

    const refinementInstruction = command.providerInstruction ?? buildTargetedRefinementInstruction(selectedPaper, cleanInstruction);

    aiInFlightRef.current = true;
    setIsChatting(true);
    setStatus({ status: "running", step: "refining", message: "Applying refinement", progress: 65 });

    try {
      const refinement = await refineViaApi(selectedPaper, refinementInstruction);
      const currentQuestionCount = selectedPaper.sections.reduce((t, s) => t + s.questions.length, 0);
      const nextQuestionCount = refinement.preview.sections.reduce((t, s) => t + s.questions.length, 0);
      const willClearAll = nextQuestionCount === 0 && currentQuestionCount > 0;
      // #176/#173: push undo snapshot before applying AI change
      setUndoStack((stack) => [...stack.slice(-4), selectedPaper]);
      if (willClearAll) {
        pushToast("Heads up: this refinement removed all questions. Use Undo to restore them.", "error");
      }
      // Empty patchOps + empty message = backend rescue (AI error) — silently abort, no UI change
      if ((!refinement.patchOps || refinement.patchOps.length === 0) && !refinement.message) {
        setStatus({ status: "completed", step: "refined", message: "No changes", progress: 100 });
        return;
      }
      const nextPaper = applyDocumentStyle(recalculatePaper(refinement.preview), documentStyle);
      updateSelectedPaper(nextPaper);
      await saveVersionViaApi(nextPaper, "ai_refinement");
      await refreshVersions(nextPaper.paperId);
      setStatus({ status: "completed", step: "refined", message: "Refinement applied", progress: 100 });
      addAssistantMessage(refinement.message || "Applied the refinement.");
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      setStatus({ status: "failed", step: "refine_failed", message, progress: 100 });
      addAssistantMessage(`I could not apply that refinement: ${message}`);
    } finally {
      setIsChatting(false);
      aiInFlightRef.current = false;
    }
  }

  async function replaceQuestionWithAi(sectionId: string, questionId: string, questionNumber: number, instructionOverride?: string) {
    const section = selectedPaper?.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);

    await askAi(
      [
        `Replace global question ${questionNumber} in ${section?.title ?? "the paper"}.`,
        `Question id: ${questionId}.`,
        `Current question: ${question?.text ?? ""}`,
        `Preserve ${question?.marks ?? "the same"} marks, ${question?.type ?? "same"} type, ${question?.difficulty ?? "same"} difficulty, and the paper total.`,
        instructionOverride ? `Teacher instruction: ${instructionOverride}` : "",
        "Generate a genuinely different valid question from the selected chapters using owned NCERT/PYQ context.",
      ].filter(Boolean).join("\n"),
    );
  }

  async function replaceOptionalChoiceWithAi(sectionId: string, questionId: string, questionNumber: number, instructionOverride?: string) {
    const section = selectedPaper?.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);

    await askAi(
      [
        `Replace the OR internal choice of global question ${questionNumber} in ${section?.title ?? "the paper"}.`,
        `Question id: ${questionId}.`,
        `Main question: ${question?.text ?? ""}`,
        `Current OR choice: ${question?.optionalChoice?.text ?? ""}`,
        `Preserve ${question?.marks ?? "the same"} marks, ${question?.type ?? "same"} type, ${question?.difficulty ?? "same"} difficulty, and the paper total.`,
        instructionOverride ? `Teacher instruction: ${instructionOverride}` : "",
        "Only change the optionalChoice branch, not the main question.",
      ].filter(Boolean).join("\n"),
    );
  }

  async function saveCurrentVersion() {
    if (!selectedPaper?.paperId) {
      addAssistantMessage("Generate or select a saved paper before saving a version.");
      return;
    }
    const totalQuestions = selectedPaper.sections.reduce((t, s) => t + s.questions.length, 0);
    if (totalQuestions === 0) {
      addAssistantMessage("Add at least one question before saving a version.");
      return;
    }
    if (isSavingVersion) return;
    setIsSavingVersion(true);

    try {
      const saved = await saveVersionViaApi(applyDocumentStyle(selectedPaper, documentStyle), "manual_structured_edit");

      if (!saved) {
        addAssistantMessage("Could not save this version. Check that Phoenix is running.");
        return;
      }

      const savedRecord = saved as Record<string, unknown>;
      const newVersion: PaperVersion = {
        id: String(savedRecord.id ?? crypto.randomUUID()),
        versionNumber: Number(savedRecord.version_number ?? savedRecord.versionNumber ?? (versions[0]?.versionNumber ?? 0) + 1),
        changeSource: "manual_structured_edit",
        payload: {},
        marksTotal: savedRecord.marks_total === undefined ? undefined : Number(savedRecord.marks_total),
        insertedAt: savedRecord.inserted_at ? String(savedRecord.inserted_at) : undefined,
      };
      setVersions((current) => [newVersion, ...current.filter((v) => v.id !== newVersion.id)]);
      addAssistantMessage(`Saved structured version ${newVersion.versionNumber}.`);
    } finally {
      setIsSavingVersion(false);
    }
  }

  async function restoreVersion(version: PaperVersion) {
    const restored = normalizeVersionPayload(version.payload, selectedPaper?.paperId);
    activatePaper(restored);
    setDocumentStyle((current) => ({ ...current, ...restored.documentStyle }));
    addAssistantMessage(`Restored version ${version.versionNumber}.`);
  }

  async function saveQuestionToBank(question: PaperQuestion) {
    const saved = await saveQuestionToBankViaApi(question, request);

    if (!saved) {
      addAssistantMessage("Could not save this question to the bank.");
      return;
    }

    await refreshQuestionBank();
    addAssistantMessage("Saved question to your reusable question bank.");
  }

  async function importSourceQuestion(result: RetrievalResult) {
    try {
      const importRequest = mode === "prompt" ? requestPreview : request;
      const imported = await importQuestionFromSourceViaApi({
        sourceType: result.sourceType,
        id: result.id,
        request: importRequest,
      });
      const sourceType = result.sourceType.toLowerCase();
      const importedWithSource = {
        ...imported,
        generationMode: sourceType.includes("pyq") ? "direct_pyq" : "direct_ncert",
        sourceCitations: imported.sourceCitations ?? (result.citation ? [result.citation] : undefined),
      } satisfies PaperQuestion;

      const basePaper = selectedPaper ?? createDraftPaper(importRequest, documentStyle);
      updateSelectedPaper(appendQuestionToPaper(basePaper, importedWithSource));
      setLastError(null);
      addAssistantMessage(selectedPaper ? "Imported source content as an editable question. Please review it before export." : "Created a draft paper and imported the source question.");
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      setStatus({ status: "failed", step: "import_failed", message, progress: 100 });
      addAssistantMessage(`Import failed: ${message}`);
    }
  }

  async function importBankQuestion(item: QuestionBankItem) {
    const basePaper = selectedPaper ?? createDraftPaper(requestPreview, documentStyle);

    updateSelectedPaper(appendQuestionToPaper(basePaper, {
      id: crypto.randomUUID(),
      text: item.text,
      richText: item.richText,
      marks: item.marks ?? 1,
      type: item.questionType ?? "SA",
      difficulty: item.difficulty ?? "Medium",
      source: item.source ?? "Question bank",
      generationMode: "question_bank",
      topic: item.topic,
      answer: item.answer ?? "",
      answerRichText: item.answerRichText,
      tags: item.tags,
    }));
    addAssistantMessage(selectedPaper ? "Inserted question from the question bank." : "Created a draft paper and inserted the bank question.");
  }

  async function importQuestionImage(sectionId: string) {
    if (!selectedPaper) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setStatus({ status: "running", step: "image_import", message: "Extracting question from image", progress: 45 });
      try {
        const imported = await importQuestionFromImageViaApi({
          fileName: file.name,
          mimeType: file.type,
          base64: await fileToBase64(file),
          request,
        });

        appendQuestion(imported, sectionId);
        setLastError(null);
        setStatus({ status: "completed", step: "image_imported", message: "Question imported", progress: 100 });
        addAssistantMessage("Extracted an editable question from the image. Please review it.");
      } catch (error) {
        const message = getErrorMessage(error);
        setLastError(message);
        setStatus({ status: "failed", step: "image_import_failed", message, progress: 100 });
        addAssistantMessage(`Image import failed: ${message}`);
      }
    };
    input.click();
  }

  async function uploadEditorImage(file: File): Promise<PaperImageAsset> {
    try {
      const asset = await uploadImageAssetViaApi(file);
      setLastError(null);
      addAssistantMessage("Attached the image to the selected question block.");
      return asset;
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      addAssistantMessage(`Image upload failed: ${message}`);
      throw error;
    }
  }

  function appendQuestion(question: PaperQuestion, sectionId?: string) {
    if (!selectedPaper) return;
    updateSelectedPaper(appendQuestionToPaper(selectedPaper, question, sectionId));
  }

  async function exportCurrent(format: "pdf" | "docx") {
    if (!selectedPaper) {
      addAssistantMessage("There is no paper to download yet.");
      return;
    }

    const html = paperToHtml(applyDocumentStyle(selectedPaper, documentStyle), documentStyle);

    if (format === "pdf") {
      const win = window.open("", "_blank");
      if (!win) {
        addAssistantMessage("Popup blocked. Allow popups to export PDF.");
        return;
      }
      win.document.write(html);
      win.document.close();
      // print is triggered by the load-event script inside the HTML —
      // waits for KaTeX CSS, JS, and web fonts before opening print dialog
      return;
    }

    try {
      const blob = await paperToDocxBlob(applyDocumentStyle(selectedPaper, documentStyle), documentStyle);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedPaper.title.replaceAll(" ", "-").toLowerCase()}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      addAssistantMessage(`DOCX export failed: ${message}`);
    }
  }

  function addUserMessage(text: string) {
    setChatMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "user", text }]);
  }

  function pushToast(text: string, tone: "info" | "error" = "info") {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), tone === "error" ? 6000 : 3800);
  }

  function addAssistantMessage(text: string) {
    setChatMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "assistant", text }]);
    // Surface the same message as a transient UI popup so every action gives visible feedback.
    const tone: "info" | "error" = /\b(fail|failed|could not|couldn't|cannot|can't|unavailable|blocked|error|no )/i.test(text) ? "error" : "info";
    pushToast(text, tone);
  }

  const hasPaperWorkspace = selectedPaper || openPapers.length > 0 || variantPapers.length > 0 || isGenerating || Boolean(lastError);
  const openDraftWorkspace = () => {
    setAppView("studio");
    activatePaper(createDraftPaper(requestPreview, documentStyle));
    setCreateFlow(null);
  };

  const openNewPaperChooser = () => {
    setAppView("studio");
    setCreateFlow("choose");
  };

  const openGuidedSetup = () => {
    setMode("structured");
    setWizardStep(0);
    setCreateFlow("params");
  };

  const openPromptSetup = () => {
    setMode("prompt");
    setCreateFlow("prompt");
  };

  const closeCreateFlow = () => setCreateFlow(null);

  const generateFromCreateFlow = () => {
    setAppView("studio");
    setCreateFlow(null);
    void runGeneration();
  };

  return (
    <main className={s.appRoot}>
        {/* Action toasts — UI popups for every action (no browser alerts) */}
        <div className={s.toastContainer}>
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`fade-up ${s.toastItem} ${toast.tone === "error" ? s.toastItemError : s.toastItemDefault}`}
            >
              <span className={s.toastIcon}>{toast.tone === "error" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}</span>
              <span className={s.toastText}>{toast.text}</span>
              <button className={s.toastClose} onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} type="button">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <PaperLabTopBar
          aiOpen={isAssistantOpen}
          appView={appView}
          currentTitle={selectedPaper?.title ?? "Untitled paper"}
          onExport={exportCurrent}
        onHome={() => {
          setAppView("studio");
          setSelectedPaper(null);
          setVariantPapers([]);
          setOpenPapers([]);
          setLastError(null);
          setStatus(emptyStatus);
        }}
        onOpenView={setAppView}
        onRefresh={() => void refreshDashboard()}
        isSaving={isSavingVersion}
        onSave={() => void saveCurrentVersion()}
        onToggleAI={() => {
          setRightPanel("chat");
          setIsAssistantOpen((current) => !current);
        }}
        onTitleChange={(title) => {
          if (!selectedPaper) return;
          updateSelectedPaper({ ...selectedPaper, title });
        }}
        status={status}
        versions={versions}
        onRestoreVersion={(version) => void restoreVersion(version)}
      />

      {appView !== "studio" ? (
        <div className={s.workspaceOuter}>
          <WorkspaceView
            dashboard={dashboard}
            view={appView}
            onSelectPaper={(paper) => {
              setAppView("studio");
              void loadPaperFromLibrary(paper.id);
            }}
            onUseTemplate={(template) => {
              setAppView("studio");
              applyDashboardTemplate(template);
            }}
          />
        </div>
      ) : !hasPaperWorkspace ? (
        <LandingScreen
          dashboard={dashboard}
          documentStyle={documentStyle}
          request={request}
          templates={dashboard?.templates ?? []}
          onCreateBlank={openDraftWorkspace}
          onOpenPaper={(paperId) => void loadPaperFromLibrary(paperId)}
          onOpenPrompt={openPromptSetup}
          onOpenStructured={openGuidedSetup}
          onUseTemplate={(template) => {
            applyDashboardTemplate(template);
            openDraftWorkspace();
          }}
        />
      ) : (
        <div className={s.studioWorkspace}>
          <PaperNavigator
            isGenerating={isGenerating}
            openPapers={openPapers}
            requestPreview={requestPreview}
            selectedPaper={selectedPaper}
            variantPapers={variantPapers}
            onAddBlank={openNewPaperChooser}
            onSelectOpenPaper={(paper) => void switchOpenPaper(paper)}
            onSelectVariant={(paper) => void selectVariant(paper)}
            onStop={stopGeneration}
          />

          <section className={s.editorSection}>
            {lastError && (
              <div className={`fade-up ${s.errorBanner}`}>
                <div className={s.errorBannerTitle}>Last error</div>
                <div className={s.errorBannerBody}>{lastError}</div>
              </div>
            )}

            <GenerationCanvasState isGenerating={isGenerating} status={status} />

            <PaperEditor
              documentStyle={documentStyle}
              isGenerating={isGenerating}
              paper={selectedPaper}
              onDocumentStyleChange={(style) => {
                setDocumentStyle(style);
                if (selectedPaper) updateSelectedPaper(applyDocumentStyle(selectedPaper, style));
              }}
              onImportImage={(sectionId) => void importQuestionImage(sectionId)}
              onUploadImage={uploadEditorImage}
              onPaperChange={updateSelectedPaper}
              onReplaceQuestion={(sectionId, questionId, questionNumber, instruction) => void replaceQuestionWithAi(sectionId, questionId, questionNumber, instruction)}
              onReplaceOptionalChoice={(sectionId, questionId, questionNumber, instruction) => void replaceOptionalChoiceWithAi(sectionId, questionId, questionNumber, instruction)}
              onSaveQuestionToBank={(question) => void saveQuestionToBank(question)}
            />
          </section>

          <AssistantPanel
            chatInput={chatInput}
            chatMessages={chatMessages}
            isOpen={isAssistantOpen}
            isBusy={isGenerating || isChatting}
            canUndoAiEdit={undoStack.length > 0}
            preview={retrievalPreview}
            questionBank={questionBank}
            rightPanel={rightPanel}
            usage={usage}
            onAsk={() => void askAi()}
            onChatInputChange={setChatInput}
            onClose={() => setIsAssistantOpen(false)}
            onImportBank={(item) => void importBankQuestion(item)}
            onImportSource={(result) => void importSourceQuestion(result)}
            onRefreshBank={() => void refreshQuestionBank()}
            onRefreshRetrieval={() => void refreshRetrievalPreview()}
            onSetPanel={setRightPanel}
            onToggleOpen={() => setIsAssistantOpen((current) => !current)}
            onUndoAiEdit={() => {
              if (undoStack.length > 0) {
                const prev = undoStack[undoStack.length - 1];
                setUndoStack((stack) => stack.slice(0, -1));
                updateSelectedPaper(prev);
                addAssistantMessage("Reverted the last AI edit.");
              }
            }}
          />
        </div>
      )}

      {createFlow === "choose" && (
        <NewPaperChooserModal
          onBlank={openDraftWorkspace}
          onClose={closeCreateFlow}
          onFreePrompt={openPromptSetup}
          onParameters={openGuidedSetup}
        />
      )}

      {createFlow === "params" && (
        <GuidedSetupModal
          availableChapters={availableChapters}
          availableSubjects={availableSubjects}
          dashboard={dashboard}
          onClose={closeCreateFlow}
          onGenerate={generateFromCreateFlow}
          onStepChange={setWizardStep}
          onUpdateRequest={updateRequest}
          questionTypeOptions={questionTypeOptions}
          retrievalPreview={retrievalPreview}
          request={request}
          step={wizardStep}
        />
      )}

      {createFlow === "prompt" && (
        <FreePromptModal
          onClose={closeCreateFlow}
          onGenerate={generateFromCreateFlow}
          onPromptChange={setPrompt}
          prompt={prompt}
          request={request}
          onUpdateRequest={updateRequest}
        />
      )}
      <MathContextMenu onInsert={(insert) => insertIntoActiveRichTextEditor(insert)} />
    </main>
  );
}

function PaperLabTopBar({
  aiOpen,
  appView,
  currentTitle,
  isSaving,
  onExport,
  onHome,
  onOpenView,
  onRefresh,
  onRestoreVersion,
  onSave,
  onTitleChange,
  onToggleAI,
  status,
  versions,
}: {
  aiOpen: boolean;
  appView: AppView;
  currentTitle: string;
  isSaving: boolean;
  onExport: (format: "pdf" | "docx") => void;
  onHome: () => void;
  onOpenView: (view: AppView) => void;
  onRefresh: () => void;
  onRestoreVersion: (version: PaperVersion) => void;
  onSave: () => void;
  onTitleChange: (title: string) => void;
  onToggleAI: () => void;
  status: GenerationStatus;
  versions: PaperVersion[];
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  return (
    <header className={s.topBar}>
      <div className={s.topBarLeft}>
        <button className={s.topBarHomeButton} onClick={onHome} type="button">
          <span className={s.topBarLogo}>
            <FileText size={16} />
          </span>
          <span className={s.topBarBrand}>
            <span className={s.brandName}>Paper Lab</span>
            <span className={s.brandSub}>Question Studio</span>
          </span>
        </button>

        {appView === "studio" && (
          <>
            <div className={s.topBarDivider} />
            {isEditingTitle ? (
              <input
                autoFocus
                className={s.titleInput}
                value={draftTitle}
                onBlur={() => {
                  setIsEditingTitle(false);
                  onTitleChange(draftTitle.trim() || "Untitled paper");
                }}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setIsEditingTitle(false);
                    onTitleChange(draftTitle.trim() || "Untitled paper");
                  }
                }}
              />
            ) : (
              <button
                className={s.titleButton}
                onClick={() => {
                  setDraftTitle(currentTitle);
                  setIsEditingTitle(true);
                }}
                type="button"
              >
                {currentTitle}
              </button>
            )}

            <div className={s.versionWrapper}>
              <button
                className={s.versionBadge}
                onClick={() => setIsVersionOpen((current) => !current)}
                type="button"
              >
                <span className={s.versionAccentDot}>●</span>
                v{versions[0]?.versionNumber ?? 1}
              </button>
              {isVersionOpen && (
                <div className={`scale-in ${s.versionDropdown}`}>
                  <div className={s.versionDropdownLabel}>Versions</div>
                  {versions.length === 0 ? (
                    <div className={s.versionEmptyText}>No versions saved yet.</div>
                  ) : (
                    versions.map((version) => (
                      <button
                        key={version.id}
                        className={s.versionItem}
                        onClick={() => {
                          setIsVersionOpen(false);
                          onRestoreVersion(version);
                        }}
                        type="button"
                      >
                        <span>
                          <span className={s.versionNum}>v{version.versionNumber}</span>
                          <span className={s.versionItemSuffix}>{version.changeSource.replaceAll("_", " ")}</span>
                        </span>
                        {version.marksTotal !== undefined && <span>{version.marksTotal}m</span>}
                      </button>
                    ))
                  )}
                  <button className={s.versionSaveButton} disabled={isSaving} onClick={onSave} type="button">
                    {isSaving ? "Saving…" : "Save current as new version"}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <nav className={s.topBarNav} aria-label="Workspace views">
        {appView !== "studio" &&
          ([
            ["studio", "Studio"],
            ["library", "Library"],
            ["analytics", "Coverage"],
            ["templates", "Templates"],
          ] as const).map(([view, label]) => (
            <button key={view} className={`${s.topNavButton} ${appView === view ? s.topNavButtonActive : ""}`} onClick={() => onOpenView(view)} type="button">
              {label}
            </button>
          ))}
      </nav>

      <div className={s.topBarRight}>
        {appView === "studio" && (
          <>
            <ProgressBadge status={status} />
            <span className={s.savedIndicator}>
              <Check size={14} className={s.savedCheckIcon} />
              Saved
            </span>
            <button className="icon-button disabled:opacity-50" disabled={isSaving} onClick={onSave} title={isSaving ? "Saving…" : "Save version"} type="button">
              <Save size={16} />
            </button>
            <div className={s.exportWrapper}>
              <button className="icon-button" onClick={() => setIsExportOpen((current) => !current)} title="Export" type="button">
                <Download size={16} />
              </button>
              {isExportOpen && (
                <div className={`scale-in ${s.exportDropdown}`}>
                  {(["pdf", "docx"] as const).map((format) => (
                    <button
                      key={format}
                      className={s.exportItem}
                      onClick={() => {
                        setIsExportOpen(false);
                        onExport(format);
                      }}
                      type="button"
                    >
                      <Download size={14} />
                      {format}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {appView !== "studio" && (
          <button className={`secondary-button ${s.refreshBtn}`} onClick={onRefresh} type="button">
            <RefreshCcw size={15} />
            Refresh
          </button>
        )}
        <div className={s.avatarBadge}>TP</div>
      </div>
    </header>
  );
}

interface SmartInsertField {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue: string;
}

interface SmartInsertTemplate {
  id: string;
  label: string;
  description: string;
  insertType: MathToolkitInsert["type"];
  fields: SmartInsertField[];
  build: (values: Record<string, string>) => string;
}

type MathMenuTool =
  | {
      label: string;
      insert: MathToolkitInsert;
      smart?: never;
      live?: never;
    }
  | {
      label: string;
      smart: SmartInsertTemplate;
      insert?: never;
      live?: never;
    }
  | {
      label: string;
      live: true;
      insert?: never;
      smart?: never;
    };

const smartInsertTemplates: Record<string, SmartInsertTemplate> = {
  power: {
    id: "power",
    label: "xⁿ",
    description: "Power with editable base and exponent.",
    insertType: "math",
    fields: [
      { key: "base", label: "Base", defaultValue: "x", placeholder: "x, 2x+1, \\theta" },
      { key: "exponent", label: "Power", defaultValue: "2", placeholder: "2, n, \\frac{1}{2}" },
    ],
    build: (values) => `${wrapLatexGroup(normalizeLatexField(values.base, "x"))}^{${normalizeLatexField(values.exponent, "2")}}`,
  },
  subscript: {
    id: "subscript",
    label: "xₙ",
    description: "Subscript with editable base and index.",
    insertType: "math",
    fields: [
      { key: "base", label: "Base", defaultValue: "x", placeholder: "x, a, C" },
      { key: "index", label: "Index", defaultValue: "n", placeholder: "n, 1, max" },
    ],
    build: (values) => `${wrapLatexGroup(normalizeLatexField(values.base, "x"))}_{${normalizeLatexField(values.index, "n")}}`,
  },
  fraction: {
    id: "fraction",
    label: "a/b",
    description: "Fraction with numerator and denominator.",
    insertType: "math",
    fields: [
      { key: "numerator", label: "Numerator", defaultValue: "a", placeholder: "a, x+1, \\sqrt{x}" },
      { key: "denominator", label: "Denominator", defaultValue: "b", placeholder: "b, 2x, 1/2" },
    ],
    build: (values) => `\\frac{${normalizeLatexField(values.numerator, "a")}}{${normalizeLatexField(values.denominator, "b")}}`,
  },
  root: {
    id: "root",
    label: "√x",
    description: "Square root. The radicand can itself contain LaTeX like \\sqrt{x+1}.",
    insertType: "math",
    fields: [{ key: "radicand", label: "Inside root", defaultValue: "x", placeholder: "x, x+1, \\sqrt{x+1}" }],
    build: (values) => `\\sqrt{${normalizeLatexField(values.radicand, "x")}}`,
  },
  nthRoot: {
    id: "nthRoot",
    label: "ⁿ√x",
    description: "Root with editable index and radicand.",
    insertType: "math",
    fields: [
      { key: "index", label: "Index", defaultValue: "3", placeholder: "3, n, \\frac{1}{2}" },
      { key: "radicand", label: "Inside root", defaultValue: "x", placeholder: "x, x+1, \\sqrt{x}" },
    ],
    build: (values) => `\\sqrt[${normalizeLatexField(values.index, "3")}]{${normalizeLatexField(values.radicand, "x")}}`,
  },
  nestedRoot: {
    id: "nestedRoot",
    label: "√√x",
    description: "Root inside another root, useful for nested radical questions.",
    insertType: "math",
    fields: [
      { key: "outerIndex", label: "Outer index", defaultValue: "2", placeholder: "2, 3, n" },
      { key: "innerIndex", label: "Inner index", defaultValue: "2", placeholder: "2, 3, n" },
      { key: "radicand", label: "Innermost value", defaultValue: "x", placeholder: "x, x+1, \\frac{a}{b}" },
    ],
    build: (values) => {
      const inner = buildRootLatex(normalizeLatexField(values.innerIndex, "2"), normalizeLatexField(values.radicand, "x"));
      return buildRootLatex(normalizeLatexField(values.outerIndex, "2"), inner);
    },
  },
  quadratic: {
    id: "quadratic",
    label: "Quad",
    description: "Quadratic equation with editable coefficients and variable.",
    insertType: "math",
    fields: [
      { key: "a", label: "a", defaultValue: "a", placeholder: "1, 2, a" },
      { key: "b", label: "b", defaultValue: "b", placeholder: "-5, b" },
      { key: "c", label: "c", defaultValue: "c", placeholder: "6, c" },
      { key: "variable", label: "Variable", defaultValue: "x", placeholder: "x, y" },
    ],
    build: (values) => {
      const variable = normalizeLatexField(values.variable, "x");
      return `${normalizeLatexField(values.a, "a")}${variable}^2 + ${normalizeLatexField(values.b, "b")}${variable} + ${normalizeLatexField(values.c, "c")} = 0`;
    },
  },
  ap: {
    id: "ap",
    label: "AP",
    description: "Arithmetic progression nth-term formula.",
    insertType: "math",
    fields: [
      { key: "term", label: "Term symbol", defaultValue: "a", placeholder: "a, T" },
      { key: "index", label: "Index", defaultValue: "n", placeholder: "n, k" },
      { key: "first", label: "First term", defaultValue: "a", placeholder: "a, 3" },
      { key: "difference", label: "Common difference", defaultValue: "d", placeholder: "d, 5" },
    ],
    build: (values) =>
      `${normalizeLatexField(values.term, "a")}_{${normalizeLatexField(values.index, "n")}} = ${normalizeLatexField(values.first, "a")} + (${normalizeLatexField(values.index, "n")} - 1)${normalizeLatexField(values.difference, "d")}`,
  },
  summation: {
    id: "summation",
    label: "Σ",
    description: "Summation with variable, lower limit, upper limit, and expression.",
    insertType: "math",
    fields: [
      { key: "variable", label: "Variable", defaultValue: "n", placeholder: "n, k, i" },
      { key: "lower", label: "Lower", defaultValue: "1", placeholder: "1, 0, alpha" },
      { key: "upper", label: "Upper", defaultValue: "k", placeholder: "k, n, \\infty" },
      { key: "expression", label: "Expression", defaultValue: "a_n", placeholder: "n^2, \\frac{1}{n}" },
    ],
    build: (values) =>
      `\\sum_{${normalizeLatexField(values.variable, "n")}=${normalizeLatexField(values.lower, "1")}}^{${normalizeLatexField(values.upper, "k")}} ${normalizeLatexField(values.expression, "a_n")}`,
  },
  product: {
    id: "product",
    label: "Π",
    description: "Product notation with variable, lower, upper, and expression.",
    insertType: "math",
    fields: [
      { key: "variable", label: "Variable", defaultValue: "i", placeholder: "i, n" },
      { key: "lower", label: "Lower", defaultValue: "1", placeholder: "1" },
      { key: "upper", label: "Upper", defaultValue: "n", placeholder: "n" },
      { key: "expression", label: "Expression", defaultValue: "x_i", placeholder: "x_i, i+1" },
    ],
    build: (values) =>
      `\\prod_{${normalizeLatexField(values.variable, "i")}=${normalizeLatexField(values.lower, "1")}}^{${normalizeLatexField(values.upper, "n")}} ${normalizeLatexField(values.expression, "x_i")}`,
  },
  limit: {
    id: "limit",
    label: "lim",
    description: "Limit with variable, target, and expression.",
    insertType: "math",
    fields: [
      { key: "variable", label: "Variable", defaultValue: "x", placeholder: "x, n" },
      { key: "target", label: "Approaches", defaultValue: "a", placeholder: "0, \\infty, alpha" },
      { key: "expression", label: "Expression", defaultValue: "f(x)", placeholder: "\\frac{\\sin x}{x}" },
    ],
    build: (values) => `\\lim_{${normalizeLatexField(values.variable, "x")}\\to ${normalizeLatexField(values.target, "a")}} ${normalizeLatexField(values.expression, "f(x)")}`,
  },
  derivative: {
    id: "derivative",
    label: "d/dx",
    description: "Derivative with variable, order, and expression.",
    insertType: "math",
    fields: [
      { key: "expression", label: "Expression", defaultValue: "f(x)", placeholder: "x^2, \\sin x" },
      { key: "variable", label: "Variable", defaultValue: "x", placeholder: "x, t" },
      { key: "order", label: "Order", defaultValue: "1", placeholder: "1, 2, n" },
    ],
    build: (values) => {
      const variable = normalizeLatexField(values.variable, "x");
      const order = normalizeLatexField(values.order, "1");
      const expression = normalizeLatexField(values.expression, "f(x)");
      if (order === "1") return `\\frac{d}{d${variable}}\\left(${expression}\\right)`;
      return `\\frac{d^{${order}}}{d${variable}^{${order}}}\\left(${expression}\\right)`;
    },
  },
  integral: {
    id: "integral",
    label: "∫",
    description: "Definite or indefinite integral. Leave limits blank for indefinite.",
    insertType: "math",
    fields: [
      { key: "lower", label: "Lower limit", defaultValue: "a", placeholder: "a, alpha, 0" },
      { key: "upper", label: "Upper limit", defaultValue: "b", placeholder: "b, beta, \\infty" },
      { key: "integrand", label: "Integrand", defaultValue: "f(x)", placeholder: "x^2, \\frac{1}{x}" },
      { key: "variable", label: "Variable", defaultValue: "x", placeholder: "x, t" },
    ],
    build: (values) => {
      const lower = normalizeLatexField(values.lower);
      const upper = normalizeLatexField(values.upper);
      const limits = lower || upper ? `_{${lower || ""}}^{${upper || ""}}` : "";
      return `\\int${limits} ${normalizeLatexField(values.integrand, "f(x)")}\\,d${normalizeLatexField(values.variable, "x")}`;
    },
  },
  log: {
    id: "log",
    label: "logₙ",
    description: "Logarithm with editable base. Fractional bases like 1/2 are converted.",
    insertType: "math",
    fields: [
      { key: "base", label: "Base", defaultValue: "n", placeholder: "n, 2, 1/2" },
      { key: "argument", label: "Argument", defaultValue: "x", placeholder: "x, x+1" },
    ],
    build: (values) => {
      const base = normalizeLatexField(values.base);
      const argument = normalizeLatexField(values.argument, "x");
      return base ? `\\log_{${base}}\\left(${argument}\\right)` : `\\log\\left(${argument}\\right)`;
    },
  },
  trig: {
    id: "trig",
    label: "trig",
    description: "Trig expression with function, optional power, and argument.",
    insertType: "math",
    fields: [
      { key: "functionName", label: "Function", defaultValue: "sin", placeholder: "sin, cos, tan" },
      { key: "power", label: "Power", defaultValue: "", placeholder: "2, n, blank" },
      { key: "argument", label: "Argument", defaultValue: "theta", placeholder: "theta, x, 2A" },
    ],
    build: (values) => {
      const name = normalizeTrigName(values.functionName);
      const power = normalizeLatexField(values.power);
      const argument = normalizeLatexField(values.argument, "\\theta");
      return `\\${name}${power ? `^{${power}}` : ""}\\left(${argument}\\right)`;
    },
  },
  areaCircle: {
    id: "areaCircle",
    label: "Area",
    description: "Circle area with editable radius symbol/value.",
    insertType: "math",
    fields: [{ key: "radius", label: "Radius", defaultValue: "r", placeholder: "r, 7, x" }],
    build: (values) => `\\pi ${wrapLatexGroup(normalizeLatexField(values.radius, "r"))}^2`,
  },
  sphereVolume: {
    id: "sphereVolume",
    label: "Vol sphere",
    description: "Sphere volume with editable radius symbol/value.",
    insertType: "math",
    fields: [{ key: "radius", label: "Radius", defaultValue: "r", placeholder: "r, 7, x" }],
    build: (values) => `\\frac{4}{3}\\pi ${wrapLatexGroup(normalizeLatexField(values.radius, "r"))}^3`,
  },
  vector: {
    id: "vector",
    label: "vec",
    description: "Vector notation.",
    insertType: "math",
    fields: [{ key: "symbol", label: "Symbol", defaultValue: "a", placeholder: "a, AB, v" }],
    build: (values) => `\\vec{${normalizeLatexField(values.symbol, "a")}}`,
  },
  matrix2x2: {
    id: "matrix2x2",
    label: "2×2",
    description: "2 by 2 matrix.",
    insertType: "math",
    fields: [
      { key: "a", label: "Top left", defaultValue: "a", placeholder: "a" },
      { key: "b", label: "Top right", defaultValue: "b", placeholder: "b" },
      { key: "c", label: "Bottom left", defaultValue: "c", placeholder: "c" },
      { key: "d", label: "Bottom right", defaultValue: "d", placeholder: "d" },
    ],
    build: (values) =>
      `\\begin{bmatrix}${normalizeLatexField(values.a, "a")} & ${normalizeLatexField(values.b, "b")} \\\\ ${normalizeLatexField(values.c, "c")} & ${normalizeLatexField(values.d, "d")}\\end{bmatrix}`,
  },
  chemistryEquation: {
    id: "chemistryEquation",
    label: "Chem eq",
    description: "Chemical equation with basic subscript conversion.",
    insertType: "math",
    fields: [
      { key: "reactants", label: "Reactants", defaultValue: "H2 + O2", placeholder: "H2 + O2" },
      { key: "products", label: "Products", defaultValue: "H2O", placeholder: "H2O" },
    ],
    build: (values) => `\\mathrm{${normalizeChemistryLatex(values.reactants || "H2 + O2")} \\rightarrow ${normalizeChemistryLatex(values.products || "H2O")}}`,
  },
};

const mathMenuGroups = [
  {
    label: "Algebra",
    tools: [
      { label: "x²", smart: smartInsertTemplates.power },
      { label: "x³", insert: { type: "math", value: "x^3" } },
      { label: "xₙ", smart: smartInsertTemplates.subscript },
      { label: "√x", smart: smartInsertTemplates.root },
      { label: "ⁿ√x", smart: smartInsertTemplates.nthRoot },
      { label: "√√x", smart: smartInsertTemplates.nestedRoot },
      { label: "a/b", smart: smartInsertTemplates.fraction },
      { label: "Live editor", live: true },
      { label: "Quad", smart: smartInsertTemplates.quadratic },
      { label: "Formula", insert: { type: "math", value: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" } },
      { label: "AP", smart: smartInsertTemplates.ap },
      { label: "logₙ", smart: smartInsertTemplates.log },
    ],
  },
  {
    label: "Calculus",
    tools: [
      { label: "Σ", smart: smartInsertTemplates.summation },
      { label: "Π", smart: smartInsertTemplates.product },
      { label: "lim", smart: smartInsertTemplates.limit },
      { label: "d/dx", smart: smartInsertTemplates.derivative },
      { label: "∫", smart: smartInsertTemplates.integral },
      { label: "∫αβ", insert: { type: "math", value: "\\int_{\\alpha}^{\\beta} f(x)\\,dx" } },
      { label: "trig", smart: smartInsertTemplates.trig },
    ],
  },
  {
    label: "Symbols",
    tools: [
      { label: "π", insert: { type: "text", value: "π" } },
      { label: "θ", insert: { type: "text", value: "θ" } },
      { label: "α", insert: { type: "text", value: "α" } },
      { label: "β", insert: { type: "text", value: "β" } },
      { label: "γ", insert: { type: "text", value: "γ" } },
      { label: "Δ", insert: { type: "text", value: "Δ" } },
      { label: "∞", insert: { type: "text", value: "∞" } },
      { label: "±", insert: { type: "text", value: "±" } },
      { label: "×", insert: { type: "text", value: "×" } },
      { label: "÷", insert: { type: "text", value: "÷" } },
      { label: "≈", insert: { type: "text", value: "≈" } },
      { label: "≠", insert: { type: "text", value: "≠" } },
      { label: "≤", insert: { type: "text", value: "≤" } },
      { label: "≥", insert: { type: "text", value: "≥" } },
      { label: "∴", insert: { type: "text", value: "∴" } },
      { label: "∵", insert: { type: "text", value: "∵" } },
      { label: "⇒", insert: { type: "text", value: "⇒" } },
      { label: "⇔", insert: { type: "text", value: "⇔" } },
    ],
  },
  {
    label: "Geometry",
    tools: [
      { label: "∠", insert: { type: "text", value: "∠" } },
      { label: "⊥", insert: { type: "text", value: "⊥" } },
      { label: "∥", insert: { type: "text", value: "∥" } },
      { label: "△", insert: { type: "text", value: "△" } },
      { label: "≅", insert: { type: "text", value: "≅" } },
      { label: "∼", insert: { type: "text", value: "∼" } },
      { label: "Area", smart: smartInsertTemplates.areaCircle },
      { label: "Vol sphere", smart: smartInsertTemplates.sphereVolume },
      { label: "Pyth", insert: { type: "math", value: "a^2 + b^2 = c^2" } },
      { label: "Sim", insert: { type: "math", value: "\\triangle ABC \\sim \\triangle PQR" } },
      { label: "vec", smart: smartInsertTemplates.vector },
      { label: "2×2", smart: smartInsertTemplates.matrix2x2 },
    ],
  },
  {
    label: "Science",
    tools: [
      { label: "H₂O", insert: { type: "html", value: "H<sub>2</sub>O" } },
      { label: "CO₂", insert: { type: "html", value: "CO<sub>2</sub>" } },
      { label: "O₂", insert: { type: "html", value: "O<sub>2</sub>" } },
      { label: "C₆H₁₂O₆", insert: { type: "html", value: "C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>" } },
      { label: "→", insert: { type: "text", value: "→" } },
      { label: "⇌", insert: { type: "text", value: "⇌" } },
      { label: "V=IR", insert: { type: "math", value: "V = IR" } },
      { label: "F=ma", insert: { type: "math", value: "F = ma" } },
      { label: "E=mc²", insert: { type: "math", value: "E = mc^2" } },
      { label: "Photo", insert: { type: "math", value: "\\mathrm{6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2}" } },
      { label: "Chem eq", smart: smartInsertTemplates.chemistryEquation },
    ],
  },
  {
    label: "Structure",
    tools: [
      { label: "A-D", insert: { type: "html", value: "<p>A. </p><p>B. </p><p>C. </p><p>D. </p>" } },
      { label: "(i)-(iv)", insert: { type: "html", value: "<p>(i) </p><p>(ii) </p><p>(iii) </p><p>(iv) </p>" } },
      { label: "(a)-(d)", insert: { type: "html", value: "<p>(a) </p><p>(b) </p><p>(c) </p><p>(d) </p>" } },
      { label: "OR", insert: { type: "text", value: "\nOR\n" } },
      { label: "Case", insert: { type: "html", value: "<p>Read the case carefully and answer the following questions:</p><p>(a) </p><p>(b) </p>" } },
    ],
  },
] satisfies { label: string; tools: MathMenuTool[] }[];

function MathContextMenu({ onInsert }: { onInsert: (insert: MathToolkitInsert) => boolean }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeSurfaceRef = useRef<HTMLElement | null>(null);
  const smartInsertAppliedRef = useRef(false);
  const staticInsertAppliedRef = useRef(false);
  const [activeSmartId, setActiveSmartId] = useState<string | null>(null);
  const [smartValues, setSmartValues] = useState<Record<string, string>>({});
  const activeSmartTemplate = activeSmartId ? smartInsertTemplates[activeSmartId] : null;
  const [formulasOpen, setFormulasOpen] = useState(false);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [isMathBoxMode, setIsMathBoxMode] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"alpha" | "pm" | null>(null);
  const [textColor, setTextColor] = useState("#000000");

  useEffect(() => {
    const openAt = (x: number, y: number, mathBox: boolean, surface: HTMLElement | null) => {
      const menuHeightBudget = Math.min(620, window.innerHeight - 24);
      activeSurfaceRef.current = surface;
      staticInsertAppliedRef.current = false;
      smartInsertAppliedRef.current = false;
      setIsMathBoxMode(mathBox);
      setPosition({
        x: Math.min(x, window.innerWidth - 360),
        y: Math.max(12, Math.min(y, window.innerHeight - menuHeightBudget)),
      });
      setActiveSmartId(null);
      setSmartValues({});
    };

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".rich-text-surface")) {
        setPosition(null);
        return;
      }

      event.preventDefault();
      const surface = target.closest(".rich-text-surface") as HTMLElement | null;
      activateRichTextEditorFromElement(surface);
      surface?.focus();
      openAt(event.clientX, event.clientY, false, surface);
    };

    const onMathBoxContextMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      openAt(detail.x, detail.y, true, null);
    };
    const close = () => {
      setPosition(null);
      setActiveSmartId(null);
      setSmartValues({});
      setOpenDropdown(null);
      activeSurfaceRef.current = null;
      staticInsertAppliedRef.current = false;
      smartInsertAppliedRef.current = false;
    };
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      const path = event.composedPath();
      if (menuRef.current && path.includes(menuRef.current)) {
        return;
      }

      close();
    };
    const closeOnOutsideScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }

      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("qpg:math-box-contextmenu", onMathBoxContextMenu);
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    document.addEventListener("scroll", closeOnOutsideScroll, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("qpg:math-box-contextmenu", onMathBoxContextMenu);
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      document.removeEventListener("scroll", closeOnOutsideScroll, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!position) return null;

  const startSmartInsert = (template: SmartInsertTemplate) => {
    smartInsertAppliedRef.current = false;
    staticInsertAppliedRef.current = false;
    setActiveSmartId(template.id);
    setSmartValues(Object.fromEntries(template.fields.map((field) => [field.key, field.defaultValue])));
  };

  const applyStaticInsert = (insert: MathToolkitInsert) => {
    if (staticInsertAppliedRef.current) return;
    staticInsertAppliedRef.current = true;

    if (isMathBoxMode) {
      // Insert directly into the active MathLive popup field
      const latex = insert.type === "math" ? insert.value : insert.value;
      insertIntoActiveMathBoxField(latex);
      setPosition(null);
      return;
    }

    activateRichTextEditorFromElement(activeSurfaceRef.current);
    const inserted = onInsert(insert);
    if (!inserted) fallbackInsertIntoSurface(activeSurfaceRef.current, insert.type === "math" ? `$${insert.value}$` : insert.value);
    setPosition(null);
    activeSurfaceRef.current = null;
  };

  const previewValue = activeSmartTemplate?.build(smartValues);
  const applySmartInsert = () => {
    if (!activeSmartTemplate) return;
    if (smartInsertAppliedRef.current) return;

    smartInsertAppliedRef.current = true;
    const value = activeSmartTemplate.build(smartValues);

    if (isMathBoxMode) {
      insertIntoActiveMathBoxField(value);
      setPosition(null);
      return;
    }

    activateRichTextEditorFromElement(activeSurfaceRef.current);
    const inserted = onInsert({ type: activeSmartTemplate.insertType, value } as MathToolkitInsert);
    if (!inserted) fallbackInsertIntoSurface(activeSurfaceRef.current, activeSmartTemplate.insertType === "math" ? `$${value}$` : value);
    setPosition(null);
    activeSurfaceRef.current = null;
  };

  // shared button style helpers — converted to CSS module references
  const symBtn = s.symBtn;
  const menuItem = s.menuItem;

  return (
    <div
      ref={menuRef}
      className={`math-context-menu ${s.mathContextMenuWrap}`}
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* Header */}
      <div className={s.mathMenuHeader}>
        <span className={s.mathMenuHeaderLabel}>
          {activeSmartTemplate ? "Smart insert" : isMathBoxMode ? "LaTeX insert" : "Right-click on text"}
        </span>
        <button className={s.mathMenuEscBtn} onClick={() => setPosition(null)} type="button">ESC</button>
      </div>

      {activeSmartTemplate ? (
        <div className={s.smartInsertPanel}>
          <div className={s.smartInsertTopRow}>
            <button className={s.mathMenuBackBtn} onClick={() => { setActiveSmartId(null); setSmartValues({}); }} type="button">← Back</button>
            <button
              className={s.smartInsertNowBtn}
              onClick={applySmartInsert}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applySmartInsert(); }}
              type="button"
            >Insert now</button>
          </div>
          <div>
            <div className={s.smartInsertTitle}>{activeSmartTemplate?.label}</div>
            <p className={s.smartInsertDesc}>{activeSmartTemplate?.description}</p>
          </div>
          <div className={s.smartInsertGrid}>
            {activeSmartTemplate?.fields.map((field) => (
              <label key={field.key} className={s.smartInsertLabel}>
                <span>{field.label}</span>
                <input
                  className={s.smartInsertInput}
                  placeholder={field.placeholder}
                  value={smartValues[field.key] ?? ""}
                  onChange={(e) => setSmartValues((c) => ({ ...c, [field.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applySmartInsert(); } }}
                />
              </label>
            ))}
          </div>
          <div className={s.smartInsertPreview}>
            <div className={s.smartInsertPreviewLabel}>LaTeX preview</div>
            <code className={s.smartInsertPreviewCode}>{previewValue}</code>
          </div>
          <button
            className={s.smartInsertSubmit}
            onClick={applySmartInsert}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applySmartInsert(); }}
            type="button"
          >Insert {activeSmartTemplate?.label}</button>
        </div>
      ) : (
        <>
          {/* ── 12 Math symbols, 2 × 6 grid ────────────────────────── */}
          {isMathBoxMode && (
            <div className={s.mathMenuMathBoxNote}>
              Inserting into LaTeX formula editor
            </div>
          )}
          <div className={s.mathMenuSymGrid}>
            {/* 1 · x² superscript */}
            <button className={symBtn} title="Superscript (x²)" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "x^{2}" }); }} type="button">x²</button>
            {/* 2 · x₂ subscript */}
            <button className={symBtn} title="Subscript (x₂)" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "x_{2}" }); }} type="button">x₂</button>
            {/* 3 · √ root */}
            <button className={symBtn} title="Square root" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "\\sqrt{x}" }); }} type="button">√</button>
            {/* 4 · π */}
            <button className={symBtn} title="Pi" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "\\pi" }); }} type="button">π</button>
            {/* 5 · α with dropdown */}
            <div className={s.symDropdownAnchor}>
              <button
                className={`${symBtn} ${openDropdown === "alpha" ? "bg-[#4a4a7a]" : ""}`}
                title="Greek letters"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpenDropdown(openDropdown === "alpha" ? null : "alpha"); }}
                type="button"
              >α<span className={s.symDropdownIndicator}>▾</span></button>
              {openDropdown === "alpha" && (
                <div className={s.mathMenuSymDropdown}>
                  {["β","γ","ρ","σ","δ","ε","θ","λ","μ","φ","ω","Ω"].map((ch) => (
                    <button key={ch} className={s.mathMenuSymDropdownBtn} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "text", value: ch }); }} type="button">{ch}</button>
                  ))}
                </div>
              )}
            </div>
            {/* 6 · ∫ integral */}
            <button className={symBtn} title="Integral" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "\\int_{a}^{b} f(x)\\,dx" }); }} type="button">∫</button>
            {/* 7 · ∂ differentiation */}
            <button className={symBtn} title="Partial / differentiation" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "\\frac{\\partial}{\\partial x}" }); }} type="button">∂</button>
            {/* 8 · lim */}
            <button className={`${symBtn} text-xs`} title="Limit" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "\\lim_{x \\to \\infty}" }); }} type="button">lim</button>
            {/* 9 · ± with dropdown */}
            <div className={s.symDropdownAnchor}>
              <button
                className={`${symBtn} ${openDropdown === "pm" ? "bg-[#4a4a7a]" : ""}`}
                title="Comparison operators"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpenDropdown(openDropdown === "pm" ? null : "pm"); }}
                type="button"
              >±<span className={s.symDropdownIndicator}>▾</span></button>
              {openDropdown === "pm" && (
                <div className={s.mathMenuSymDropdownLeft}>
                  {["≤","≥","≠","≈","→","⇒","∝","≡"].map((ch) => (
                    <button key={ch} className={s.mathMenuSymDropdownBtn} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "text", value: ch }); }} type="button">{ch}</button>
                  ))}
                </div>
              )}
            </div>
            {/* 10 · Σ summation */}
            <button className={symBtn} title="Summation" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert({ type: "math", value: "\\sum_{i=1}^{n}" }); }} type="button">Σ</button>
            {/* 11 · a/b fraction — opens smart insert */}
            <button className={`${symBtn} text-xs`} title="Fraction (smart)" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); startSmartInsert(smartInsertTemplates.fraction); }} type="button">a/b</button>
            {/* 12 · □ LaTeX box */}
            <button
              className={s.mathMenuLaTeXBox}
              title="Insert LaTeX box"
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                if (!isMathBoxMode) { activateRichTextEditorFromElement(activeSurfaceRef.current); openMathLiveEditorForActiveRichTextEditor(); }
                setPosition(null);
              }}
              type="button"
            >□</button>
          </div>

          <div className={s.mathMenuDivider} />

          {/* ── Text options ─────────────────────────────────────────── */}
          {!isMathBoxMode && (
            <>
              {/* Paste options row */}
              <div className={s.mathMenuPasteRow}>
                <span className={s.pasteOptionsLabel}>Paste options:</span>
                <div className={s.mathMenuPasteButtons}>
                  <button className={s.mathMenuPasteBtn} title="Paste"
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={async () => { try { const t = await navigator.clipboard.readText(); applyStaticInsert({ type: "text", value: t }); } catch { document.execCommand("paste"); setPosition(null); } }}
                    type="button">📋</button>
                  <button className={s.mathMenuPasteBtn} title="Paste as plain text"
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={async () => { try { const t = await navigator.clipboard.readText(); applyStaticInsert({ type: "text", value: t.replace(/<[^>]*>/g, "") }); } catch { setPosition(null); } }}
                    type="button">A</button>
                </div>
              </div>
              <div className={s.mathMenuDividerFull} />
              {/* Cut */}
              <button className={s.mathMenuCutCopy}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { activateRichTextEditorFromElement(activeSurfaceRef.current); document.execCommand("cut"); setPosition(null); }}
                type="button">
                <span className={s.menuItemContent}>✂ Cut</span>
                <span className={s.menuItemShortcut}>Ctrl X</span>
              </button>
              {/* Copy */}
              <button className={s.mathMenuCutCopy}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { activateRichTextEditorFromElement(activeSurfaceRef.current); document.execCommand("copy"); setPosition(null); }}
                type="button">
                <span className={s.menuItemContent}>⎘ Copy</span>
                <span className={s.menuItemShortcut}>Ctrl C</span>
              </button>
              <div className={s.mathMenuDividerFull} />
              {/* Insert LaTeX box */}
              <button className={menuItem}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { activateRichTextEditorFromElement(activeSurfaceRef.current); openMathLiveEditorForActiveRichTextEditor(); setPosition(null); }}
                type="button">
                <span className={s.menuMathBadge}>f</span>
                Insert LaTeX box
              </button>
              {/* Maths formula (collapsible) */}
              <button className={`${menuItem} justify-between`} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => setFormulasOpen((v) => !v)} type="button">
                <span className={s.menuItemContent}>⊞ Maths formula</span>
                <span className={s.menuItemExpander}>{formulasOpen ? "▼" : "▶"}</span>
              </button>
              {formulasOpen && (
                <div className={s.mathMenuFormulaWrap}>
                  <div className={s.mathMenuFormulaChips}>
                    {[
                      { label: "a/b", insert: { type: "math" as const, value: "\\frac{a}{b}" } },
                      { label: "xⁿ", insert: { type: "math" as const, value: "x^{n}" } },
                      { label: "d/dx", insert: { type: "math" as const, value: "\\frac{d}{dx}" } },
                      { label: "∂/∂x", insert: { type: "math" as const, value: "\\frac{\\partial}{\\partial x}" } },
                      { label: "log", insert: { type: "math" as const, value: "\\log_{a}(b)" } },
                      { label: "ⁿ√x", insert: { type: "math" as const, value: "\\sqrt[n]{x}" } },
                    ].map((item) => (
                      <button key={item.label} className={s.mathMenuFormulaChip}
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert(item.insert); }} type="button">{item.label}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Science formula (collapsible) */}
              <button className={`${menuItem} justify-between`} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => setScienceOpen((v) => !v)} type="button">
                <span className={s.menuItemContent}>⊗ Science formula</span>
                <span className={s.menuItemExpander}>{scienceOpen ? "▼" : "▶"}</span>
              </button>
              {scienceOpen && (
                <div className={s.mathMenuFormulaWrap}>
                  <div className={s.mathMenuFormulaChips}>
                    {[
                      { label: "H₂O", insert: { type: "text" as const, value: "H₂O" } },
                      { label: "CO₂", insert: { type: "text" as const, value: "CO₂" } },
                      { label: "F=ma", insert: { type: "math" as const, value: "F = ma" } },
                      { label: "E=mc²", insert: { type: "math" as const, value: "E = mc^2" } },
                      { label: "→", insert: { type: "text" as const, value: " → " } },
                      { label: "⇌", insert: { type: "text" as const, value: " ⇌ " } },
                    ].map((item) => (
                      <button key={item.label} className={s.mathMenuFormulaChip}
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert(item.insert); }} type="button">{item.label}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Special character */}
              <button className={`${menuItem} justify-between`} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => {
                applyStaticInsert({ type: "html", value: '<span>Ω</span>' });
              }}
              type="button">
                <span className={s.menuItemContent}>Ω Special character</span>
              </button>
              <div className={s.mathMenuDividerFull} />
              {/* Insert table */}
              <button className={menuItem}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { applyStaticInsert({ type: "html", value: '<table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #cbd5e1;padding:4px">A</td><td style="border:1px solid #cbd5e1;padding:4px">B</td></tr><tr><td style="border:1px solid #cbd5e1;padding:4px">C</td><td style="border:1px solid #cbd5e1;padding:4px">D</td></tr></table>' }); }}
                type="button">⊞ Insert table</button>
              {/* Insert matrix */}
              <button className={menuItem}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { applyStaticInsert({ type: "math", value: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" }); }}
                type="button">⊡ Insert matrix</button>
              <div className={s.mathMenuDividerFull} />
              {/* Text color */}
              <div className={s.mathMenuColorRow}>
                <span className={s.menuTextColorLabel}>
                  <span className={s.menuBoldText}>A</span> Text color
                </span>
                <input type="color" className={s.mathMenuColorInput}
                  value={textColor}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => { setTextColor(e.target.value); activateRichTextEditorFromElement(activeSurfaceRef.current); commandActiveRichTextEditor((ed) => ed.chain().focus().setColor(e.target.value).run()); }}
                />
              </div>
              {/* Highlight */}
              <button className={menuItem}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => { activateRichTextEditorFromElement(activeSurfaceRef.current); commandActiveRichTextEditor((ed) => ed.chain().focus().toggleHighlight({ color: "#fff2a8" }).run()); setPosition(null); }}
                type="button">🖊 Highlight</button>
            </>
          )}

          {/* Math box mode extras */}
          {isMathBoxMode && (
            <div className={s.mathMenuMathBoxExtras}>
              <div className={s.mathMenuMathBoxChips}>
                {[
                  { label: "a/b", insert: { type: "math" as const, value: "\\frac{a}{b}" } },
                  { label: "Matrix", insert: { type: "math" as const, value: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" } },
                ].map((item) => (
                  <button key={item.label} className={s.mathMenuFormulaChip}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); applyStaticInsert(item.insert); }} type="button">{item.label}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fallbackInsertIntoSurface(surface: HTMLElement | null, value: string) {
  if (!surface || !value) return false;

  surface.focus();
  if (document.execCommand?.("insertText", false, value)) return true;
  surface.textContent = `${surface.textContent ?? ""}${value}`;
  surface.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  return true;
}

function normalizeLatexField(value = "", fallback = "") {
  const trimmed = value.trim() || fallback;
  if (!trimmed) return "";

  const exactGreek: Record<string, string> = {
    alpha: "\\alpha",
    beta: "\\beta",
    gamma: "\\gamma",
    delta: "\\delta",
    Delta: "\\Delta",
    theta: "\\theta",
    pi: "\\pi",
    infinity: "\\infty",
    inf: "\\infty",
  };

  if (exactGreek[trimmed]) return exactGreek[trimmed];
  if (/^-?\d+\s*\/\s*-?\d+$/.test(trimmed)) {
    const [numerator, denominator] = trimmed.split("/").map((part) => part.trim());
    return `\\frac{${numerator}}{${denominator}}`;
  }

  return trimmed
    .replace(/α/g, "\\alpha")
    .replace(/β/g, "\\beta")
    .replace(/γ/g, "\\gamma")
    .replace(/Δ/g, "\\Delta")
    .replace(/θ/g, "\\theta")
    .replace(/π/g, "\\pi")
    .replace(/∞/g, "\\infty");
}

function normalizeChemistryLatex(value: string) {
  return value
    .trim()
    .replace(/([A-Z][a-z]?)(\\d+)/g, "$1_$2")
    .replace(/\\s+/g, "\\ ");
}

function normalizeTrigName(value = "") {
  const normalized = value.trim().replace(/^\\/, "").toLowerCase();
  const allowed = new Set(["sin", "cos", "tan", "cot", "sec", "csc"]);
  return allowed.has(normalized) ? normalized : "sin";
}

function buildRootLatex(index: string, radicand: string) {
  return index && index !== "2" ? `\\sqrt[${index}]{${radicand}}` : `\\sqrt{${radicand}}`;
}

function wrapLatexGroup(value: string) {
  if (/^[A-Za-z0-9]+$/.test(value) || value.startsWith("\\")) return value;
  return `\\left(${value}\\right)`;
}

function NewPaperChooserModal({
  onBlank,
  onClose,
  onFreePrompt,
  onParameters,
}: {
  onBlank: () => void;
  onClose: () => void;
  onFreePrompt: () => void;
  onParameters: () => void;
}) {
  return (
    <div className={s.modalOverlay}>
      <div className={`scale-in ${s.modalCard}`}>
        <header className={s.modalHeader}>
          <div>
            <div className={s.modalEyebrow}>New Paper</div>
            <h2 className={s.modalHeading}>How do you want to begin?</h2>
            <p className={s.modalSubtitleText}>Create a blank draft, use guided parameters, or describe the paper in plain English.</p>
          </div>
          <button className={`icon-button ${s.closeModalBtn}`} onClick={onClose} title="Close" type="button">
            <X size={17} />
          </button>
        </header>

        <div className={s.modalGrid3}>
          <CreatePathCard
            desc="Start with an empty structured paper and import or write questions manually."
            icon={<FileText size={20} />}
            label="Blank Paper"
            onClick={onBlank}
            title="Blank paper"
          />
          <CreatePathCard
            desc="Pick board, class, subject, chapters, marks, difficulty, sources, and question mix."
            icon={<SlidersHorizontal size={20} />}
            label="Guided Setup"
            onClick={onParameters}
            title="Create from parameters"
          />
          <CreatePathCard
            desc="Tell the assistant what you need. We will extract the missing settings before generation."
            icon={<Sparkles size={20} />}
            label="Free Prompt"
            onClick={onFreePrompt}
            title="Free prompt"
          />
        </div>

        <footer className={s.modalFooter}>
          <span className={s.modalFooterLabel}>CBSE-first · structured editor · saved in open papers</span>
          <button className={`secondary-button ${s.cancelBtn}`} onClick={onClose} type="button">
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

function CreatePathCard({
  desc,
  icon,
  label,
  onClick,
  title,
}: {
  desc: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className={s.createPathCard}
      onClick={onClick}
      type="button"
    >
      <span className={s.createPathIcon}>
        {icon}
      </span>
      <span className={s.createPathLabel}>{label}</span>
      <span className={s.createPathCardTitle}>{title}</span>
      <span className={s.createPathCardDesc}>{desc}</span>
      <span className={s.createPathContinue}>
        Continue <ArrowRight size={15} />
      </span>
    </button>
  );
}

function GuidedSetupModal({
  availableChapters,
  availableSubjects,
  dashboard,
  onClose,
  onGenerate,
  onStepChange,
  onUpdateRequest,
  questionTypeOptions,
  retrievalPreview,
  request,
  step,
}: {
  availableChapters: string[];
  availableSubjects: CatalogSubject[];
  dashboard: DashboardSummary | null;
  onClose: () => void;
  onGenerate: () => void;
  onStepChange: (step: number) => void;
  onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void;
  questionTypeOptions: string[];
  retrievalPreview: RetrievalPreview | null;
  request: PaperRequest;
  step: number;
}) {
  const steps = [
    { title: "Which board and class?", subtitle: "We tune the rubric and tone to match." },
    { title: "What subject?", subtitle: "You can change this later." },
    { title: "Pick the chapters", subtitle: "Tap to include. We will balance questions across them." },
    { title: "Fine-tune the rest", subtitle: "Marks, difficulty, question mix — set once and generate." },
  ];
  const selectedChapterCount = request.chapterScope === "full_syllabus" ? availableChapters.length || request.chapters.length : request.chapters.length;

  return (
    <div className={s.modalOverlayDark}>
      <div className={`scale-in ${s.modalCardFull}`}>
        <CreateFlowHeader
          eyebrow="New paper · Guided setup"
          onClose={onClose}
          step={step}
          subtitle={steps[step].subtitle}
          title={steps[step].title}
          totalSteps={4}
        />

        <div className={s.guidedSetupBody}>
          {step === 0 && <StepBoardClass dashboard={dashboard} onUpdateRequest={onUpdateRequest} request={request} />}
          {step === 1 && <StepSubject availableChapters={availableChapters} availableSubjects={availableSubjects} dashboard={dashboard} onUpdateRequest={onUpdateRequest} request={request} />}
          {step === 2 && <StepChapters availableChapters={availableChapters} onUpdateRequest={onUpdateRequest} request={request} />}
          {step === 3 && <StepFineTune onUpdateRequest={onUpdateRequest} questionTypeOptions={questionTypeOptions} retrievalPreview={retrievalPreview} request={request} />}
        </div>

        <CreateFlowFooter
          leftText={`${request.board} · Class ${request.classLevel} · ${request.subject} · ${selectedChapterCount || 0} ch`}
          onBack={step === 0 ? onClose : () => onStepChange(step - 1)}
          onNext={step === 3 ? onGenerate : () => onStepChange(step + 1)}
          primaryLabel={step === 3 ? "Generate paper" : "Continue"}
          showBack={step > 0}
          sparkles={step === 3}
        />
      </div>
    </div>
  );
}

function CreateFlowHeader({ eyebrow, onClose, step, subtitle, title, totalSteps }: { eyebrow: string; onClose: () => void; step?: number; subtitle: string; title: string; totalSteps?: number }) {
  return (
    <header className={s.createFlowHeader}>
      <div>
        <div className={s.modalEyebrow}>{eyebrow}</div>
        <h2 className={s.modalHeading}>{title}</h2>
        <p className={s.modalSubtitleTextLg}>{subtitle}</p>
      </div>
      <div className={s.createFlowHeaderRight}>
        {step !== undefined && totalSteps !== undefined && (
          <div className={s.createFlowStepDots}>
            {Array.from({ length: totalSteps }).map((_, index) => (
              <span key={index} className={`${s.stepDot} ${index === step ? s.stepDotCurrent : index < step ? s.stepDotPast : s.stepDotFuture}`} />
            ))}
            <span className={s.flowStepCounter}>{step + 1} / {totalSteps}</span>
          </div>
        )}
        <button className={s.createFlowCloseBtn} onClick={onClose} type="button">
          <X size={17} />
        </button>
      </div>
    </header>
  );
}

function CreateFlowFooter({ leftText, onBack, onNext, primaryLabel, showBack, sparkles }: { leftText: string; onBack: () => void; onNext: () => void; primaryLabel: string; showBack: boolean; sparkles?: boolean }) {
  return (
    <footer className={s.createFlowFooter}>
      <div className={s.createFlowFooterLeft}>
        <Bookmark size={14} fill="currentColor" />
        <span>{leftText}</span>
      </div>
      <div className={s.createFlowFooterRight}>
        <button className={s.flowBackBtn} onClick={onBack} type="button">
          {showBack ? "Back" : "Cancel"}
        </button>
        <button className={s.createFlowPrimary} onClick={onNext} type="button">
          {primaryLabel}
          {sparkles ? <Sparkles size={17} /> : <ArrowRight size={17} />}
        </button>
      </div>
    </footer>
  );
}

function StepBoardClass({
  dashboard,
  onUpdateRequest,
  request,
}: {
  dashboard: DashboardSummary | null;
  onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void;
  request: PaperRequest;
}) {
  const counts = dashboard?.counts;
  const cbseDetail = counts?.textbooks
    ? `${formatCount(counts.textbooks)} books · ${formatCount(counts.ncertQuestions)} questions · ${formatCount(counts.pyqQuestions)} PYQs`
    : "Dump corpus loading";
  const boardOptions = [
    { value: "CBSE", label: "CBSE", detail: cbseDetail, disabled: false },
    { value: "ICSE", label: "ICSE", detail: "Selina Class 10 Maths, Physics, Chemistry", disabled: false },
    { value: "IB", label: "IB", detail: "Coming soon", disabled: true },
    { value: "State Board", label: "State Board", detail: "Coming soon", disabled: true },
    { value: "IGCSE", label: "IGCSE", detail: "Coming soon", disabled: true },
  ];
  const classOptions = ["6", "7", "8", "9", "10", "11", "12"];
  const selectBoard = (board: string) => {
    if (board !== "CBSE" && board !== "ICSE") return;

    onUpdateRequest("board", board);
    onUpdateRequest("chapter", "");
    onUpdateRequest("chapters", []);
    onUpdateRequest("topic", "");
    onUpdateRequest("chapterScope", "single");

    if (board === "ICSE") {
      onUpdateRequest("classLevel", "10");
      onUpdateRequest("source", "NCERT");
      onUpdateRequest("sourceBooks", ["Selina"]);
    } else {
      onUpdateRequest("sourceBooks", []);
    }
  };

  return (
    <div className={s.stepBoardGrid}>
      <div>
        <FlowLabel>Board</FlowLabel>
        <div className={s.boardOptionStack}>
          {boardOptions.map((board) => (
            <button
              key={board.value}
              className={`${s.boardOption} ${request.board === board.value ? s.boardOptionSelected : s.boardOptionDefault} ${board.disabled ? "cursor-not-allowed opacity-50" : ""}`}
              disabled={board.disabled}
              onClick={() => selectBoard(board.value)}
              type="button"
            >
              <span className={`${s.radioCircle} ${request.board === board.value ? s.radioCircleSelected : s.radioCircleDefault}`}>
                {request.board === board.value && <span className={s.radioInner} />}
              </span>
              <span>
                <span className={s.optionLabelLg}>{board.label}</span>
                <span className={s.optionLabelSm}>{board.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <FlowLabel>Class</FlowLabel>
        <div className={s.classGrid}>
          {classOptions.map((classLevel) => {
            const disabled = request.board === "ICSE" && classLevel !== "10";
            return (
              <button
                key={classLevel}
                className={`${s.classOption} ${request.classLevel === classLevel ? s.classOptionSelected : s.classOptionDefault} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                disabled={disabled}
                onClick={() => onUpdateRequest("classLevel", classLevel as PaperRequest["classLevel"])}
                type="button"
              >
                Class {classLevel}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepSubject({
  availableChapters,
  availableSubjects,
  dashboard,
  onUpdateRequest,
  request,
}: {
  availableChapters: string[];
  availableSubjects: CatalogSubject[];
  dashboard: DashboardSummary | null;
  onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void;
  request: PaperRequest;
}) {
  const currentSubjectCount = availableChapters.length;
  const indexedDetail = currentSubjectCount > 0 ? `${currentSubjectCount} chapters indexed` : "Dump-backed corpus";
  const fallbackSubjects: CatalogSubject[] =
    request.board === "ICSE"
      ? [
          { value: "Maths", label: "Mathematics", chapterCount: 0, bookCount: 0 },
          { value: "Physics", label: "Physics", chapterCount: 0, bookCount: 0 },
          { value: "Chemistry", label: "Chemistry", chapterCount: 0, bookCount: 0 },
        ]
      : [
          { value: "Maths", label: "Mathematics", chapterCount: 0, bookCount: 0 },
          { value: "Science", label: "Science", chapterCount: 0, bookCount: 0 },
          { value: "Physics", label: "Physics", chapterCount: 0, bookCount: 0 },
          { value: "Chemistry", label: "Chemistry", chapterCount: 0, bookCount: 0 },
          { value: "Biology", label: "Biology", chapterCount: 0, bookCount: 0 },
        ];
  const subjects = availableSubjects.length > 0 ? availableSubjects : fallbackSubjects;
  const selectSubject = (subject: CatalogSubject) => {
    onUpdateRequest("subject", subject.value);
    onUpdateRequest("chapter", "");
    onUpdateRequest("chapters", []);
    onUpdateRequest("topic", "");
    onUpdateRequest("chapterScope", "single");
  };

  return (
    <div className={s.stepSubjectGrid}>
      <FlowLabel>Subject</FlowLabel>
      <div className={s.subjectCardGrid}>
        {subjects.map((subject) => {
          const selected = sameSubjectValue(request.subject, subject.value);
          const countLabel = selected && currentSubjectCount > 0 ? indexedDetail : `${subject.chapterCount} chapters · ${subject.bookCount} books`;

          return (
          <button
            key={subject.value}
            className={`${s.subjectCard} ${selected ? s.subjectCardSelected : s.subjectCardDefault} ${subject.disabled ? "cursor-not-allowed opacity-45" : ""}`}
            disabled={subject.disabled}
            onClick={() => selectSubject(subject)}
            type="button"
          >
            <span className={s.subjectIcon}>{subjectIcon(subject.value)}</span>
            <span className={s.subjectCardTitle}>{subject.label}</span>
            <span className={s.optionLabelSm}>{countLabel}</span>
            {selected && dashboard?.counts.textbooks ? <span className={s.optionLabelXs}>{formatCount(dashboard.counts.textbooks)} total source books</span> : null}
          </button>
          );
        })}
      </div>
    </div>
  );
}

function StepChapters({ availableChapters, onUpdateRequest, request }: { availableChapters: string[]; onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void; request: PaperRequest }) {
  const chapters = availableChapters.length > 0 ? availableChapters : request.chapters;
  const updateScope = (scope: PaperRequest["chapterScope"]) => {
    onUpdateRequest("chapterScope", scope);

    if (scope === "full_syllabus") {
      onUpdateRequest("chapters", chapters);
      onUpdateRequest("chapter", "");
      onUpdateRequest("topic", "Full syllabus");
      return;
    }

    const next = scope === "single" ? request.chapters.slice(0, 1) : request.chapters;
    onUpdateRequest("chapters", next);
    onUpdateRequest("chapter", next[0] ?? "");
    onUpdateRequest("topic", next.join(", "));
  };
  const toggleChapter = (chapter: string) => {
    const selected = request.chapters.includes(chapter);
    const next =
      request.chapterScope === "single"
        ? [chapter]
        : selected
          ? request.chapters.filter((item) => item !== chapter)
          : [...request.chapters, chapter];
    onUpdateRequest("chapterScope", request.chapterScope === "single" ? "single" : next.length > 1 ? "multiple" : "single");
    onUpdateRequest("chapters", next);
    onUpdateRequest("chapter", next[0] ?? "");
    onUpdateRequest("topic", next.join(", "));
  };

  return (
    <div className={s.stepChaptersGrid}>
      <div className={s.stepChaptersHeader}>
        <FlowLabel>Chapters to include</FlowLabel>
        <span className={s.chaptersSelectedCount}>{request.chapters.length} selected</span>
      </div>
      <div className={s.scopeTabGrid}>
        {([
          ["single", "One chapter"],
          ["multiple", "Multiple chapters"],
          ["full_syllabus", "Full syllabus"],
        ] as const).map(([scope, label]) => (
          <button key={scope} className={`${s.tabButton} ${request.chapterScope === scope ? s.tabButtonActive : ""}`} onClick={() => updateScope(scope)} type="button">
            {label}
          </button>
        ))}
      </div>
      <div className={s.chapterGrid}>
        {chapters.map((chapter) => {
          const active = request.chapters.includes(chapter);
          return (
            <button
              key={chapter}
              className={`${s.chapterOption} ${active ? s.chapterOptionSelected : s.chapterOptionDefault}`}
              onClick={() => toggleChapter(chapter)}
              type="button"
            >
              <span className={`${s.checkBox} ${active ? s.checkBoxSelected : s.checkBoxDefault}`}>
                {active && <Check size={14} />}
              </span>
              <span>
                <span className={s.optionLabelLg}>{chapter}</span>
                <span className={s.optionLabelSm}>Available in selected dump catalog</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepFineTune({
  onUpdateRequest,
  questionTypeOptions,
  retrievalPreview,
  request,
}: {
  onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void;
  questionTypeOptions: string[];
  retrievalPreview: RetrievalPreview | null;
  request: PaperRequest;
}) {
  const updateSource = (source: PaperRequest["source"]) => {
    onUpdateRequest("source", source);
    onUpdateRequest("directSourceMix", sourceMixPresets[source]);
    onUpdateRequest("sourceWeights", sourceMixPresets[source]);
    onUpdateRequest("sourceWeightsNormalized", false);
    onUpdateRequest("sourceBooks", []);
    onUpdateRequest("sourceCategories", []);
  };
  const mix = request.difficultyMix ?? difficultyPresets[request.difficulty];
  const sourceMix = request.sourceWeights ?? request.directSourceMix ?? sourceMixPresets[request.source];
  const availability = retrievalPreview?.availability;
  const hasNcert = !availability || availability.totals.ncert > 0;
  const hasPyq = !availability || availability.totals.pyq > 0;
  const hasQuestionBank = !availability || availability.totals.questionBank > 0;
  const sourceOptions = [
    { value: "NCERT" as const, label: "NCERT only", count: availability?.totals.ncert ?? 0, disabled: availability ? !hasNcert : false },
    { value: "PYQ" as const, label: "PYQ only", count: availability?.totals.pyq ?? 0, disabled: availability ? !hasPyq : false },
    { value: "NCERT + PYQ" as const, label: "NCERT + PYQ", count: (availability?.totals.ncert ?? 0) + (availability?.totals.pyq ?? 0), disabled: availability ? !hasNcert || !hasPyq : false },
  ];
  const multipleChapters = request.chapterScope !== "single" && request.chapters.length > 1;
  const effectiveChapterWeights: Record<string, number> = (() => {
    if (!multipleChapters) return {};
    const chapters = request.chapters;
    const stored = request.chapterWeights ?? {};
    if (chapters.every((ch) => ch in stored)) return stored;
    const equal = Math.floor(100 / chapters.length);
    const result: Record<string, number> = {};
    chapters.forEach((ch, i) => { result[ch] = i === 0 ? 100 - equal * (chapters.length - 1) : equal; });
    return result;
  })();
  const totalChapterWeight = Object.values(effectiveChapterWeights).reduce((sum, w) => sum + w, 0);

  const updateChapterWeight = (chapter: string, raw: number) => {
    const chapters = request.chapters;
    const clamped = Math.max(0, Math.min(100, raw));
    const others = chapters.filter((ch) => ch !== chapter);
    const remaining = 100 - clamped;
    const otherTotal = others.reduce((sum, ch) => sum + (effectiveChapterWeights[ch] ?? 0), 0) || 1;
    const next: Record<string, number> = { ...effectiveChapterWeights, [chapter]: clamped };
    let distributed = 0;
    others.forEach((ch, i) => {
      if (i === others.length - 1) {
        next[ch] = Math.max(0, remaining - distributed);
      } else {
        const share = Math.round(((effectiveChapterWeights[ch] ?? 0) / otherTotal) * remaining);
        next[ch] = share;
        distributed += share;
      }
    });
    onUpdateRequest("chapterWeights", next);
  };

  const equalizeChapterWeights = () => {
    const chapters = request.chapters;
    const equal = Math.floor(100 / chapters.length);
    const result: Record<string, number> = {};
    chapters.forEach((ch, i) => { result[ch] = i === 0 ? 100 - equal * (chapters.length - 1) : equal; });
    onUpdateRequest("chapterWeights", result);
  };

  return (
    <div className={s.fineTuneContainer}>
      <div className={s.fineTuneTopGrid}>
        <NumberStepper label="Total marks" value={request.totalMarks} onChange={(value) => onUpdateRequest("totalMarks", value)} />
        <NumberStepper label="Sets" value={request.variantCount} onChange={(value) => onUpdateRequest("variantCount", Math.max(1, Math.min(5, value)))} suffix="A / B / C..." />
      </div>

      {multipleChapters && (
        <div className={s.chapterCoverage}>
          <div className={s.chapterCoverageHeader}>
            <FlowLabel>Chapter coverage</FlowLabel>
            <div className={s.sliderFlexRow}>
              <button
                className={s.equalSplitBtn}
                onClick={equalizeChapterWeights}
                type="button"
              >
                Equal split
              </button>
              <span className={`${s.sourceTotal} ${totalChapterWeight === 100 ? s.savedCheckIcon : ""}`}>
                Total {totalChapterWeight}%
              </span>
            </div>
          </div>
          <div className={s.chapterCoverageGrid} style={{ gridTemplateColumns: `repeat(${Math.min(request.chapters.length, 3)}, 1fr)` }}>
            {request.chapters.map((chapter) => (
              <label key={chapter} className={s.chapterSliderLabel}>
                <span className={s.sliderJustifyRow}>
                  <span style={{ maxWidth: "75%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chapter}</span>
                  <span>{effectiveChapterWeights[chapter] ?? 0}%</span>
                </span>
                <input
                  className={s.sliderInputRange}
                  style={{ marginTop: "0.5rem", width: "100%" }}
                  max={100}
                  min={0}
                  type="range"
                  value={effectiveChapterWeights[chapter] ?? 0}
                  onChange={(event) => updateChapterWeight(chapter, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <FlowLabel>Source</FlowLabel>
        <div className={s.sourceOptions}>
          {sourceOptions.map(({ value, label, count, disabled }) => (
            <button
              key={value}
              className={`${s.sourceOption} ${request.source === value ? s.sourceOptionSelected : s.sourceOptionDefault} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
              disabled={disabled}
              onClick={() => updateSource(value)}
              type="button"
              title={disabled ? "No matching source rows in the dump for the selected chapter." : `${count} available source item(s)`}
            >
              {label}
              {availability ? <span className={s.availabilityCount}>{count}</span> : null}
            </button>
          ))}
        </div>
        {availability ? (
          <div className={s.sliderNote}>
            Available now: {availability.totals.ncert} textbook item(s), {availability.totals.pyq} PYQ item(s), {availability.totals.questionBank} saved bank item(s).
          </div>
        ) : null}
      </div>

      <SourceMixSliders
        disabledSources={{
          ncertDirect: request.source === "PYQ" || !hasNcert,
          pyqDirect: request.source === "NCERT" || !hasPyq,
          questionBank: !hasQuestionBank,
        }}
        mix={sourceMix}
        isNormalized={Boolean(request.sourceWeightsNormalized)}
        onChange={(nextMix, normalized) => {
          onUpdateRequest("sourceWeights", nextMix);
          onUpdateRequest("directSourceMix", nextMix);
          onUpdateRequest("sourceWeightsNormalized", normalized);
        }}
      />

      <div>
        <FlowLabel>AI provider</FlowLabel>
        <div className={s.providerGrid}>
          {(["gemini", "groq"] as const).map((provider) => (
            <button key={provider} className={`${s.tabButton} ${(request.provider ?? "gemini") === provider ? s.tabButtonActive : ""}`} onClick={() => onUpdateRequest("provider", provider)} type="button">
              {provider.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <SectionBlueprintEditor
        blueprint={request.sectionBlueprint ?? []}
        onChange={(bp) => onUpdateRequest("sectionBlueprint", bp)}
        availableTypes={questionTypeOptions}
        targetTotal={request.totalMarks}
      />

      <div className={s.fineTuneSummaryCard}>
        <span className={s.fineTuneSummaryIcon}>
          <Sparkles size={19} />
        </span>
        <div>
          <div className={s.summaryTitle}>
            You will generate a {request.totalMarks}-mark, {request.difficulty.toLowerCase()} paper across {request.chapterScope === "full_syllabus" ? "the full syllabus" : `${request.chapters.length} chapter${request.chapters.length === 1 ? "" : "s"}`}.
          </div>
          <div className={s.summaryDetail}>Drawing from {request.source}. {request.sectionBlueprint && request.sectionBlueprint.length > 0 ? `${request.sectionBlueprint.length} section${request.sectionBlueprint.length === 1 ? "" : "s"} configured` : `${request.questionTypes.length} question type${request.questionTypes.length === 1 ? "" : "s"}`}. {request.variantCount} set{request.variantCount === 1 ? "" : "s"}.</div>
          <div className={s.summaryAccent}>Difficulty mix: {mix.easy}% easy · {mix.medium}% medium · {mix.hard}% hard.</div>
          <div className={s.summaryAccent}>Source mix target: {sourceMix.ncertDirect}% NCERT direct · {sourceMix.pyqDirect}% PYQ direct · {sourceMix.questionBank}% bank · {sourceMix.aiGenerated}% AI from dump. Provider: {(request.provider ?? "gemini").toUpperCase()}.</div>
        </div>
      </div>
    </div>
  );
}



function DifficultyMixSliders({ mix, onChange }: { mix: NonNullable<PaperRequest["difficultyMix"]>; onChange: (mix: NonNullable<PaperRequest["difficultyMix"]>) => void }) {
  const update = (key: keyof typeof mix, value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    const otherKeys = (["easy", "medium", "hard"] as const).filter((item) => item !== key);
    const remaining = 100 - clamped;
    const currentOtherTotal = otherKeys.reduce((total, item) => total + mix[item], 0) || 1;
    const next = {
      ...mix,
      [key]: clamped,
      [otherKeys[0]]: Math.round((mix[otherKeys[0]] / currentOtherTotal) * remaining),
      [otherKeys[1]]: 0,
    };
    next[otherKeys[1]] = 100 - next[key] - next[otherKeys[0]];
    onChange(next);
  };

  return (
    <div className={s.difficultyMixSliders}>
      <div className={s.difficultyMixHeader}>
        <FlowLabel>Difficulty percentage</FlowLabel>
        <span className={s.sourceTotal}>Total 100%</span>
      </div>
      <div className={s.difficultyGridMd3}>
        {(["easy", "medium", "hard"] as const).map((key) => (
          <label key={key} className={s.chapterSliderLabel}>
            <span className={s.sliderJustifyRow}>
              <span>{key}</span>
              <span>{mix[key]}%</span>
            </span>
            <input
              className={s.sliderInputRange}
              style={{ marginTop: "0.5rem", width: "100%" }}
              max={100}
              min={0}
              type="range"
              value={mix[key]}
              onChange={(event) => update(key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SourceMixSliders({
  disabledSources,
  isNormalized,
  mix,
  onChange,
}: {
  disabledSources: Partial<Record<keyof Pick<DirectSourceMix, "ncertDirect" | "pyqDirect" | "questionBank">, boolean>>;
  isNormalized: boolean;
  mix: DirectSourceMix;
  onChange: (mix: DirectSourceMix, normalized: boolean) => void;
}) {
  const keys = ["ncertDirect", "pyqDirect", "questionBank", "aiGenerated"] as const;
  const disabledCleaned = cleanDisabledSourceMix(mix, disabledSources);
  const normalized = normalizeSourceMixForUi(disabledCleaned, disabledSources);
  const total = keys.reduce((sum, key) => sum + Number(disabledCleaned[key] ?? 0), 0);

  const update = (key: (typeof keys)[number], value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    const next = cleanDisabledSourceMix({ ...disabledCleaned, [key]: clamped }, disabledSources);
    onChange({ ...next, dumpDirect: next.ncertDirect + next.pyqDirect + next.questionBank, aiFromDump: next.aiGenerated }, false);
  };

  const normalize = () => {
    onChange({ ...normalized, dumpDirect: normalized.ncertDirect + normalized.pyqDirect + normalized.questionBank, aiFromDump: normalized.aiGenerated }, true);
  };

  return (
    <div className={s.sourceMixSliders}>
      <div className={s.sourceMixHeader}>
        <FlowLabel>Source mix target</FlowLabel>
        <div className={s.normalizeBtnArea}>
          <button
            className={s.normalizeBtn}
            onClick={normalize}
            type="button"
          >
            Normalize to 100%
          </button>
          <span className={`${s.sourceTotal} ${total === 100 ? s.savedCheckIcon : ""}`}>
            Total {total}% {isNormalized || total === 100 ? "normalized" : "free"}
          </span>
        </div>
      </div>
      <div className={s.sourceMixGridMd4}>
        {keys.map((key) => {
          const disabled = Boolean(disabledSources[key as keyof typeof disabledSources]);
          return (
            <label key={key} className={s.chapterSliderLabel} style={{ opacity: disabled ? 0.5 : 1 }}>
              <span className={s.sliderJustifyRow}>
                <span>{sourceMixLabel(key)}</span>
                <span>{normalized[key]}%</span>
              </span>
              <input
                className={s.sliderInputRange}
                style={{ marginTop: "0.5rem", width: "100%" }}
                disabled={disabled}
                max={100}
                min={0}
                type="range"
                value={disabledCleaned[key]}
                onChange={(event) => update(key, Number(event.target.value))}
              />
            </label>
          );
        })}
      </div>
      <div className={s.sourceMixNote}>
        Sliders are free while you explore. Click Normalize, or submit generation, to scale the available sources to exactly 100%.
      </div>
    </div>
  );
}

function cleanDisabledSourceMix(
  mix: DirectSourceMix,
  disabledSources: Partial<Record<keyof Pick<DirectSourceMix, "ncertDirect" | "pyqDirect" | "questionBank">, boolean>>,
) {
  return {
    ncertDirect: disabledSources.ncertDirect ? 0 : Math.max(0, Math.round(mix.ncertDirect ?? 0)),
    pyqDirect: disabledSources.pyqDirect ? 0 : Math.max(0, Math.round(mix.pyqDirect ?? 0)),
    questionBank: disabledSources.questionBank ? 0 : Math.max(0, Math.round(mix.questionBank ?? 0)),
    aiGenerated: Math.max(0, Math.round(mix.aiGenerated ?? 0)),
  };
}

function normalizeSourceMixForUi(
  mix: DirectSourceMix,
  disabledSources: Partial<Record<keyof Pick<DirectSourceMix, "ncertDirect" | "pyqDirect" | "questionBank">, boolean>>,
) {
  const next: DirectSourceMix = {
    ncertDirect: disabledSources.ncertDirect ? 0 : Math.max(0, mix.ncertDirect ?? 0),
    pyqDirect: disabledSources.pyqDirect ? 0 : Math.max(0, mix.pyqDirect ?? 0),
    questionBank: disabledSources.questionBank ? 0 : Math.max(0, mix.questionBank ?? 0),
    aiGenerated: Math.max(0, mix.aiGenerated ?? 0),
  };
  const total = next.ncertDirect + next.pyqDirect + next.questionBank + next.aiGenerated || 1;
  next.ncertDirect = Math.round((next.ncertDirect / total) * 100);
  next.pyqDirect = Math.round((next.pyqDirect / total) * 100);
  next.questionBank = Math.round((next.questionBank / total) * 100);
  next.aiGenerated = 100 - next.ncertDirect - next.pyqDirect - next.questionBank;
  next.dumpDirect = next.ncertDirect + next.pyqDirect + next.questionBank;
  next.aiFromDump = next.aiGenerated;
  return next;
}

function finalizeGenerationRequest(request: PaperRequest): PaperRequest {
  const raw = request.sourceWeights ?? request.directSourceMix ?? sourceMixPresets[request.source];
  const mix = normalizeSourceMixForUi(raw, {
    ncertDirect: request.source === "PYQ",
    pyqDirect: request.source === "NCERT",
  });

  // Derive questionTypes from section blueprint so the backend always has the full type list
  const blueprintTypes = request.sectionBlueprint?.flatMap((s) => s.questionTypes) ?? [];
  const derivedTypes = blueprintTypes.length > 0 ? [...new Set(blueprintTypes)] : request.questionTypes;

  return {
    ...request,
    questionTypes: derivedTypes,
    sourceWeights: mix,
    sourceWeightsNormalized: true,
    directSourceMix: mix,
  };
}

function sourceMixLabel(key: keyof DirectSourceMix) {
  const labels: Partial<Record<keyof DirectSourceMix, string>> = {
    ncertDirect: "NCERT",
    pyqDirect: "PYQ",
    questionBank: "Bank",
    aiGenerated: "AI",
  };
  return labels[key] ?? key;
}

function SectionBlueprintEditor({
  blueprint,
  onChange,
  availableTypes,
  targetTotal,
}: {
  blueprint: SectionBlueprint[];
  onChange: (blueprint: SectionBlueprint[]) => void;
  availableTypes: string[];
  targetTotal?: number;
}) {
  const isActive = blueprint.length > 0;

  const activate = () => {
    onChange([
      { id: crypto.randomUUID(), title: "Section A", questionTypes: ["MCQ"], questionCount: 10, marksEach: 1, difficulty: "Mixed" },
      { id: crypto.randomUUID(), title: "Section B", questionTypes: ["Short Answer"], questionCount: 5, marksEach: 3, difficulty: "Mixed" },
    ]);
  };

  const addSection = () => {
    const label = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[blueprint.length] ?? String(blueprint.length + 1);
    onChange([...blueprint, {
      id: crypto.randomUUID(),
      title: `Section ${label}`,
      questionTypes: ["MCQ"],
      questionCount: 5,
      marksEach: 2,
      difficulty: "Mixed",
    }]);
  };

  const removeSection = (id: string) => onChange(blueprint.filter((sec) => sec.id !== id));

  const updateSection = (id: string, patch: Partial<SectionBlueprint>) =>
    onChange(blueprint.map((sec) => (sec.id === id ? { ...sec, ...patch } : sec)));

  const toggleType = (id: string, type: string) => {
    const section = blueprint.find((s) => s.id === id);
    if (!section) return;
    const has = section.questionTypes.includes(type);
    const next = has ? section.questionTypes.filter((t) => t !== type) : [...section.questionTypes, type];
    if (next.length === 0) return;
    updateSection(id, { questionTypes: next });
  };

  const totalMarks = blueprint.reduce((sum, s) => sum + s.questionCount * s.marksEach, 0);

  return (
    <div className={s.blueprintContainer}>
      <div className={s.blueprintHeader}>
        <FlowLabel>Section question types</FlowLabel>
        {isActive ? (
          <button
            className={s.blueprintResetBtn}
            onClick={() => onChange([])}
            type="button"
          >
            Reset to auto
          </button>
        ) : (
          <button
            className={s.blueprintCustomizeBtn}
            onClick={activate}
            type="button"
          >
            Customize
          </button>
        )}
      </div>

      {!isActive && (
        <p className={s.blueprintTypeNote}>
          AI distributes question types automatically. Click <span className={s.blueprintTypeNoteAccent}>Customize</span> to control which types go in each section.
        </p>
      )}

      {isActive && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {blueprint.map((section) => (
            <div key={section.id} className={s.blueprintSectionCard}>
              {/* Header row: title + count + marks + remove */}
              <div className={s.blueprintSectionHeader}>
                <input
                  className={s.blueprintSectionTitleInput}
                  value={section.title}
                  onChange={(e) => updateSection(section.id, { title: e.target.value })}
                />
                {/* Question count stepper */}
                <div className={s.blueprintStepperGroup}>
                  <button
                    className={s.blueprintStepperBtn}
                    onClick={() => updateSection(section.id, { questionCount: Math.max(1, section.questionCount - 1) })}
                    type="button"
                  >−</button>
                  <span className={s.blueprintCountBadge}>{section.questionCount}</span>
                  <button
                    className={s.blueprintStepperBtn}
                    onClick={() => updateSection(section.id, { questionCount: section.questionCount + 1 })}
                    type="button"
                  >+</button>
                  <span className={s.blueprintStepperSuffix}>Qs</span>
                </div>
                {/* Marks per question stepper */}
                <div className={s.blueprintStepperGroup}>
                  <button
                    className={s.blueprintStepperBtn}
                    onClick={() => updateSection(section.id, { marksEach: Math.max(1, section.marksEach - 1) })}
                    type="button"
                  >−</button>
                  <span className={s.blueprintMarksBadge}>{section.marksEach}</span>
                  <button
                    className={s.blueprintStepperBtn}
                    onClick={() => updateSection(section.id, { marksEach: section.marksEach + 1 })}
                    type="button"
                  >+</button>
                  <span className={s.blueprintStepperSuffix}>m ea.</span>
                </div>
                <span className={s.blueprintSectionNote}>
                  {section.questionCount * section.marksEach}m
                </span>
                {blueprint.length > 1 && (
                  <button
                    className={s.blueprintRemoveBtn}
                    onClick={() => removeSection(section.id)}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {/* Question type chip row */}
              <div className={s.blueprintTypeChips}>
                {availableTypes.map((type) => {
                  const selected = section.questionTypes.includes(type);
                  return (
                    <button
                      key={type}
                      className={`${s.blueprintTypeChip} ${selected ? s.blueprintTypeChipSelected : s.blueprintTypeChipDefault}`}
                      onClick={() => toggleType(section.id, type)}
                      type="button"
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {blueprint.length < 6 && (
            <button
              className={s.blueprintAddSection}
              onClick={addSection}
              type="button"
            >
              <Plus size={12} /> Add section
            </button>
          )}

          <div className={s.blueprintTotalNote}>
            {blueprint.map((sec) => `${sec.title}: ${sec.questionCount * sec.marksEach}m`).join(" · ")}{" "}
            — <span className={s.blueprintTotalBold}>{totalMarks} total marks</span>
          </div>

          {typeof targetTotal === "number" && totalMarks !== targetTotal && (
            <div className={s.blueprintMismatchAlert}>
              <span className={s.blueprintFabRow}>
                <AlertTriangle size={12} />
                Section marks ({totalMarks}) don&apos;t match the paper total ({targetTotal}).
              </span>
              <button
                className={s.blueprintAutoBalance}
                title="Scale the last section's question count to balance the total"
                onClick={() => {
                  const diff = targetTotal - totalMarks;
                  const last = blueprint[blueprint.length - 1];
                  if (!last) return;
                  const addQs = Math.round(diff / Math.max(1, last.marksEach));
                  const nextCount = Math.max(1, last.questionCount + addQs);
                  updateSection(last.id, { questionCount: nextCount });
                }}
                type="button"
              >
                Auto-balance
              </button>
            </div>
          )}
          {typeof targetTotal === "number" && totalMarks === targetTotal && (
            <div className={s.blueprintMatchAlert}>
              <Check size={12} />
              Section marks match the {targetTotal}-mark paper total.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FreePromptModal({
  onClose,
  onGenerate,
  onPromptChange,
  prompt,
  request,
  onUpdateRequest,
}: {
  onClose: () => void;
  onGenerate: () => void;
  onPromptChange: (value: string) => void;
  prompt: string;
  request: PaperRequest;
  onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void;
}) {
  const extracted = requestFromPrompt(prompt);
  const [availableChapters, setAvailableChapters] = useState<string[]>([]);

  // Fetch chapters whenever board/class/subject changes
  useEffect(() => {
    if (!request.board || !request.classLevel || !request.subject) return;
    let cancelled = false;
    fetchChaptersViaApi({ board: request.board, classLevel: request.classLevel, subject: request.subject }).then((ch) => {
      if (!cancelled) setAvailableChapters(ch);
    });
    return () => { cancelled = true; };
  }, [request.board, request.classLevel, request.subject]);

  // Chapters to display: prefer explicitly set chapters on request, fall back to prompt extraction
  const detectedChapters: string[] = (() => {
    if (request.chapters && request.chapters.length > 0) return request.chapters;
    if (extracted.chapter) return [extracted.chapter];
    return [];
  })();

  // Normalize chapter weights: equal distribution if not set or chapters changed
  const chapterWeights: Record<string, number> = (() => {
    const existing = request.chapterWeights ?? {};
    if (detectedChapters.length === 0) return {};
    const equal = Math.round(100 / detectedChapters.length);
    return Object.fromEntries(
      detectedChapters.map((ch, i) => [
        ch,
        existing[ch] ?? (i === detectedChapters.length - 1
          ? 100 - equal * (detectedChapters.length - 1)
          : equal),
      ]),
    );
  })();

  const updateChapterWeight = (chapter: string, value: number) => {
    const others = detectedChapters.filter((c) => c !== chapter);
    const remaining = Math.max(0, 100 - value);
    const otherTotal = others.reduce((s, c) => s + (chapterWeights[c] ?? 0), 0) || 1;
    const next: Record<string, number> = { ...chapterWeights, [chapter]: value };
    others.forEach((c, i) => {
      next[c] = i === others.length - 1
        ? Math.max(0, 100 - value - others.slice(0, -1).reduce((s, k) => s + next[k], 0))
        : Math.round(((chapterWeights[c] ?? 0) / otherTotal) * remaining);
    });
    onUpdateRequest("chapterWeights", next);
  };

  // Difficulty mix derived from extracted difficulty string
  const diffMix = request.difficultyMix ?? difficultyPresets[extracted.difficulty as keyof typeof difficultyPresets] ?? difficultyPresets.Medium;
  const diffTotal = diffMix.easy + diffMix.medium + diffMix.hard || 100;

  // Required-info guardrail: if the prompt skips essentials, ask for them conversationally.
  const missingInfo: string[] = [];
  if (!extracted.subject && !request.subject) missingInfo.push("Which subject is this paper for? (e.g. Maths, Science)");
  if (!extracted.totalMarks && !request.totalMarks) missingInfo.push("How many total marks should the paper carry?");
  if (detectedChapters.length === 0 && request.chapterScope !== "full_syllabus") missingInfo.push("Which chapter(s) or topic should I pull questions from — or say \"full syllabus\"?");
  // question types are now configured per-section in the blueprint; no global check needed

  // Segment colors for chapter ratio bar — CSS module classes
  const CHAPTER_COLORS = [s.chapterColor0, s.chapterColor1, s.chapterColor2, s.chapterColor3, s.chapterColor4, s.chapterColor5];
  const CHAPTER_TEXT_COLORS = [s.chapterTextColor0, s.chapterTextColor1, s.chapterTextColor2, s.chapterTextColor3, s.chapterTextColor4, s.chapterTextColor5];

  return (
    <div className={s.modalOverlayDark}>
      <div className={`scale-in ${s.modalCardFreePrompt}`}>
        <CreateFlowHeader eyebrow="New paper · Free prompt" onClose={onClose} subtitle="Plain English. We will fill in the blanks and ask only if needed." title="Describe the paper" />

        <div className={s.freePromptBody}>
          {/* Left: prompt textarea + samples */}
          <div className={s.freePromptLeft}>
            <div>
              <FlowLabel>Your prompt</FlowLabel>
              <textarea
                className={s.promptTextarea}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="e.g. CBSE Class 10 Maths, 50 marks unit test on Quadratic Equations, mix of MCQ and long answer..."
                value={prompt}
              />
            </div>
            <div>
              <FlowLabel>Try one of these</FlowLabel>
              {[
                "CBSE Class 10 Maths unit test on Quadratic Equations, 30 marks, only MCQs and short answers",
                "Class 12 Physics, mixed difficulty, 80 marks, full syllabus, 3 sets",
                "A practice sheet on Real Numbers for CBSE Class 10. Easy. NCERT-style.",
              ].map((sample) => (
                <button key={sample} className={s.promptSample} onClick={() => onPromptChange(sample)} type="button">
                  &quot;{sample}&quot;
                </button>
              ))}
            </div>
          </div>

          {/* Right: extracted params + difficulty bar */}
          <div className={s.freePromptRight}>
            <div className={s.extractedPanel}>
              <FlowLabel>What I&apos;m picking up</FlowLabel>
              <div className={s.extractedGrid}>
                {/* Board dropdown */}
                <div className={s.extractedRow}>
                  <span className={s.monoAccentLabel}>Board</span>
                  <select
                    className={s.extractedSelect}
                    value={request.board}
                    onChange={(e) => onUpdateRequest("board", e.target.value as PaperRequest["board"])}
                  >
                    {["CBSE", "ICSE"].map((b) => <option key={b} value={b}>{b}</option>)}
                    {!["CBSE", "ICSE"].includes(extracted.board) && extracted.board && <option value={extracted.board}>{extracted.board}</option>}
                  </select>
                </div>
                {/* Class dropdown */}
                <div className={s.extractedRow}>
                  <span className={s.monoAccentLabel}>Class</span>
                  <select
                    className={s.extractedSelect}
                    value={request.classLevel}
                    onChange={(e) => onUpdateRequest("classLevel", e.target.value as PaperRequest["classLevel"])}
                  >
                    {["6","7","8","9","10","11","12"].map((c) => <option key={c} value={c}>Class {c}</option>)}
                  </select>
                </div>
                {/* Subject — text display only (dynamic) */}
                <div className={s.extractedRow}>
                  <span className={s.monoAccentLabel}>Subject</span>
                  <span className={extracted.subject ? s.extractedValue : s.extractedValueEmpty}>{extracted.subject || "not specified"}</span>
                </div>
                {/* Marks display */}
                <div className={s.extractedRow}>
                  <span className={s.monoAccentLabel}>Marks</span>
                  <span className={extracted.totalMarks ? s.extractedValue : s.extractedValueEmpty}>{extracted.totalMarks || "not specified"}</span>
                </div>
                {/* Chapters row */}
                <div className={s.extractedRowTop}>
                  <span className={s.monoAccentLabel}>Chapters</span>
                  {detectedChapters.length > 0 ? (
                    <div className={s.chipsWrap}>
                      {detectedChapters.map((ch) => (
                        <span key={ch} className={s.detectedChapter}>
                          {ch}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className={s.extractedValueEmpty}>not detected</span>
                  )}
                </div>
                {/* Source dropdown */}
                <div className={s.extractedRow}>
                  <span className={s.monoAccentLabel}>Source</span>
                  <select
                    className={s.extractedSelect}
                    value={request.source}
                    onChange={(e) => onUpdateRequest("source", e.target.value as PaperRequest["source"])}
                  >
                    {(["NCERT", "PYQ", "NCERT + PYQ"] as const).map((sv) => <option key={sv} value={sv}>{sv}</option>)}
                  </select>
                </div>
                {/* Difficulty dropdown */}
                <div className={s.extractedRow}>
                  <span className={s.monoAccentLabel}>Difficulty</span>
                  <select
                    className={s.extractedSelect}
                    value={request.difficulty ?? extracted.difficulty ?? "Medium"}
                    onChange={(e) => {
                      const d = e.target.value as keyof typeof difficultyPresets;
                      onUpdateRequest("difficulty", d);
                      onUpdateRequest("difficultyMix", difficultyPresets[d] ?? difficultyPresets.Medium);
                    }}
                  >
                    {["Easy", "Medium", "Hard", "Mixed"].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Chapter ratio panel — only when 2+ chapters detected */}
            {detectedChapters.length >= 1 && (
              <div className={s.chapterRatioPanel}>
                <FlowLabel>Chapter ratio</FlowLabel>
                {/* Segmented bar */}
                <div className={s.chapterRatioBar}>
                  {detectedChapters.map((ch, i) => (
                    <div
                      key={ch}
                      className={`h-full transition-all ${CHAPTER_COLORS[i % CHAPTER_COLORS.length]}`}
                      style={{ width: `${chapterWeights[ch] ?? 0}%` }}
                      title={`${ch}: ${chapterWeights[ch] ?? 0}%`}
                    />
                  ))}
                </div>
                {/* Legend */}
                <div className={s.chapterRatioLegend}>
                  {detectedChapters.map((ch, i) => (
                    <span key={ch} className={`${s.chapterRatioLegendItem} ${CHAPTER_TEXT_COLORS[i % CHAPTER_TEXT_COLORS.length]}`}>
                      <span className={`${s.legendColorDot} ${CHAPTER_COLORS[i % CHAPTER_COLORS.length]}`} />
                      <span className={s.legendItemName} title={ch}>{ch}</span>
                      <span className={s.inlinePercentBold}>{chapterWeights[ch] ?? 0}%</span>
                    </span>
                  ))}
                </div>
                {/* Per-chapter sliders (only when 2+) */}
                {detectedChapters.length >= 2 && (
                  <div className={s.chapterWeightGrid}>
                    {detectedChapters.map((ch, i) => (
                      <label key={ch} className={s.chapterWeightRow}>
                        <span className={`${s.legendColorDot} ${CHAPTER_COLORS[i % CHAPTER_COLORS.length]}`} />
                        <span className={s.chapterWeightName} title={ch}>{ch}</span>
                        <input
                          className={s.sliderFlex}
                          type="range" min={0} max={100}
                          value={chapterWeights[ch] ?? 0}
                          onChange={(e) => updateChapterWeight(ch, Number(e.target.value))}
                        />
                        <span className={s.chapterWeightValue}>{chapterWeights[ch] ?? 0}%</span>
                      </label>
                    ))}
                  </div>
                )}
                {/* Available chapters hint */}
                {availableChapters.length > 0 && detectedChapters.length < availableChapters.length && (
                  <p className={s.sliderNoteItalic}>
                    {availableChapters.length} chapters available in syllabus — mention more in your prompt to include them.
                  </p>
                )}
              </div>
            )}

            {/* Weightage bar */}
            <div className={s.difficultyWeightagePanel}>
              <FlowLabel>Difficulty weightage</FlowLabel>
              {/* Segmented bar */}
              <div className={s.difficultyBar}>
                <div className={s.difficultyBarEasy} style={{ width: `${(diffMix.easy / diffTotal) * 100}%` }} title={`Easy ${diffMix.easy}%`} />
                <div className={s.difficultyBarMedium} style={{ width: `${(diffMix.medium / diffTotal) * 100}%` }} title={`Medium ${diffMix.medium}%`} />
                <div className={s.difficultyBarHard} style={{ width: `${(diffMix.hard / diffTotal) * 100}%` }} title={`Hard ${diffMix.hard}%`} />
              </div>
              {/* Legend */}
              <div className={s.difficultyLegend}>
                {[["Easy", s.difficultyDotEasy, diffMix.easy], ["Medium", s.difficultyDotMedium, diffMix.medium], ["Hard", s.difficultyDotHard, diffMix.hard]].map(([label, dotClass, pct]) => (
                  <span key={String(label)} className={s.difficultyLegendItem}>
                    <span className={`${s.difficultyDot} ${String(dotClass)}`} />
                    {label} <span className={s.inlinePercentBold}>{pct}%</span>
                  </span>
                ))}
              </div>
              {/* Sliders */}
              <div className={s.difficultySliders}>
                {(["easy", "medium", "hard"] as const).map((key) => (
                  <label key={key} className={s.difficultySliderRow}>
                    <span className={s.diffSliderName}>{key}</span>
                    <input
                      className={s.sliderFlex}
                      type="range" min={0} max={100}
                      value={diffMix[key]}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const other = (["easy","medium","hard"] as const).filter((k) => k !== key);
                        const remaining = Math.max(0, 100 - val);
                        const otherTotal = (diffMix[other[0]] + diffMix[other[1]]) || 1;
                        const next = { ...diffMix, [key]: val, [other[0]]: Math.round((diffMix[other[0]] / otherTotal) * remaining) };
                        next[other[1]] = Math.max(0, 100 - next[key] - next[other[0]]);
                        onUpdateRequest("difficultyMix", next);
                      }}
                    />
                    <span className={s.chapterWeightValue}>{diffMix[key]}%</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Required-info chat prompts */}
            {prompt.trim() && missingInfo.length > 0 && (
              <div className={s.missingInfoPanel}>
                <div className={s.missingInfoHeader}>
                  <Bot size={14} />
                  A few things before I generate
                </div>
                {missingInfo.map((message) => (
                  <div key={message} className={s.missingInfoItem}>
                    <span className={s.missingInfoIcon}>
                      <Bot size={11} />
                    </span>
                    <p className={s.missingInfoBubble}>
                      {message}
                    </p>
                  </div>
                ))}
                <p className={s.amberNote}>
                  Add these to your prompt above, or set them in the fields on the right.
                </p>
              </div>
            )}

            {/* Section question types */}
            <SectionBlueprintEditor
              blueprint={request.sectionBlueprint ?? []}
              onChange={(bp) => onUpdateRequest("sectionBlueprint", bp)}
              availableTypes={questionTypeOptions}
              targetTotal={extracted.totalMarks || request.totalMarks}
            />
          </div>
        </div>

        <CreateFlowFooter leftText={!prompt.trim() ? "Start typing — suggestions appear live" : missingInfo.length > 0 ? `${missingInfo.length} detail${missingInfo.length === 1 ? "" : "s"} still needed — see the questions above` : "Ready to generate from prompt"} onBack={onClose} onNext={onGenerate} primaryLabel="Generate paper" showBack={false} sparkles />
      </div>
    </div>
  );
}

function FlowLabel({ children }: { children: React.ReactNode }) {
  return <div className={s.flowLabel}>{children}</div>;
}

function NumberStepper({ label, onChange, suffix, value }: { label: string; onChange: (value: number) => void; suffix?: string; value: number }) {
  const [localValue, setLocalValue] = useState(String(value));
  useEffect(() => { setLocalValue(String(value)); }, [value]);

  return (
    <div>
      <FlowLabel>{label}</FlowLabel>
      <div className={s.numberStepper}>
        <button className={s.numberStepperBtn} onClick={() => onChange(value - 1)} type="button">
          <Minus size={16} />
        </button>
        <div className={s.numberStepperMiddle}>
          <input
            className={s.numberStepperInput}
            inputMode="numeric"
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
              const parsed = Number(e.target.value);
              if (!Number.isNaN(parsed) && parsed >= 0) onChange(parsed);
            }}
            onBlur={() => {
              const parsed = Number(localValue);
              if (!Number.isNaN(parsed) && parsed >= 0) onChange(parsed);
              else setLocalValue(String(value));
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          {suffix && <span className={s.numberStepperSuffix}>{suffix}</span>}
        </div>
        <button className={s.numberStepperBtn} onClick={() => onChange(value + 1)} type="button">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function LandingScreen({
  dashboard,
  documentStyle,
  onCreateBlank,
  onOpenPaper,
  onOpenPrompt,
  onOpenStructured,
  onUseTemplate,
  request,
  templates,
}: {
  dashboard: DashboardSummary | null;
  documentStyle: DocumentStyle;
  onCreateBlank: () => void;
  onOpenPaper: (paperId: string) => void;
  onOpenPrompt: () => void;
  onOpenStructured: () => void;
  onUseTemplate: (template: DashboardSummary["templates"][number]) => void;
  request: PaperRequest;
  templates: DashboardSummary["templates"];
}) {
  const builtInTemplates = templates.length > 0 ? templates : fallbackDashboardTemplates();

  return (
    <div className={s.landingRoot}>
      <div className={s.landingInner}>
        <section className={`fade-up ${s.landingHeroSection}`}>
          <div>
            <div className={s.landingEyebrow}>Question Studio</div>
            <h1 className={s.landingH1}>
              Build the paper like an editor, generate it like an AI lab.
            </h1>
            <p className={s.landingSubtitle}>
              Start with parameters, a free prompt, or a blank canvas. Generated papers stay structured so every question, option, OR choice, source, and mark can be edited.
            </p>
          </div>
          <div className={s.landingPreviewCard}>
            <div className={s.landingDefaultLabel}>Current default</div>
            <div className={s.landingPreviewInner}>
              <div className={s.landingCurrentPaperTitle}>{request.subject} Assessment</div>
              <div className={s.landingCurrentPaperMeta}>
                CBSE · Class {request.classLevel} · {request.totalMarks} marks
              </div>
              <div className={s.landingPreviewLines}>
                <div className={s.landingPreviewLine75} />
                <div className={s.landingPreviewLineFull} />
                <div className={s.landingPreviewLine66} />
                <div className={s.landingPreviewChoices}>
                  <div className={s.landingPreviewChoice} />
                  <div className={s.landingPreviewChoice} />
                </div>
              </div>
            </div>
            <div className={s.landingPreviewStats}>
              <MiniStat label="Font" value={documentStyle.fontSize} />
              <MiniStat label="Spacing" value={documentStyle.lineHeight} />
              <MiniStat label="Sets" value={request.variantCount} />
            </div>
          </div>
        </section>

        <section className={s.landingStartSection}>
          <StartCard desc="Guided setup with board, class, subject, chapter, sources, question mix, and section blueprint." icon={LayoutDashboard} label="Parameters" onClick={onOpenStructured} title="Create from parameters" />
          <StartCard desc="Write a natural-language request and let the backend normalize it into the same PaperRequest shape." icon={Sparkles} label="Prompt" onClick={onOpenPrompt} title="Create from free prompt" />
          <StartCard desc="Open the structured editor immediately and add/import questions manually." icon={FileText} label="Blank" onClick={onCreateBlank} title="Start with blank paper" />
        </section>

        <section className={s.landingPanelSection}>
          <LandingPanel eyebrow="Recent" title="Saved papers">
            {(dashboard?.recentPapers ?? []).length === 0 ? (
              <EmptyWorkspaceState title="No saved papers yet" description="Saved versions will appear here once you generate or import a paper." />
            ) : (
              <div className={s.recentPaperGrid}>
                {(dashboard?.recentPapers ?? []).slice(0, 4).map((paper) => (
                  <button key={paper.id} className={s.recentPaperCard} onClick={() => onOpenPaper(paper.id)} type="button">
                    <div className={s.recentPaperTitle}>{paper.title}</div>
                    <div className={s.recentPaperMeta}>
                      {paper.board} · Class {paper.classLevel} · {paper.subject}
                    </div>
                    <div className={s.recentPaperStats}>
                      <span>{paper.marksTotal} marks</span>
                      <span>·</span>
                      <span>{paper.versionCount} versions</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </LandingPanel>

          <LandingPanel eyebrow="Templates" title="Choose a format">
            <div className={s.templateGrid}>
              {builtInTemplates.map((template) => (
                <button key={template.id} className={s.templateCard} onClick={() => onUseTemplate(template)} type="button">
                  <div className={s.templateIcon}>
                    <FileText size={17} />
                  </div>
                  <div className={s.templateCardTitle}>{template.name}</div>
                  <p className={s.templateCardDesc}>{template.description || "Reusable paper template with formatting and request hints."}</p>
                </button>
              ))}
            </div>
          </LandingPanel>
        </section>
      </div>
    </div>
  );
}

function StartCard({ desc, icon: IconComponent, label, onClick, title }: { desc: string; icon: React.ComponentType<{ size?: number | string; className?: string }>; label: string; onClick: () => void; title: string }) {
  return (
    <button className={s.startCard} onClick={onClick} type="button">
      <div className={s.startCardTop}>
        <span className={s.startCardIcon}>
          <IconComponent size={20} />
        </span>
        <span className={s.startCardLabel}>{label}</span>
      </div>
      <div className={s.startCardTitle}>{title}</div>
      <p className={s.startCardDesc}>{desc}</p>
    </button>
  );
}

function LandingPanel({ children, eyebrow, title }: { children: React.ReactNode; eyebrow: string; title: string }) {
  return (
    <section className={s.landingPanel}>
      <div className={s.landingPanelHeader}>
        <div className={s.panelSectionEyebrow}>{eyebrow}</div>
        <h2 className={s.panelSectionTitle}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function PaperNavigator({
  isGenerating,
  onAddBlank,
  onSelectOpenPaper,
  onSelectVariant,
  onStop,
  openPapers,
  requestPreview,
  selectedPaper,
  variantPapers,
}: {
  isGenerating: boolean;
  onAddBlank: () => void;
  onSelectOpenPaper: (paper: Paper) => void;
  onSelectVariant: (paper: Paper) => void;
  onStop: () => void;
  openPapers: Paper[];
  requestPreview: PaperRequest;
  selectedPaper: Paper | null;
  variantPapers: Paper[];
}) {
  const totalMarks = selectedPaper?.summary.totalMarks ?? requestPreview.totalMarks;

  return (
    <aside className={s.navigator}>
      <div className={s.navigatorTop}>
        <div className={s.navigatorTopRow}>
          <div className={s.navigatorSectionLabel}>Open papers</div>
          <span className={s.navigatorCount}>{openPapers.length}</span>
        </div>
        {openPapers.length > 0 && (
          <div className={s.openPaperList}>
            {openPapers.map((paper, index) => {
              const isActive = selectedPaper && (selectedPaper.id === paper.id || (selectedPaper.paperId && selectedPaper.paperId === paper.paperId));
              return (
                <button
                  key={`${paper.id}-${paper.paperId ?? "draft"}`}
                  className={`${s.openPaperBtn} ${isActive ? s.openPaperBtnActive : s.openPaperBtnDefault}`}
                  onClick={() => onSelectOpenPaper(paper)}
                  type="button"
                >
                  <FileText className={s.navigatorFileIcon} size={15} />
                  <span className={s.openPaperMeta}>
                    <span className={s.truncateBlock}>{paper.title || `Untitled paper ${index + 1}`}</span>
                    <span className={s.navigatorPaperTitle}>
                      {paper.summary.totalMarks}m · {paper.summary.questionCount}q
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button className={s.newPaperBtn} onClick={onAddBlank} type="button">
          <FileText size={15} />
          New paper
        </button>
      </div>

      <div className={s.navigatorMiddle}>
        {variantPapers.length > 0 && openPapers.length === 0 && (
          <div className={s.variantSetsSection}>
            <div className={s.variantSetsLabel}>Generated sets</div>
            <div className={s.variantSetList}>
              {variantPapers.map((paper, index) => (
                <button key={paper.id} className={`${s.variantBtn} ${selectedPaper?.id === paper.id ? s.variantBtnActive : s.variantBtnDefault}`} onClick={() => onSelectVariant(paper)} type="button">
                  <span className={s.navigatorVariantLabel}>Set {String.fromCharCode(65 + index)}</span>
                  <span className={s.truncateBlock}>{paper.summary.totalMarks} marks · {paper.summary.questionCount} questions</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isGenerating && (
          <button className={`secondary-button ${s.stopGenerateBtn}`} onClick={onStop} type="button">
            <Square size={15} />
            Stop generation
          </button>
        )}

        {/* The editor's section/question outline is portaled into this slot. */}
        <div id="paper-outline-slot" />
      </div>

      <div className={s.navigatorBottom}>
        <div className={s.navigatorBottomRow}>
          <span className={s.navigatorSectionLabel}>Total marks</span>
          <span className={s.generationMetricValue}>{totalMarks}</span>
        </div>
      </div>
    </aside>
  );
}

function GenerationCanvasState({ isGenerating, status }: { isGenerating: boolean; status: GenerationStatus }) {
  if (!isGenerating) return null;

  return (
    <div className={`fade-up ${s.generationCanvas}`}>
      <div className={s.generationSpinnerWrap}>
        <LoaderCircle className="animate-spin" size={22} />
      </div>
      <div className={s.generationTitle}>Generating question paper</div>
      <div className={s.generationMessage}>{status.message}</div>
      <div className={s.generationProgressBar}>
        <div className={s.generationProgressFill} style={{ width: `${Math.max(8, Math.min(100, status.progress))}%` }} />
      </div>
    </div>
  );
}

function AssistantPanel({
  canUndoAiEdit,
  chatInput,
  chatMessages,
  isOpen,
  isBusy,
  onAsk,
  onChatInputChange,
  onClose,
  onImportBank,
  onImportSource,
  onRefreshBank,
  onRefreshRetrieval,
  onSetPanel,
  onToggleOpen,
  onUndoAiEdit,
  preview,
  questionBank,
  rightPanel,
  usage,
}: {
  canUndoAiEdit: boolean;
  chatInput: string;
  chatMessages: ChatMessage[];
  isOpen: boolean;
  isBusy: boolean;
  onAsk: () => void;
  onChatInputChange: (value: string) => void;
  onClose: () => void;
  onImportBank: (item: QuestionBankItem) => void;
  onImportSource: (result: RetrievalResult) => void;
  onRefreshBank: () => void;
  onRefreshRetrieval: () => void;
  onSetPanel: (panel: RightPanel) => void;
  onToggleOpen: () => void;
  onUndoAiEdit: () => void;
  preview: RetrievalPreview | null;
  questionBank: QuestionBankItem[];
  rightPanel: RightPanel;
  usage: AiUsageSummary | null;
}) {
  if (!isOpen) {
    return (
      <button
        className={`fade-up ${s.assistantFab}`}
        onClick={onToggleOpen}
        type="button"
      >
        <span className={s.assistantFabIcon}>
          <Sparkles size={15} />
        </span>
        Ask assistant
        <span className={s.assistantFabKbd}>⌘K</span>
      </button>
    );
  }

  return (
    <aside className={`scale-in ${s.assistantPanel}`}>
      <div className={s.assistantHeader}>
        <div className={s.assistantHeaderTop}>
          <div className={s.assistantHeaderLeft}>
            <span className={s.assistantBotIcon}>
              <Bot size={16} />
            </span>
            <div>
              <div className={s.assistantTitle}>Assistant</div>
              <div className={s.assistantSubtitle}>Refine, retrieve, restore</div>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title="Close assistant" type="button">
            <X size={16} />
          </button>
        </div>
        <div className={s.assistantTabRow}>
          {(["chat", "retrieval"] as RightPanel[]).map((panel) => (
            <button key={panel} className={`${s.tabButton} ${rightPanel === panel ? s.tabButtonActive : ""}`} onClick={() => onSetPanel(panel)} type="button">
              {panel === "retrieval" ? "Sources" : panel}
            </button>
          ))}
        </div>
      </div>

      <div className={s.assistantBody}>
        {rightPanel === "chat" && (
          <div className={s.chatSection}>
            {usage && (
              <div className={s.usageCard}>
                <div className={s.usageCardTitle}>API usage</div>
                <div className={s.usageCardTokens}>{usage.totalTokens} tokens · ${usage.totalLatencyMs ? `${Math.round(usage.totalLatencyMs / 1000)}s · ` : ""}${usage.estimatedCostUsd.toFixed(6)}</div>
                {usage.events[0] && (
                  <div className={s.usageCardModel}>
                    {usage.events[0].provider ?? "ai"} · {usage.events[0].model}
                  </div>
                )}
              </div>
            )}
            <div className={s.toolRouterCard}>
              <div className={s.toolRouterLabel}>Local tool router</div>
              <div className={s.toolRouterChips}>
                {CHAT_TOOL_CATALOG.map((tool) => (
                  <span key={tool.name} className={s.toolChip} title={tool.description}>
                    {tool.name}
                  </span>
                ))}
              </div>
            </div>
            {chatMessages.map((message) => (
              <div key={message.id} className={message.role === "user" ? s.chatMessageUser : s.chatMessageAssistant}>
                {message.text}
              </div>
            ))}
            {isBusy && (
              <div className={s.chatBusy}>
                <LoaderCircle className="animate-spin" size={14} />
                Working on the paper...
              </div>
            )}
            {!isBusy && canUndoAiEdit && (
              <div className={s.undoRow}>
                <button
                  className={s.chatUndoBtn}
                  onClick={onUndoAiEdit}
                  type="button"
                >
                  <RefreshCcw size={11} />
                  Undo last AI edit
                </button>
              </div>
            )}
            {!isBusy && chatMessages.length > 0 && chatMessages[chatMessages.length - 1]?.role === "assistant" && (chatMessages[chatMessages.length - 1]?.text ?? "").toLowerCase().includes("failed") && (
              <div className={s.errorCard}>
                <div className={s.errorCardTitle}>The assistant ran into an issue.</div>
                <div className={s.errorCardBody}>Try rephrasing your request, or use the question controls directly for targeted edits.</div>
                <button
                  className={s.errorRetryBtn}
                  onClick={onAsk}
                  type="button"
                >
                  Retry last message
                </button>
              </div>
            )}
          </div>
        )}

        {rightPanel === "retrieval" && (
          <div className={s.retrievalSection}>
            <RetrievalPanel preview={preview} onImport={onImportSource} onRefresh={onRefreshRetrieval} />
            <div className={s.bankSection}>
              <div className={s.bankSectionHeader}>
                <div className={s.bankSectionLabel}>Question bank</div>
                <button className={s.bankRefreshBtn} onClick={onRefreshBank} type="button">
                  Refresh
                </button>
              </div>
              <QuestionBankPanel items={questionBank} onImport={onImportBank} onRefresh={onRefreshBank} compact />
            </div>
          </div>
        )}
      </div>

      <div className={s.assistantInputFooter}>
        <div className={s.assistantInputWrap}>
          <input
            className={s.assistantInput}
            placeholder="Replace Q5, rebalance, format..."
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAsk();
            }}
          />
          <button className={s.assistantSendBtn} onClick={onAsk} type="button">
            <Send size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function fallbackDashboardTemplates(): DashboardSummary["templates"] {
  return [
    { id: "default-template", name: "Default", description: "Balanced editable paper with standard spacing.", payload: {}, formatting: {}, inferredParams: {} },
    { id: "unit-test-template", name: "Unit Test", description: "Short one-chapter assessment with compact instructions.", payload: {}, formatting: { margin: 48, lineHeight: 1.45, fontSize: 15 }, inferredParams: { totalMarks: 20, durationMinutes: 40, chapterScope: "single" } },
    { id: "mid-term-template", name: "Mid Term", description: "Multi-chapter 50 mark paper with medium spacing.", payload: {}, formatting: { margin: 56, lineHeight: 1.55, fontSize: 16 }, inferredParams: { totalMarks: 50, durationMinutes: 120, chapterScope: "multiple" } },
    { id: "full-syllabus-template", name: "Full Syllabus", description: "Large syllabus-wide test with broader sections.", payload: {}, formatting: { margin: 60, lineHeight: 1.6, fontSize: 16 }, inferredParams: { totalMarks: 80, durationMinutes: 180, chapterScope: "full_syllabus" } },
    { id: "cbse-pyq-template", name: "CBSE PYQ Format", description: "Board-style instructions, sections, and exam-paper spacing.", payload: {}, formatting: { margin: 64, lineHeight: 1.5, fontSize: 15 }, inferredParams: { totalMarks: 80, durationMinutes: 180, source: "NCERT + PYQ" } },
  ];
}

function RetrievalPanel({ preview, onImport, onRefresh }: { preview: RetrievalPreview | null; onImport: (result: RetrievalResult) => void; onRefresh: () => void }) {
  const [sourceTab, setSourceTab] = useState<"all" | "ncert" | "pyq" | "bank">("all");
  const results = [...(preview?.ncert ?? []), ...(preview?.pyq ?? []), ...(preview?.questionBank ?? [])];
  const tabResults =
    sourceTab === "ncert"
      ? preview?.ncert ?? []
      : sourceTab === "pyq"
        ? preview?.pyq ?? []
        : sourceTab === "bank"
          ? preview?.questionBank ?? []
          : results;
  const sectionChapters = preview?.sectionSources?.chapters ?? [];
  const hasSectionSources = sectionChapters.some((chapter) => chapter.sections.some((section) => section.ncert.length > 0 || section.pyq.length > 0));
  const tabCounts = {
    all: results.length,
    ncert: preview?.ncert.length ?? 0,
    pyq: preview?.pyq.length ?? 0,
    bank: preview?.questionBank.length ?? 0,
  };

  return (
    <div className="space-y-3">
      <button className="secondary-button" onClick={onRefresh} type="button">
        <Database size={15} />
        Refresh retrieval
      </button>
      <div className={s.retrievalTabGrid}>
        {(["all", "ncert", "pyq", "bank"] as const).map((tab) => (
          <button
            key={tab}
            className={`${s.retrievalTab} ${sourceTab === tab ? s.retrievalTabActive : s.retrievalTabDefault}`}
            onClick={() => setSourceTab(tab)}
            type="button"
          >
            {tab} {tabCounts[tab]}
          </button>
        ))}
      </div>
      {preview?.warnings.map((warning) => (
        <div key={warning} className={s.retrievalWarning}>
          {warning}
        </div>
      ))}
      {sourceTab === "all" && hasSectionSources ? (
        <div className={s.retrievalChapterList}>
          {sectionChapters.map((chapter) => (
            <div key={chapter.name} className={s.chapterCard}>
              <div className={s.chapterCardHeader}>
                <div>
                  <div className={s.chapterCardName}>{chapter.name}</div>
                  <div className={s.chapterCardDesc}>Dump-backed textbook questions, exercises, chunks, and matching PYQs</div>
                </div>
                {chapter.position !== undefined && <span className={s.chapterPositionBadge}>Ch {chapter.position}</span>}
              </div>

              <div className={s.chapterSectionList}>
                {chapter.sections
                  .filter((section) => section.ncert.length > 0 || section.pyq.length > 0)
                  .map((section) => (
                    <details key={`${chapter.name}-${section.name}`} className={s.chapterSectionDetails} open={section.sectionType === "exercise"}>
                      <summary className={s.chapterSectionSummary}>
                        <span>{section.name}</span>
                        <span className={s.chapterSectionCount}>
                          {section.ncert.length + section.pyq.length}
                        </span>
                      </summary>
                      <div className={s.chapterSectionItems}>
                        {section.ncert.map((result) => (
                          <SourceResultButton key={`section-ncert-${result.id}`} result={result} onImport={onImport} />
                        ))}
                        {section.pyq.map((result) => (
                          <SourceResultButton key={`section-pyq-${result.id}`} result={result} onImport={onImport} />
                        ))}
                      </div>
                    </details>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : tabResults.length === 0 ? (
        <div className={s.emptyRetrievalMsg}>No retrieval results yet. Add NCERT/PYQ data or generate a preview.</div>
      ) : (
        tabResults.map((result) => <SourceResultButton key={`${result.sourceType}-${result.id}`} result={result} onImport={onImport} />)
      )}
    </div>
  );
}

function SourceResultButton({ result, onImport }: { result: RetrievalResult; onImport: (result: RetrievalResult) => void }) {
  const sourceLabel = result.sourceType.replaceAll("_", " ").toUpperCase();
  const bookLine = [result.bookTitle, result.publisher, result.bookType].filter(Boolean).join(" · ");
  const metaLine = [
    result.category,
    result.sectionLabel || result.sectionTitle,
    result.page ? `p. ${result.page}` : undefined,
    result.questionType,
    result.marks ? `${result.marks} marks` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const taxonomy = [...(result.skills ?? []), ...(result.formulas ?? [])].slice(0, 4);

  return (
    <button className={s.sourceResultBtn} onClick={() => onImport(result)} type="button">
      <span className={s.sourceResultHeader}>
        <span className={s.sourceResultLabel}>{sourceLabel}</span>
        <span className={s.sourceResultImportBadge}>Import</span>
      </span>
      {bookLine && <span className={s.sourceResultBook}>{bookLine}</span>}
      <span className={s.sourceResultTitle}>{result.title}</span>
      <span className={s.sourceResultExcerpt}>{result.excerpt}</span>
      {metaLine && <span className={s.sourceResultMeta}>{metaLine}</span>}
      {taxonomy.length > 0 && (
        <span className={s.sourceResultTaxonomy}>
          {taxonomy.map((item) => (
            <span key={item} className={s.sourceResultTaxTag}>
              {item}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function QuestionBankPanel({ compact = false, items, onImport, onRefresh }: { compact?: boolean; items: QuestionBankItem[]; onImport: (item: QuestionBankItem) => void; onRefresh: () => void }) {
  return (
    <div className={s.bankPanelList}>
      {!compact && (
        <button className="secondary-button" onClick={onRefresh} type="button">
          <RefreshCcw size={15} />
          Refresh bank
        </button>
      )}
      {items.length === 0 ? (
        <div className={s.emptyRetrievalMsg}>No saved questions yet. Use the save icon on any question card.</div>
      ) : (
        <div className={compact ? s.bankCompactGrid : s.bankPanelList}>
          {items.map((item) => (
            <button key={item.id} className={s.bankItemBtn} onClick={() => onImport(item)} type="button">
              <span className={s.bankItemTitle}>{item.questionType ?? "Q"} · {item.marks ?? "?"} m</span>
              <span className={`mt-1 block text-[var(--on-surface-variant)] ${compact ? s.bankItemTextCompact : s.bankItemTextFull}`}>{item.text}</span>
              {!compact && <span className={s.bankItemChapter}>{item.chapter ?? "No chapter"} · {item.difficulty ?? "Mixed"}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceView({
  dashboard,
  view,
  onSelectPaper,
  onUseTemplate,
}: {
  dashboard: DashboardSummary | null;
  view: AppView;
  onSelectPaper: (paper: DashboardSummary["recentPapers"][number]) => void;
  onUseTemplate: (template: DashboardSummary["templates"][number]) => void;
}) {
  if (!dashboard) {
    return (
      <div className={s.workspaceLoadingWrap}>
        <div className={s.workspaceLoadingCard}>
          <LoaderCircle className={`animate-spin ${s.workspaceLoadingSpinner}`} size={24} />
          <div className={s.workspaceLoadingTitle}>Loading workspace data</div>
          <p className={s.workspaceLoadingDesc}>Phoenix dashboard data will appear here once the API responds.</p>
        </div>
      </div>
    );
  }

  if (view === "library") {
    return (
      <div className={s.workspaceContent}>
        <DashboardMetricGrid dashboard={dashboard} />
        <WorkspacePanel title="Recent papers" eyebrow="Saved work">
          {dashboard.recentPapers.length === 0 ? (
            <EmptyWorkspaceState title="No saved papers yet" description="Generated or imported papers will appear here after a version is saved." />
          ) : (
            <div className={s.workspaceTemplateGrid}>
              {dashboard.recentPapers.map((paper) => (
                <button key={paper.id} className={s.libraryPaperCard} onClick={() => onSelectPaper(paper)} type="button">
                  <div className={s.libraryPaperCardTop}>
                    <div>
                      <div className={s.libraryPaperTitle}>{paper.title}</div>
                      <div className={s.libraryPaperMeta}>
                        {paper.board} Class {paper.classLevel} · {paper.subject}
                      </div>
                    </div>
                    <span className={s.libraryPaperStatusBadge}>{paper.status || "saved"}</span>
                  </div>
                  <div className={s.libraryPaperStats}>
                    <MiniStat label="Marks" value={paper.marksTotal} />
                    <MiniStat label="Versions" value={paper.versionCount} />
                    <MiniStat label="Updated" value={formatShortDate(paper.updatedAt)} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </WorkspacePanel>
        <WorkspacePanel title="Recent generation runs" eyebrow="AI activity">
          <RunList runs={dashboard.recentRuns} />
        </WorkspacePanel>
      </div>
    );
  }

  if (view === "analytics") {
    return (
      <div className={s.workspaceContent}>
        <DashboardMetricGrid dashboard={dashboard} />
        <div className={s.workspaceAnalyticsGrid}>
          <WorkspacePanel title="Syllabus coverage" eyebrow="Corpus readiness">
            {dashboard.chapterCoverage.length === 0 ? (
              <EmptyWorkspaceState title="No chapters indexed" description="Ingest NCERT/PYQ files to build the chapter coverage map." />
            ) : (
              <div className={s.coverageList}>
                {dashboard.chapterCoverage.map((chapter) => (
                  <div key={chapter.id} className={s.coverageRow}>
                    <div className={s.coverageRowTop}>
                      <div className={s.coverageRowLeft}>
                        <div className={s.coverageRowName}>{chapter.name}</div>
                        <div className={s.coverageRowMeta}>
                          NCERT {chapter.ncertCount} · PYQ {chapter.pyqCount} · Bank {chapter.bankCount}
                        </div>
                      </div>
                      <span className={s.coverageRowScore}>{chapter.coverageScore}%</span>
                    </div>
                    <ProgressLine value={chapter.coverageScore} />
                  </div>
                ))}
              </div>
            )}
          </WorkspacePanel>
          <div className={s.workspaceAnalyticsSidebar}>
            <WorkspacePanel title="Difficulty tags" eyebrow="Question quality">
              <DistributionRows rows={dashboard.difficultyDistribution.map((row) => ({ label: row.difficulty, value: row.count }))} />
            </WorkspacePanel>
            <WorkspacePanel title="Source mix" eyebrow="Retrieval base">
              <DistributionRows rows={dashboard.sourceMix.map((row) => ({ label: row.source, value: row.count }))} />
            </WorkspacePanel>
          </div>
        </div>
      </div>
    );
  }

  if (view === "templates") {
    return (
      <div className={s.workspaceContent}>
        <WorkspacePanel title="Template suite" eyebrow="Formatting presets">
          {dashboard.templates.length === 0 ? (
            <EmptyWorkspaceState title="No templates saved" description="Upload templates from the Studio panel to reuse formatting and missing-parameter hints." />
          ) : (
            <div className={s.workspaceTemplateGrid}>
              {dashboard.templates.map((template) => (
                <button key={template.id} className={s.workspaceTemplateCard} onClick={() => onUseTemplate(template)} type="button">
                  <div className={s.workspaceTemplateCardTitle}>{template.name}</div>
                  <p className={s.workspaceTemplateCardDesc}>{template.description || "Reusable paper template with formatting and request hints."}</p>
                  <div className={s.workspaceTemplateCardTags}>
                    {Object.keys(template.formatting).slice(0, 4).map((key) => (
                      <span key={key} className={s.workspaceTemplateTag}>{key}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </WorkspacePanel>
      </div>
    );
  }

  return null;
}

function DashboardMetricGrid({ dashboard }: { dashboard: DashboardSummary }) {
  return (
    <div className={s.metricGrid}>
      <MetricCard label="Saved papers" value={dashboard.counts.papers} detail={`${dashboard.counts.completedRuns}/${dashboard.counts.generationRuns} runs completed`} />
      <MetricCard label="Indexed chapters" value={dashboard.counts.chapters} detail={`${dashboard.counts.ncertQuestions} NCERT items`} />
      <MetricCard label="PYQ questions" value={dashboard.counts.pyqQuestions} detail="Tagged by marks, type, difficulty" />
      <MetricCard label="Question bank" value={dashboard.counts.questionBankItems} detail={`${dashboard.counts.templates} templates ready`} />
    </div>
  );
}

function WorkspacePanel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.workspacePanelRoot}>
      <div className={s.workspacePanelHeader}>
        <div className={s.workspacePanelEyebrow}>{eyebrow}</div>
        <h2 className={s.workspacePanelTitle}>{title}</h2>
      </div>
      <div className={s.workspacePanelBody}>{children}</div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className={s.metricCard}>
      <div className={s.metricCardLabel}>{label}</div>
      <div className={s.metricCardValue}>{value}</div>
      <div className={s.metricCardDetail}>{detail}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={s.miniStatRoot}>
      <div className={s.miniStatLabel}>{label}</div>
      <div className={s.miniStatValue}>{value}</div>
    </div>
  );
}

function DistributionRows({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  if (rows.length === 0) return <EmptyWorkspaceState title="No tags yet" description="Tagged imported questions will appear here." />;

  return (
    <div className={s.distRows}>
      {rows.map((row) => (
        <div key={row.label}>
          <div className={s.distRowHeader}>
            <span className={s.distRowLabel}>{row.label}</span>
            <span className={s.distRowValue}>{row.value}</span>
          </div>
          <ProgressLine value={(row.value / max) * 100} />
        </div>
      ))}
    </div>
  );
}

function ProgressLine({ value }: { value: number }) {
  return (
    <div className={s.progressLineTrack}>
      <div className={s.progressLineFill} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function RunList({ runs }: { runs: DashboardSummary["recentRuns"] }) {
  if (runs.length === 0) return <EmptyWorkspaceState title="No runs yet" description="Generation attempts will appear here with their current status." />;

  return (
    <div className={s.runList}>
      {runs.map((run) => {
        const request = run.request;
        const subject = String(request.subject ?? "Unknown subject");
        const marks = String(request.total_marks ?? request.totalMarks ?? "?");

        return (
          <div key={run.id} className={s.runRow}>
            <div className={s.runRowTop}>
              <span className={s.runStatus}>{run.status}</span>
              <span className={s.runDate}>{formatShortDate(run.insertedAt)}</span>
            </div>
            <div className={s.runDesc}>
              {subject} · {marks} marks
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyWorkspaceState({ title, description }: { title: string; description: string }) {
  return (
    <div className={s.emptyState}>
      <div className={s.emptyStateTitle}>{title}</div>
      <p className={s.emptyStateDesc}>{description}</p>
    </div>
  );
}

function ProgressBadge({ status }: { status: GenerationStatus }) {
  const done = status.status === "completed";
  const failed = status.status === "failed";
  return (
    <div className={s.progressBadge}>
      {done ? <CheckCircle2 className="text-emerald-600" size={14} /> : failed ? <RefreshCcw className="text-red-600" size={14} /> : <LoaderCircle className={status.status === "running" || status.status === "queued" ? "animate-spin text-[var(--primary)]" : "text-[var(--outline)]"} size={14} />}
      <span>{Math.round(status.progress)}%</span>
    </div>
  );
}

function describeRequest(request: PaperRequest) {
  const blueprint = request.sectionBlueprint?.length
    ? ` Sections: ${request.sectionBlueprint.map((section) => `${section.title} ${section.questionCount}x${section.marksEach} ${section.questionTypes.join("/")}`).join("; ")}.`
    : "";
  return `${request.board} class ${request.classLevel} ${request.subject}, ${request.totalMarks} marks, ${request.chapters.join(", ") || "whole syllabus"}, types: ${request.questionTypes.join(", ")}.${blueprint}`;
}

type ChatPaperCommandResult =
  | {
      handled: true;
      paper: Paper;
      message: string;
      versionLabel?: string;
      toolName?: string;
      bankQuestion?: PaperQuestion;
      skipVersion?: boolean;
    }
  | { handled: false; providerInstruction?: string };

const CHAT_TOOL_CATALOG = [
  { name: "replace_question", description: "Route replacement requests to the AI patch/refinement path." },
  { name: "move_question_to_or", description: "Move a full root question into another question's OR branch." },
  { name: "add_question_or", description: "Add a whole-question internal choice block." },
  { name: "add_subpart_or", description: "Add an OR branch to a specific subpart." },
  { name: "create_mcq_question", description: "Create a structured MCQ with independent options." },
  { name: "add_mcq_option", description: "Add option E/F/etc. to an MCQ and relabel options." },
  { name: "add_subpart", description: "Add the next continuous part label to a question." },
  { name: "add_diagram_placeholder", description: "Insert a draggable diagram placeholder." },
  { name: "delete_question", description: "Delete a question and renumber the paper." },
  { name: "duplicate_question", description: "Duplicate a question and preserve its structure." },
  { name: "save_question_to_bank", description: "Save a question for reuse." },
  { name: "save_version", description: "Save the current paper version." },
] as const;

type QuestionRef = {
  number: number;
  section: PaperSection;
  sectionIndex: number;
  question: PaperQuestion;
  questionIndex: number;
};

function applyChatPaperCommand(paper: Paper, instruction: string, documentStyle: DocumentStyle): ChatPaperCommandResult {
  const normalizedInstruction = instruction.trim();
  const lower = normalizedInstruction.toLowerCase();
  const refs = getQuestionRefs(paper);

  if (isSaveVersionCommand(lower)) {
    return {
      handled: true,
      paper,
      message: "Saved this as a new version.",
      versionLabel: "chat_save_version",
      toolName: "save_version",
    };
  }

  // #190: explicit no-op phrases — don't forward to AI
  if (/^\s*do\s+nothing\s*$/i.test(lower) || /^\s*(?:ignore|skip|cancel|never\s+mind)\s*$/i.test(lower)) {
    return { handled: true, paper, message: "No changes made.", skipVersion: true };
  }

  // #194: reject zero-marks instruction before it reaches the AI
  if (/\b0\s*marks?\b/i.test(lower) && /\b(?:make|set|change|update)\b/i.test(lower)) {
    return { handled: true, paper, message: "Setting 0 marks is not allowed. Please specify a positive number.", skipVersion: true };
  }

  // #237/#238: check specific question-add commands BEFORE the generic section check
  // so "add MCQ in section B" and "add blank question to section A" don't trigger add_section
  if (isCreateMcqCommand(lower)) {
    const target = findQuestionRefFromInstruction(refs, normalizedInstruction);
    const targetSectionId = target?.section.id ?? paper.sections[0]?.id;
    if (!targetSectionId) return { handled: false };

    const nextQuestion = createBlankMcqQuestion(paper);
    const nextPaper = normalizePaperStructure({
      ...paper,
      sections: paper.sections.map((section) =>
        section.id === targetSectionId
          ? {
              ...section,
              questions: [...section.questions, nextQuestion],
            }
          : section,
      ),
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: "Created a structured MCQ with four separate option rows and an answer field.",
      versionLabel: "chat_create_mcq",
      toolName: "create_mcq_question",
    };
  }

  if (parseAddBlankQuestionCommand(lower)) {
    const target = findQuestionRefFromInstruction(refs, normalizedInstruction);
    const targetSectionId = target?.section.id ?? paper.sections[0]?.id;
    if (!targetSectionId) return { handled: false };

    const nextQuestion = createBlankQuestion(paper);
    const nextPaper = normalizePaperStructure({
      ...paper,
      sections: paper.sections.map((section) =>
        section.id === targetSectionId
          ? {
              ...section,
              questions: [...section.questions, nextQuestion],
            }
          : section,
      ),
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: "Added a blank editable question.",
      versionLabel: "chat_add_blank_question",
      toolName: "add_question",
    };
  }

  // #237/#238: add_section now comes after more-specific question-add commands
  if (isAddSectionCommand(lower)) {
    const nextPaper = normalizePaperStructure({
      ...paper,
      sections: [
        ...paper.sections,
        {
          id: crypto.randomUUID(),
          title: inferSectionTitle(normalizedInstruction, paper.sections.length),
          instructions: "Add questions or import source-backed questions into this section.",
          difficulty: inferDifficulty(normalizedInstruction),
          targetMarks: inferMarks(normalizedInstruction),
          questions: [],
        },
      ],
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: "Added a new editable section. You can now drag questions into it or import questions there.",
      versionLabel: "chat_add_section",
      toolName: "add_section",
    };
  }

  const replaceChoice = parseReplaceChoiceCommand(normalizedInstruction);
  if (replaceChoice) {
    const target = refs.find((ref) => ref.number === replaceChoice.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${replaceChoice.questionNumber} to replace its OR choice.` };

    return {
      handled: false,
      providerInstruction: buildReplaceOrChoiceInstruction(target, normalizedInstruction),
    };
  }

  const replaceQuestion = parseReplaceQuestionCommand(normalizedInstruction);
  if (replaceQuestion) {
    const target = refs.find((ref) => ref.number === replaceQuestion.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${replaceQuestion.questionNumber} to replace.` };

    return {
      handled: false,
      providerInstruction: buildReplaceQuestionInstruction(target, normalizedInstruction),
    };
  }

  const similarOrChoice = parseGenerateSimilarOrChoiceCommand(normalizedInstruction);
  if (similarOrChoice) {
    const target = refs.find((ref) => ref.number === similarOrChoice.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${similarOrChoice.questionNumber} to add OR.` };

    return {
      handled: false,
      providerInstruction: buildSimilarOrChoiceInstruction(target, normalizedInstruction),
    };
  }

  const saveQuestion = parseSaveQuestionToBankCommand(normalizedInstruction);
  if (saveQuestion) {
    const target = refs.find((ref) => ref.number === saveQuestion.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${saveQuestion.questionNumber} to save.` };

    return {
      handled: true,
      paper,
      bankQuestion: target.question,
      message: `Saved Q${saveQuestion.questionNumber} to the question bank.`,
      toolName: "save_question_to_bank",
      skipVersion: true,
    };
  }

  const answerTarget = parseShowAnswerCommand(normalizedInstruction);
  if (answerTarget) {
    const target = refs.find((ref) => ref.number === answerTarget.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${answerTarget.questionNumber}.` };

    return {
      handled: true,
      paper,
      message: target.question.answer?.trim() ? `Answer for Q${answerTarget.questionNumber}: ${target.question.answer}` : `Q${answerTarget.questionNumber} does not have an answer saved yet.`,
      skipVersion: true,
    };
  }

  const diagram = parseAddDiagramCommand(normalizedInstruction);
  if (diagram) {
    const target = refs.find((ref) => ref.number === diagram.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${diagram.questionNumber} to add a diagram.` };

    if (diagram.partLabel) {
      const subpart = target.question.subparts?.find((item) => (item.label ?? "").toLowerCase() === diagram.partLabel);
      if (!subpart) return { handled: true, paper, message: `I could not find part (${diagram.partLabel}) in Q${diagram.questionNumber}.` };
      const nextPaper = updateSubpartInPaper(paper, target.section.id, target.question.id, subpart.id, {
        diagramBlocks: [...(subpart.diagramBlocks ?? []), createDiagramBlock(`Diagram for part (${subpart.label})`)],
      });

      return {
        handled: true,
        paper: applyDocumentStyle(nextPaper, documentStyle),
        message: `Added a diagram placeholder to Q${diagram.questionNumber} part (${subpart.label}).`,
        versionLabel: "chat_add_subpart_diagram",
        toolName: "add_diagram_placeholder",
      };
    }

    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, {
      diagramBlocks: [...(target.question.diagramBlocks ?? []), createDiagramBlock("Diagram placeholder")],
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Added a diagram placeholder to Q${diagram.questionNumber}.`,
      versionLabel: "chat_add_question_diagram",
      toolName: "add_diagram_placeholder",
    };
  }

  const addOption = parseAddOptionCommand(normalizedInstruction);
  if (addOption) {
    const target = refs.find((ref) => ref.number === addOption.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${addOption.questionNumber} to add an option.` };
    const options = target.question.options ?? [];
    const nextOptions = relabelOptions([
      ...options,
      {
        id: crypto.randomUUID(),
        label: String.fromCharCode(65 + options.length),
        text: addOption.text || "",
        richText: richTextFromText(addOption.text || ""),
        isCorrect: false,
      },
    ]);
    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, { type: "MCQ", options: nextOptions });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Added option ${String.fromCharCode(65 + options.length)} to Q${addOption.questionNumber}.`,
      versionLabel: "chat_add_option",
      toolName: "add_mcq_option",
    };
  }

  const optionCommand = parseOptionCommand(normalizedInstruction);
  if (optionCommand) {
    const target = refs.find((ref) => ref.number === optionCommand.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${optionCommand.questionNumber}.` };
    const optionIndex = optionIndexFromLabel(target.question, optionCommand.optionLabel);
    if (optionIndex < 0) return { handled: true, paper, message: `I could not find option ${optionCommand.optionLabel.toUpperCase()} in Q${optionCommand.questionNumber}.` };
    const options = target.question.options ?? [];
    const option = options[optionIndex];
    const nextOptions =
      optionCommand.action === "delete"
        ? relabelOptions(options.filter((_item, index) => index !== optionIndex))
        : relabelOptions([...options.slice(0, optionIndex + 1), { ...option, id: crypto.randomUUID() }, ...options.slice(optionIndex + 1)]);
    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, { options: nextOptions });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `${optionCommand.action === "delete" ? "Deleted" : "Duplicated"} option ${optionCommand.optionLabel.toUpperCase()} in Q${optionCommand.questionNumber}.`,
      versionLabel: optionCommand.action === "delete" ? "chat_delete_option" : "chat_duplicate_option",
      toolName: optionCommand.action === "delete" ? "delete_mcq_option" : "duplicate_mcq_option",
    };
  }

  const subpartCommand = parseSubpartCommand(normalizedInstruction);
  if (subpartCommand) {
    const target = refs.find((ref) => ref.number === subpartCommand.questionNumber);
    const subpart = target?.question.subparts?.find((item) => (item.label ?? "").toLowerCase() === subpartCommand.label);
    if (!target || !subpart) return { handled: true, paper, message: `I could not find part (${subpartCommand.label}) in Q${subpartCommand.questionNumber}.` };
    const subparts = target.question.subparts ?? [];
    const subpartIndex = subparts.findIndex((item) => item.id === subpart.id);
    const nextSubparts =
      subpartCommand.action === "delete"
        ? relabelSubparts(subparts.filter((item) => item.id !== subpart.id))
        : relabelSubparts([...subparts.slice(0, subpartIndex + 1), cloneSubpart(subpart), ...subparts.slice(subpartIndex + 1)]);
    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, { subparts: nextSubparts });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `${subpartCommand.action === "delete" ? "Deleted" : "Duplicated"} Q${subpartCommand.questionNumber} part (${subpartCommand.label}).`,
      versionLabel: subpartCommand.action === "delete" ? "chat_delete_subpart" : "chat_duplicate_subpart",
      toolName: subpartCommand.action === "delete" ? "delete_subpart" : "duplicate_subpart",
    };
  }

  const moveToOr = parseMoveQuestionToOrCommand(normalizedInstruction);
  if (moveToOr) {
    const source = refs.find((ref) => ref.number === moveToOr.source);
    const target = refs.find((ref) => ref.number === moveToOr.target);

    if (!source || !target) {
      return { handled: true, paper, message: `I could not find Q${moveToOr.source} or Q${moveToOr.target} in this paper.` };
    }

    if (source.question.id === target.question.id) {
      return { handled: true, paper, message: "A question cannot be moved into its own OR slot." };
    }

    if (choiceHasContent(target.question.optionalChoice) && !/\breplace\b/i.test(normalizedInstruction)) {
      return { handled: true, paper, message: `Q${moveToOr.target} already has an OR choice. Say "replace OR of Q${moveToOr.target} with Q${moveToOr.source}" if you want to overwrite it.` };
    }

    const nextPaper = moveQuestionIntoInternalChoice(paper, source, target);
    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Moved Q${moveToOr.source} into the OR choice of Q${moveToOr.target}. Marks still count only once for that question.`,
      versionLabel: "chat_move_question_to_or",
      toolName: "move_question_to_or",
    };
  }

  const duplicateNumber = parseQuestionTarget(lower, ["duplicate", "copy"]);
  if (duplicateNumber) {
    const target = refs.find((ref) => ref.number === duplicateNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${duplicateNumber} to duplicate.` };

    const nextPaper = updateSectionQuestions(paper, target.section.id, (questions) => [
      ...questions.slice(0, target.questionIndex + 1),
      cloneQuestion(target.question),
      ...questions.slice(target.questionIndex + 1),
    ]);

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Duplicated Q${duplicateNumber}. Question numbering has been recalculated.`,
      versionLabel: "chat_duplicate_question",
      toolName: "duplicate_question",
    };
  }

  const deleteNumber = parseQuestionTarget(lower, ["delete", "remove"]);
  if (deleteNumber) {
    const target = refs.find((ref) => ref.number === deleteNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${deleteNumber} to delete.` };

    const nextPaper = updateSectionQuestions(paper, target.section.id, (questions) => questions.filter((question) => question.id !== target.question.id));
    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Deleted Q${deleteNumber}. The remaining questions have been renumbered automatically.`,
      versionLabel: "chat_delete_question",
      toolName: "delete_question",
    };
  }

  const addPart = parseAddPartCommand(normalizedInstruction);
  if (addPart) {
    const target = refs.find((ref) => ref.number === addPart.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${addPart.questionNumber} to add a part.` };

    const subparts = target.question.subparts ?? [];
    const nextLabel = nextSubpartLabel(subparts);
    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, {
      subparts: [
        ...subparts,
        {
          id: crypto.randomUUID(),
          label: nextLabel,
          text: "",
          richText: "",
          marks: addPart.marks ?? 1,
          answer: "",
          answerRichText: "",
        },
      ],
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Added part (${nextLabel}) to Q${addPart.questionNumber}.`,
      versionLabel: "chat_add_subpart",
      toolName: "add_subpart",
    };
  }

  const partChoice = parseAddSubpartChoiceCommand(normalizedInstruction);
  if (partChoice) {
    const target = refs.find((ref) => ref.number === partChoice.questionNumber);
    const subpart = target?.question.subparts?.find((item) => (item.label ?? "").toLowerCase() === partChoice.label);
    if (!target || !subpart) return { handled: true, paper, message: `I could not find part (${partChoice.label}) in Q${partChoice.questionNumber}.` };

    if (subpart.optionalChoice) {
      return { handled: true, paper, message: `Q${partChoice.questionNumber} part (${partChoice.label}) already has an OR choice. Remove the existing OR first.` };
    }

    const nextPaper = updateSubpartInPaper(paper, target.section.id, target.question.id, subpart.id, {
      optionalChoice: {
        id: crypto.randomUUID(),
        text: "",
        richText: "",
        marks: subpart.marks,
        answer: "",
        answerRichText: "",
      },
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Added an OR alternative for Q${partChoice.questionNumber} part (${partChoice.label}).`,
      versionLabel: "chat_add_subpart_or",
      toolName: "add_subpart_or",
    };
  }

  const wholeChoiceNumber = parseAddWholeQuestionChoiceCommand(normalizedInstruction);
  if (wholeChoiceNumber) {
    const target = refs.find((ref) => ref.number === wholeChoiceNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${wholeChoiceNumber} to add OR.` };

    if (target.question.optionalChoice) {
      return { handled: true, paper, message: `Q${wholeChoiceNumber} already has an OR choice. Remove the existing OR first, or use 'replace OR of Q${wholeChoiceNumber}' to update it.` };
    }

    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, {
      optionalChoice: emptyChoiceFromQuestion(target.question),
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Added an OR internal choice block to Q${wholeChoiceNumber}.`,
      versionLabel: "chat_add_question_or",
      toolName: "add_question_or",
    };
  }

  // #226: local marks setter — avoids global-vs-section index confusion in the AI
  const marksChange = parseSetMarksCommand(normalizedInstruction);
  if (marksChange) {
    const target = refs.find((ref) => ref.number === marksChange.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${marksChange.questionNumber}.` };
    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, { marks: marksChange.marks });
    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Set Q${marksChange.questionNumber} marks to ${marksChange.marks}.`,
      versionLabel: "chat_set_marks",
      toolName: "add_subpart",
    };
  }

  // #230: "convert Q5 to 3-part" — add multiple subparts at once
  const convertToParts = parseConvertToPartsCommand(normalizedInstruction);
  if (convertToParts) {
    const target = refs.find((ref) => ref.number === convertToParts.questionNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${convertToParts.questionNumber}.` };
    const existing = target.question.subparts ?? [];
    const toAdd = Math.max(0, convertToParts.count - existing.length);
    if (toAdd === 0) {
      return { handled: true, paper, message: `Q${convertToParts.questionNumber} already has ${existing.length} part${existing.length !== 1 ? "s" : ""}.` };
    }
    let subparts: PaperSubpart[] = [...existing];
    for (let i = 0; i < toAdd; i++) {
      const label = nextSubpartLabel(subparts);
      subparts = [...subparts, { id: crypto.randomUUID(), label, text: "", richText: "", marks: 1, answer: "" }];
    }
    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, { subparts });
    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Q${convertToParts.questionNumber} now has ${convertToParts.count} parts. Fill in the text and marks for each.`,
      versionLabel: "chat_convert_to_parts",
      toolName: "add_subpart",
    };
  }

  // #199: no-op type conversion — detect "convert Q1 MCQ to MCQ" before sending to AI
  const typeConvTarget = parseNoOpTypeConversionCommand(normalizedInstruction);
  if (typeConvTarget) {
    const target = refs.find((ref) => ref.number === typeConvTarget.questionNumber);
    if (target && normalizeQuestionTypeName(target.question.type) === typeConvTarget.type) {
      return { handled: true, paper, message: `Q${typeConvTarget.questionNumber} is already ${target.question.type}.`, skipVersion: true };
    }
  }

  // #229: swap two sections locally
  const swapCmd = parseSwapSectionsCommand(normalizedInstruction);
  if (swapCmd) {
    const findSection = (key: string) => {
      const k = key.toLowerCase();
      const wordRe = new RegExp(`\\b${k}\\b`);
      return (
        paper.sections.find((s) => s.title.toLowerCase() === k) ??
        paper.sections.find((s) => s.title.toLowerCase() === `section ${k}`) ??
        paper.sections.find((s) => wordRe.test(s.title.toLowerCase()))
      );
    };
    const sA = findSection(swapCmd.keyA);
    const sB = findSection(swapCmd.keyB);
    if (!sA || !sB || sA.id === sB.id) {
      return { handled: true, paper, message: `Could not find both sections to swap (tried "${swapCmd.keyA}" and "${swapCmd.keyB}").` };
    }
    const idxA = paper.sections.indexOf(sA);
    const idxB = paper.sections.indexOf(sB);
    const sections = [...paper.sections];
    [sections[idxA], sections[idxB]] = [sections[idxB], sections[idxA]];
    const nextPaper = normalizePaperStructure({ ...paper, sections });
    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Swapped ${sA.title} and ${sB.title}.`,
      versionLabel: "chat_swap_sections",
      toolName: "swap_sections",
    };
  }

  // #233: marks integrity check — answer locally without AI
  if (/\b(check|verify|validate)\b/i.test(lower) && /\bmarks?\b/i.test(lower)) {
    const total = paper.sections.reduce((t, s) => t + countedSectionMarks(s), 0);
    const headerTotal = (paper as unknown as { summary?: { totalMarks?: number } }).summary?.totalMarks;
    if (headerTotal !== undefined) {
      const ok = total === headerTotal;
      return {
        handled: true,
        paper,
        message: ok
          ? `Marks check passed: ${total} marks (matches header).`
          : `Marks mismatch: paper totals ${total} marks but the header says ${headerTotal}. Adjust question marks to fix.`,
        skipVersion: true,
      };
    }
    return { handled: true, paper, message: `Current paper total: ${total} marks.`, skipVersion: true };
  }

  return { handled: false };
}

function buildTargetedRefinementInstruction(paper: Paper, instruction: string) {
  const target = findQuestionRefFromInstruction(getQuestionRefs(paper), instruction);
  if (!target) return instruction;

  return [
    instruction,
    "",
    `Target global question: Q${target.number}`,
    `Target question id: ${target.question.id}`,
    `Target section: ${target.section.title}`,
    `Current stem: ${target.question.text}`,
    `Current marks/type/difficulty: ${target.question.marks} marks, ${target.question.type}, ${target.question.difficulty}`,
    "Apply the requested change only to this target unless the teacher explicitly asks for a broader paper-level edit.",
    "Preserve structured fields: put MCQ options in options[], subparts in subparts[], and OR choices in optionalChoice fields.",
  ].join("\n");
}

function buildSimilarOrChoiceInstruction(target: QuestionRef, instruction: string) {
  return [
    instruction,
    "",
    `Target global question: Q${target.number}`,
    `Target question id: ${target.question.id}`,
    `Target section: ${target.section.title}`,
    `Main question stem: ${target.question.text}`,
    `Current marks/type/difficulty/topic: ${target.question.marks} marks, ${target.question.type}, ${target.question.difficulty}, ${target.question.topic || "same topic"}`,
    "Create a genuinely different but same-topic OR internal choice for this target question.",
    "Put the new question only in the target question's optionalChoice field.",
    "Do not move, delete, duplicate, or replace the main question.",
    "Do not set the main question itself as its own optionalChoice.",
    "Keep the counted marks unchanged; the OR branch should carry the same marks as the target question.",
    "Preserve structured fields: MCQ options belong in options[], subparts in subparts[], and answers in answer/answerRichText.",
  ].join("\n");
}

function buildReplaceQuestionInstruction(target: QuestionRef, instruction: string) {
  return [
    instruction,
    "",
    `Target global question: Q${target.number}`,
    `Target question id: ${target.question.id}`,
    `Target section: ${target.section.title}`,
    `Current stem: ${target.question.text}`,
    `Current marks/type/difficulty/topic: ${target.question.marks} marks, ${target.question.type}, ${target.question.difficulty}, ${target.question.topic || "same topic"}`,
    "Replace only this target question with a different valid question from the selected source context.",
    "Preserve the counted marks and paper total unless the teacher explicitly asks otherwise.",
    "Keep structured fields valid: MCQ options in options[], subparts in subparts[], answers in answer/answerRichText.",
  ].join("\n");
}

function buildReplaceOrChoiceInstruction(target: QuestionRef, instruction: string) {
  return [
    instruction,
    "",
    `Target global question: Q${target.number}`,
    `Target question id: ${target.question.id}`,
    `Target section: ${target.section.title}`,
    `Main question stem: ${target.question.text}`,
    `Current OR choice: ${target.question.optionalChoice?.text ?? ""}`,
    "Replace only the optionalChoice branch for this target question.",
    "Do not change the main question stem.",
    "Keep the optionalChoice marks aligned with the target question marks.",
  ].join("\n");
}

function getQuestionRefs(paper: Paper): QuestionRef[] {
  const refs: QuestionRef[] = [];
  let number = 1;

  paper.sections.forEach((section, sectionIndex) => {
    section.questions.forEach((question, questionIndex) => {
      refs.push({ number, section, sectionIndex, question, questionIndex });
      number += 1;
    });
  });

  return refs;
}

function parseMoveQuestionToOrCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(move|put|add|shift|replace)\b/.test(lower) || !/\bor\b/.test(lower)) return null;
  if (/\b(similar|same topic|different|generate|new)\b/.test(lower)) return null;
  if (!/\b(?:q|ques|question|quesion)\s*\.?\s*\d+\b/.test(lower)) return null;

  const replacePattern = lower.match(/\breplace\s+(?:the\s+)?or(?:\s+choice)?\s+of\s+(?:q|ques|question|quesion)\s*\.?\s*(\d+)\s+with\s+(?:q|ques|question|quesion)\s*\.?\s*(\d+)/);
  if (replacePattern) return { target: Number(replacePattern[1]), source: Number(replacePattern[2]) };

  const numbers = questionNumbersFromText(lower);
  if (numbers.length < 2) return null;

  return { source: numbers[0], target: numbers[1] };
}

function parseReplaceQuestionCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(replace|change|swap|regenerate)\b/.test(lower)) return null;
  if (/\bor\b|internal choice/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber };
}

function parseReplaceChoiceCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(replace|change|swap|regenerate)\b/.test(lower) || !/\bor\b|internal choice/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber };
}

function parseGenerateSimilarOrChoiceCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\bor\b|internal choice/.test(lower)) return null;
  if (!/\b(similar|same topic|different|generate|new)\b/.test(lower)) return null;
  if (!/\b(add|create|insert|generate|make)\b/.test(lower)) return null;

  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber };
}

function parseAddBlankQuestionCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(add|create|insert)\b/.test(lower)) return null;
  if (!/\b(blank|empty|manual)\b/.test(lower)) return null;
  if (!/\b(question|ques|q)\b/.test(lower)) return null;
  return {};
}

function parseAddPartCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(add|create|insert)\b/.test(lower) || !/\b(part|subpart|sub-question|sub question)\b/.test(lower) || /\bor\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber, marks: inferMarks(instruction) };
}

function parseAddDiagramCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(add|insert|create)\b/.test(lower) || !/\b(diagram|figure|drawing|image placeholder)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber, partLabel: partLabelFromText(lower) };
}

function parseOptionCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  const action = /\b(delete|remove)\b/.test(lower) ? "delete" : /\b(duplicate|copy)\b/.test(lower) ? "duplicate" : null;
  if (!action || !/\b(option|choice)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  const optionLabel =
    lower.match(/\b(?:option|choice)\s*\(?([a-z])\)?/)?.[1] ??
    lower.match(/\(([a-z])\)/)?.[1];
  if (!questionNumber || !optionLabel) return null;
  return { action, questionNumber, optionLabel };
}

function parseAddOptionCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(add|create|insert)\b/.test(lower) || !/\b(option|choice)\b/.test(lower)) return null;
  if (/\b(delete|remove|duplicate|copy)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  const text = instruction.match(/["']([^"']+)["']/)?.[1] ?? "";
  return { questionNumber, text };
}

function parseSubpartCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  const action = /\b(delete|remove)\b/.test(lower) ? "delete" : /\b(duplicate|copy)\b/.test(lower) ? "duplicate" : null;
  if (!action || !/\b(part|subpart|sub-question|sub question)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  const label = partLabelFromText(lower);
  if (!questionNumber || !label) return null;
  return { action, questionNumber, label };
}

function parseAddSubpartChoiceCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\bor\b/.test(lower) || !/\b(part|subpart|sub-question|sub question)\b/.test(lower)) return null;

  const questionNumber = questionNumbersFromText(lower)[0];
  const label = partLabelFromText(lower);
  if (!questionNumber || !label) return null;
  return { questionNumber, label };
}

function parseAddWholeQuestionChoiceCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(add|create|insert)\b/.test(lower) || !/\bor\b|internal choice/.test(lower)) return null;
  if (/\b(part|subpart|sub-question|sub question)\b/.test(lower) && partLabelFromText(lower)) return null;
  return questionNumbersFromText(lower)[0] ?? null;
}

function parseSetMarksCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(set|change|update|make)\b/.test(lower) || !/\bmarks?\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  const toMatch = lower.match(/\bto\s+(\d+)\b/);
  const marks = inferMarks(instruction) ?? (toMatch ? Number(toMatch[1]) : NaN);
  if (!questionNumber || !Number.isFinite(marks) || marks <= 0) return null;
  return { questionNumber, marks };
}

function parseConvertToPartsCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(convert|make|change|turn|split)\b/.test(lower)) return null;
  if (!/\b(part|parts|subpart|subparts)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  const countMatch = lower.match(/\b(\d+)[- ]?(?:part|subpart)/);
  const count = countMatch ? Number(countMatch[1]) : NaN;
  if (!questionNumber || !Number.isFinite(count) || count < 2) return null;
  return { questionNumber, count };
}

// #199: detect "convert Q1 MCQ to MCQ" — same-type no-op
function parseNoOpTypeConversionCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(convert|change|make|turn)\b/.test(lower)) return null;
  const toMatch = lower.match(/\bto\s+(mcq|multiple[\s-]?choice|sa|short[\s-]?answer|la|long[\s-]?answer|fill[\s-]?in|true[\s\/]false|case\s+study|vsa|very\s+short)\b/);
  if (!toMatch) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber, type: normalizeQuestionTypeName(toMatch[1]) };
}

// #227: "generate N MCQs from Quadratic Equations"
function parseGenerateQuestionsCommand(
  instruction: string,
): { count: number; questionType: string | null; topic: string } | null {
  const lower = instruction.toLowerCase();
  if (!/\b(?:generate|create|add|make|write|give\s+me)\b/.test(lower)) return null;
  if (!/\b(?:questions?|mcqs?|multiple[\s-]?choice|short[\s-]?answer\b|\bsa\b|long[\s-]?answer\b|\bla\b|vsa\b|very[\s-]?short|fill[\s-]?in|fib\b|true[\s-]?false|case[\s-]?study)\b/.test(lower)) return null;

  const countMatch = lower.match(/\b(\d+)\b/);
  if (!countMatch) return null;
  const count = parseInt(countMatch[1], 10);
  if (count < 1 || count > 20) return null;

  let questionType: string | null = null;
  if (/\bmcqs?\b|\bmultiple[\s-]?choice\b/.test(lower)) questionType = "MCQ";
  else if (/\bvsa\b|\bvery[\s-]?short\b/.test(lower)) questionType = "VSA";
  else if (/\bla\b|\blong[\s-]?answer\b/.test(lower)) questionType = "LA";
  else if (/\bsa\b|\bshort[\s-]?answer\b/.test(lower)) questionType = "SA";
  else if (/\bfill[\s-]?in\b|\bfib\b/.test(lower)) questionType = "Fill in the Blanks";
  else if (/\btrue[\s-]?false\b/.test(lower)) questionType = "True/False";
  else if (/\bcase[\s-]?study\b/.test(lower)) questionType = "Case Study";

  const topicMatch = instruction.match(/\b(?:from|on|about|related\s+to|based\s+on|of|for)\s+(.+)$/i);
  if (!topicMatch) return null;
  const topic = topicMatch[1].trim().replace(/[.!?]+$/, "");
  if (!topic) return null;

  return { count, questionType, topic };
}

// #229: "swap/exchange/switch section(s) A and/with B"
function parseSwapSectionsCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(?:swap|exchange|switch|interchange)\b/.test(lower)) return null;
  if (!/\bsections?\b/.test(lower)) return null;

  // "swap section A and/with section B" — both names prefixed with "section"
  const m1 = lower.match(/\bsections?\s+([a-z][a-z0-9]*)\s+(?:and|with)\s+sections?\s+([a-z][a-z0-9]*)(?:\s|$)/);
  if (m1) return { keyA: m1[1].trim(), keyB: m1[2].trim() };

  // "swap sections A and/with B" — second name has no "section" prefix
  const m2 = lower.match(/\bsections?\s+([a-z][a-z0-9]*)\s+(?:and|with)\s+([a-z][a-z0-9]*)(?:\s|$)/);
  if (m2) return { keyA: m2[1].trim(), keyB: m2[2].trim() };

  return null;
}

function normalizeQuestionTypeName(raw: string) {
  const s = raw.toLowerCase().replace(/[-\s]+/g, "");
  if (s.includes("mcq") || s.includes("multiplechoice")) return "MCQ";
  if (s.includes("shortanswer") || s === "sa") return "SA";
  if (s.includes("longanswer") || s === "la") return "LA";
  if (s.includes("fill")) return "Fill in the Blanks";
  if (s.includes("true") || s.includes("false")) return "True/False";
  if (s.includes("case")) return "Case Study";
  if (s.includes("veryshort") || s === "vsa") return "VSA";
  return raw.trim();
}

function parseSaveQuestionToBankCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\bsave\b/.test(lower) || !/\b(bank|question bank|library|reuse)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber };
}

function parseShowAnswerCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  if (!/\b(show|view|tell|display)\b/.test(lower) || !/\b(answer|solution|marking scheme)\b/.test(lower)) return null;
  const questionNumber = questionNumbersFromText(lower)[0];
  if (!questionNumber) return null;
  return { questionNumber };
}

function partLabelFromText(text: string) {
  const partMatch = text.match(/\bpart\s*(?:\(([a-z])\)|([a-z])\b)/);
  const subpartMatch = text.match(/\bsubpart\s*(?:\(([a-z])\)|([a-z])\b)/);
  return partMatch?.[1] ?? partMatch?.[2] ?? subpartMatch?.[1] ?? subpartMatch?.[2] ?? text.match(/\(([a-z])\)/)?.[1];
}

function parseQuestionTarget(instruction: string, verbs: string[]) {
  if (!verbs.some((verb) => instruction.includes(verb))) return null;
  return questionNumbersFromText(instruction)[0] ?? null;
}

function questionNumbersFromText(text: string) {
  const numbers = Array.from(text.matchAll(/\b(?:q|ques|question|quesion)\s*\.?\s*(\d+)\b/g)).map((match) => Number(match[1]));
  if (numbers.length > 0) return numbers.filter(Number.isFinite);

  const ordinal = text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:q|ques|question|quesion)\b/)?.[1];
  const ordinalNumber = ordinal ? ordinalToNumber(ordinal) : null;
  return ordinalNumber ? [ordinalNumber] : [];
}

function findQuestionRefFromInstruction(refs: QuestionRef[], instruction: string) {
  const questionNumber = questionNumbersFromText(instruction.toLowerCase())[0];
  return questionNumber ? refs.find((ref) => ref.number === questionNumber) : undefined;
}

function ordinalToNumber(value: string) {
  const map: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  return map[value] ?? null;
}

function isSaveVersionCommand(instruction: string) {
  return /\bsave\b/.test(instruction) && /\b(version|draft|paper)\b/.test(instruction);
}

function isAddSectionCommand(instruction: string) {
  // #237/#238: only match when "section" is the primary target, not a location ("in section A", "to section B")
  return (
    /\b(add|create|insert)\b/.test(instruction) &&
    /\bsection\b/.test(instruction) &&
    !/\b(in|to|into|for)\s+(?:the\s+)?section\b/.test(instruction)
  );
}

function isCreateMcqCommand(instruction: string) {
  return /\b(create|add|insert)\b/.test(instruction) && /\b(mcq|multiple choice)\b/.test(instruction);
}

function isImageImportCommand(instruction: string) {
  const lower = instruction.toLowerCase();
  return /\b(import|upload|extract|scan)\b/.test(lower) && /\b(image|photo|picture|screenshot)\b/.test(lower);
}

function findSectionForChatCommand(paper: Paper, instruction: string) {
  const lower = instruction.toLowerCase();
  const sectionLetter = lower.match(/\bsection\s*([a-z])\b/)?.[1];
  if (sectionLetter) {
    const expectedTitle = `section ${sectionLetter}`.toLowerCase();
    return paper.sections.find((section) => section.title.toLowerCase().includes(expectedTitle));
  }

  const sectionNumber = Number(lower.match(/\bsection\s*(\d+)\b/)?.[1]);
  if (Number.isFinite(sectionNumber) && sectionNumber > 0) return paper.sections[sectionNumber - 1];

  return paper.sections[0];
}

function inferSectionTitle(instruction: string, existingCount: number) {
  const quoted = instruction.match(/["']([^"']+)["']/)?.[1];
  if (quoted) return quoted;
  // #246: capture unquoted names after "called" or "named"
  const named = instruction.match(/\b(?:called|named)\s+([A-Za-z][A-Za-z0-9 ]*?)(?:\s+with\b|\s+\d|\s*$)/i)?.[1]?.trim();
  if (named) return named;
  const letter = String.fromCharCode(65 + existingCount);
  return `Section ${letter}`;
}

function inferDifficulty(instruction: string) {
  const lower = instruction.toLowerCase();
  if (lower.includes("hard")) return "Hard";
  if (lower.includes("easy")) return "Easy";
  if (lower.includes("mixed")) return "Mixed";
  return "Medium";
}

function inferMarks(instruction: string) {
  const value = Number(instruction.match(/(\d+)\s*(?:mark|marks)/i)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function updateSectionQuestions(paper: Paper, sectionId: string, updater: (questions: PaperQuestion[]) => PaperQuestion[]) {
  return normalizePaperStructure({
    ...paper,
    sections: paper.sections.map((section) => (section.id === sectionId ? { ...section, questions: updater(section.questions) } : section)),
  });
}

function updateQuestionInPaper(paper: Paper, sectionId: string, questionId: string, patch: Partial<PaperQuestion>) {
  return updateSectionQuestions(paper, sectionId, (questions) =>
    questions.map((question) => (question.id === questionId ? { ...question, ...patch } : question)),
  );
}

function updateSubpartInPaper(paper: Paper, sectionId: string, questionId: string, subpartId: string, patch: Partial<PaperSubpart>) {
  const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
  if (!question) return paper;

  return updateQuestionInPaper(paper, sectionId, questionId, {
    subparts: (question.subparts ?? []).map((subpart) => (subpart.id === subpartId ? { ...subpart, ...patch } : subpart)),
  });
}

function moveQuestionIntoInternalChoice(paper: Paper, source: QuestionRef, target: QuestionRef) {
  let movingQuestion: PaperQuestion | null = null;

  const sectionsWithoutSource = paper.sections.map((section) => ({
    ...section,
    questions: section.questions.filter((question) => {
      if (section.id === source.section.id && question.id === source.question.id) {
        movingQuestion = question;
        return false;
      }

      return true;
    }),
  }));

  if (!movingQuestion) return paper;

  return normalizePaperStructure({
    ...paper,
    sections: sectionsWithoutSource.map((section) => ({
      ...section,
      questions: section.questions.map((question) =>
        question.id === target.question.id
          ? {
              ...question,
              optionalChoice: choiceFromQuestion(movingQuestion as PaperQuestion),
            }
          : question,
      ),
    })),
  });
}

function choiceFromQuestion(question: PaperQuestion): NonNullable<PaperQuestion["optionalChoice"]> {
  return {
    id: crypto.randomUUID(),
    text: question.text,
    richText: question.richText,
    options: question.options?.map((option) => ({ ...option, id: crypto.randomUUID(), imageAssets: option.imageAssets?.map((asset) => ({ ...asset })) })),
    subparts: question.subparts?.map((subpart) => ({
      ...subpart,
      id: crypto.randomUUID(),
      imageAssets: subpart.imageAssets?.map((asset) => ({ ...asset })),
      options: subpart.options?.map((option) => ({ ...option, id: crypto.randomUUID(), imageAssets: option.imageAssets?.map((asset) => ({ ...asset })) })),
      optionalChoice: subpart.optionalChoice
        ? {
            ...subpart.optionalChoice,
            id: crypto.randomUUID(),
            imageAssets: subpart.optionalChoice.imageAssets?.map((asset) => ({ ...asset })),
            options: subpart.optionalChoice.options?.map((option) => ({
              ...option,
              id: crypto.randomUUID(),
              imageAssets: option.imageAssets?.map((asset) => ({ ...asset })),
            })),
          }
        : undefined,
    })),
    imageAssets: question.imageAssets?.map((asset) => ({ ...asset })),
    marks: question.marks,
    type: question.type,
    difficulty: question.difficulty,
    source: question.source || "Moved OR",
    topic: question.topic,
    tags: question.tags,
    answer: question.answer,
    answerRichText: question.answerRichText,
  };
}

function emptyChoiceFromQuestion(question: PaperQuestion): NonNullable<PaperQuestion["optionalChoice"]> {
  return {
    id: crypto.randomUUID(),
    text: "",
    richText: "",
    options:
      question.type === "MCQ"
        ? Array.from({ length: Math.max(question.options?.length ?? 4, 4) }, (_item, index) => ({
            id: crypto.randomUUID(),
            label: String.fromCharCode(65 + index),
            text: "",
            richText: "",
            isCorrect: false,
          }))
        : undefined,
    marks: question.marks,
    type: question.type,
    difficulty: question.difficulty,
    source: "Manual OR",
    topic: question.topic,
    tags: question.tags,
    answer: "",
    answerRichText: "",
  };
}

function createBlankMcqQuestion(paper: Paper): PaperQuestion {
  return normalizeRawQuestion({
    id: crypto.randomUUID(),
    text: "Write the MCQ stem here.",
    richText: richTextFromText("Write the MCQ stem here."),
    marks: 1,
    type: "MCQ",
    difficulty: paper.summary.difficulty || "Medium",
    source: "Manual",
    topic: paper.metadata.topic || paper.metadata.chapter,
    options: ["Option A", "Option B", "Option C", "Option D"].map((text, index) => ({
      id: crypto.randomUUID(),
      label: String.fromCharCode(65 + index),
      text,
      richText: richTextFromText(text),
      isCorrect: index === 0,
    })),
    answer: "A",
    answerRichText: richTextFromText("A"),
  });
}

function createBlankQuestion(paper: Paper): PaperQuestion {
  return normalizeRawQuestion({
    id: crypto.randomUUID(),
    text: "",
    richText: "",
    marks: 1,
    type: "SA",
    difficulty: paper.summary.difficulty || "Medium",
    source: "Manual",
    topic: paper.metadata.topic || paper.metadata.chapter,
    answer: "",
    answerRichText: "",
  });
}

function createDiagramBlock(title: string): NonNullable<PaperQuestion["diagramBlocks"]>[number] {
  return {
    id: crypto.randomUUID(),
    title,
    caption: "Upload or generate a diagram later.",
    status: "placeholder",
  };
}

function cloneQuestion(question: PaperQuestion): PaperQuestion {
  return normalizeRawQuestion({
    ...question,
    id: crypto.randomUUID(),
    imageAssets: question.imageAssets?.map((asset) => ({ ...asset })),
    options: question.options?.map((option) => ({ ...option, id: crypto.randomUUID(), imageAssets: option.imageAssets?.map((asset) => ({ ...asset })) })),
    subparts: question.subparts?.map((subpart) => ({
      ...subpart,
      id: crypto.randomUUID(),
      imageAssets: subpart.imageAssets?.map((asset) => ({ ...asset })),
      options: subpart.options?.map((option) => ({ ...option, id: crypto.randomUUID(), imageAssets: option.imageAssets?.map((asset) => ({ ...asset })) })),
      optionalChoice: subpart.optionalChoice
        ? {
            ...subpart.optionalChoice,
            id: crypto.randomUUID(),
            imageAssets: subpart.optionalChoice.imageAssets?.map((asset) => ({ ...asset })),
            options: subpart.optionalChoice.options?.map((option) => ({
              ...option,
              id: crypto.randomUUID(),
              imageAssets: option.imageAssets?.map((asset) => ({ ...asset })),
            })),
          }
        : undefined,
    })),
    optionalChoice: question.optionalChoice
      ? {
          ...question.optionalChoice,
          id: crypto.randomUUID(),
          imageAssets: question.optionalChoice.imageAssets?.map((asset) => ({ ...asset })),
          options: question.optionalChoice.options?.map((option) => ({
            ...option,
            id: crypto.randomUUID(),
            imageAssets: option.imageAssets?.map((asset) => ({ ...asset })),
          })),
        }
      : undefined,
  });
}

function cloneSubpart(subpart: PaperSubpart): PaperSubpart {
  return {
    ...subpart,
    id: crypto.randomUUID(),
    imageAssets: subpart.imageAssets?.map((asset) => ({ ...asset })),
    options: subpart.options?.map((option) => ({ ...option, id: crypto.randomUUID(), imageAssets: option.imageAssets?.map((asset) => ({ ...asset })) })),
    optionalChoice: subpart.optionalChoice
      ? {
          ...subpart.optionalChoice,
          id: crypto.randomUUID(),
          imageAssets: subpart.optionalChoice.imageAssets?.map((asset) => ({ ...asset })),
          options: subpart.optionalChoice.options?.map((option) => ({
            ...option,
            id: crypto.randomUUID(),
            imageAssets: option.imageAssets?.map((asset) => ({ ...asset })),
          })),
        }
      : undefined,
    diagramBlocks: subpart.diagramBlocks?.map((diagram) => ({ ...diagram, id: crypto.randomUUID() })),
  };
}

function relabelSubparts(subparts: PaperSubpart[]) {
  return subparts.map((subpart, index) => ({ ...subpart, label: String.fromCharCode(97 + index) }));
}

function relabelOptions(options: PaperQuestionOption[]) {
  return options.map((option, index) => ({ ...option, label: String.fromCharCode(65 + index) }));
}

function optionIndexFromLabel(question: PaperQuestion, label: string) {
  const normalized = label.toLowerCase();
  return (question.options ?? []).findIndex((option, index) => {
    const optionLabel = (option.label || String.fromCharCode(65 + index)).toLowerCase().replace(/[().]/g, "");
    return optionLabel === normalized;
  });
}

function nextSubpartLabel(subparts: PaperSubpart[]) {
  return String.fromCharCode(97 + subparts.length);
}

function recalculatePaper(paper: Paper): Paper {
  const sections = paper.sections.map((section) => ({
    ...section,
    questions: section.questions.map(questionWithComputedMarks),
  }));
  const totalMarks = sections.reduce((paperTotal, section) => paperTotal + countedSectionMarks(section), 0);
  const questionCount = sections.reduce((count, section) => count + section.questions.length, 0);
  const topicWeightage: Record<string, number> = {};

  sections.forEach((section) => {
    section.questions.forEach((question) => {
      const topic = question.topic || paper.metadata.topic || paper.metadata.chapter || section.title || "Unassigned";
      topicWeightage[topic] = (topicWeightage[topic] || 0) + countedQuestionMarks(question);
    });
  });

  return {
    ...paper,
    sections,
    summary: {
      ...paper.summary,
      totalMarks,
      questionCount,
    },
    topicWeightage,
    sourceMix: calculateSourceMix(paper),
    pageCount: Math.max(1, Math.ceil((questionCount * 76 + sections.length * 120 + 260) / 980)),
  };
}

function applyDocumentStyle(paper: Paper, documentStyle: DocumentStyle): Paper {
  return { ...paper, documentStyle };
}

function applyTemplateToExistingPaper(paper: Paper, template: PaperTemplate): Paper {
  const sections = templateSections(template);
  const inferred = template.inferredParams ?? {};

  return applyDocumentStyle(
    recalculatePaper({
      ...paper,
      metadata: {
        ...paper.metadata,
        format: template.name,
        durationMinutes: inferred.durationMinutes ?? paper.metadata.durationMinutes,
      },
      sections:
        sections.length > 0
          ? paper.sections.map((section, index) => ({
              ...section,
              title: sections[index] ?? section.title,
              instructions: sectionInstructions(template.name, sections[index] ?? section.title, section.instructions),
            }))
          : paper.sections,
      documentStyle: {
        ...paper.documentStyle,
        ...template.formatting,
      },
    }),
    {
      ...defaultDocumentStyle,
      ...paper.documentStyle,
      ...template.formatting,
    },
  );
}

function templateSections(template: PaperTemplate) {
  return template.sections ?? defaultTemplateSections(template.name);
}

function defaultTemplateSections(name: string) {
  const normalized = name.toLowerCase();

  if (normalized.includes("unit")) return ["Section A: Objective", "Section B: Short Answer", "Section C: Application"];
  if (normalized.includes("mid")) return ["Section A: MCQ", "Section B: VSA", "Section C: SA", "Section D: LA"];
  if (normalized.includes("full")) return ["Section A: MCQ", "Section B: Very Short Answer", "Section C: Short Answer", "Section D: Long Answer", "Section E: Case Study"];
  return ["Section A", "Section B", "Section C", "Section D"];
}

function sectionInstructions(templateName: string, sectionTitle: string, existing: string) {
  const normalized = templateName.toLowerCase();
  const title = sectionTitle.toLowerCase();

  if (normalized.includes("unit")) {
    if (title.includes("objective")) return "Attempt all objective questions. Each question carries the marks shown.";
    if (title.includes("application")) return "Show method, reasoning, and final result.";
  }

  if (normalized.includes("full")) {
    if (title.includes("mcq")) return "This section contains Multiple Choice Questions. Choose the correct option.";
    if (title.includes("case")) return "Read the case carefully and answer the sub-parts.";
    if (title.includes("long")) return "Write complete solutions with proper steps.";
  }

  if (normalized.includes("mid")) {
    if (title.includes("vsa")) return "Answer briefly with reason where required.";
    if (title.includes("la")) return "Solve with complete steps and final conclusion.";
  }

  return existing;
}

function createDraftPaper(request: PaperRequest, documentStyle: DocumentStyle): Paper {
  return applyDocumentStyle(
    recalculatePaper({
      id: crypto.randomUUID(),
      title: `${request.subject} Draft Paper`,
      metadata: {
        board: request.board,
        classLevel: request.classLevel,
        subject: request.subject,
        chapter: request.chapter || request.chapters[0] || "",
        topic: request.topic || request.chapter || request.chapters.join(", "),
        durationMinutes: request.durationMinutes,
        source: request.source,
        qpCode: "Draft",
      },
      summary: {
        totalMarks: 0,
        questionCount: 0,
        difficulty: request.difficulty,
        sourceCoverage: "Manual/import draft",
      },
      sections: [
        {
          id: crypto.randomUUID(),
          title: "Imported Questions",
          instructions: "Review imported questions before export.",
          questions: [],
        },
      ],
      warnings: [],
    }),
    documentStyle,
  );
}

function appendQuestionToPaper(paper: Paper, question: PaperQuestion, sectionId?: string): Paper {
  const targetSectionId = sectionId ?? paper.sections[0]?.id;
  if (!targetSectionId) return paper;

  return normalizePaperStructure({
    ...paper,
    sections: paper.sections.map((section) =>
      section.id === targetSectionId
        ? {
            ...section,
            questions: [...section.questions, normalizeRawQuestion({ ...question, id: crypto.randomUUID() })],
          }
        : section,
    ),
  });
}

function paperToHtml(paper: Paper, documentStyle: DocumentStyle) {
  const printablePaper = normalizePaperStructure(paper);
  let questionNumber = 1;
  const sectionHtml = printablePaper.sections
    .map((section) => {
      const questions = section.questions
        .map((question) => {
          const optionsHtml = (question.options ?? [])
            .map((option, optionIndex) => optionToHtml(formatPrintOptionLabel(option.label, optionIndex), richOrTextHtml(option.richText, option.text), option.imageAssets))
            .join("");
          const choiceOptionsHtml = optionListToHtml(question.optionalChoice?.options);
          const subpartsHtml = (question.subparts ?? [])
            .map(
              (subpart) => {
                const subpartOptionsHtml = optionListToHtml(subpart.options);
                const subpartChoiceOptionsHtml = optionListToHtml(subpart.optionalChoice?.options);

                return `
                  <div class="subpart"><strong>(${escapeHtml(subpart.label || "")})</strong><div>${richOrTextHtml(subpart.richText, subpart.text)}${imageAssetsToHtml(subpart.imageAssets)}</div><span>[${subpart.marks ?? ""} marks]</span></div>
                  ${subpartOptionsHtml ? `<div class="subpart-opts">${subpartOptionsHtml}</div>` : ""}
                  ${subpart.optionalChoice ? `<div class="or">OR</div><div class="subpart choice"><strong></strong><div>${richOrTextHtml(subpart.optionalChoice.richText, subpart.optionalChoice.text)}${imageAssetsToHtml(subpart.optionalChoice.imageAssets)}</div><span>[${subpart.optionalChoice.marks ?? subpart.marks ?? ""} marks]</span></div>${subpartChoiceOptionsHtml ? `<div class="subpart-opts">${subpartChoiceOptionsHtml}</div>` : ""}` : ""}
                `;
              },
            )
            .join("");
          const html = `
            <div class="question">
              <div class="q-main"><strong>${questionNumber++}.</strong><div>${richOrTextHtml(question.richText, question.text)}${imageAssetsToHtml(question.imageAssets)}</div><span>[${question.marks} marks]</span></div>
              ${optionsHtml}
              ${subpartsHtml}
              ${question.optionalChoice ? `<div class="or">OR</div><div class="q-main choice"><strong></strong><div>${richOrTextHtml(question.optionalChoice.richText, question.optionalChoice.text)}${imageAssetsToHtml(question.optionalChoice.imageAssets)}</div><span>[${question.optionalChoice.marks ?? question.marks} marks]</span></div>${choiceOptionsHtml}` : ""}
            </div>`;
          return html;
        })
        .join("");

      const attemptText =
        section.attemptRule && section.attemptRule.required < section.attemptRule.offered
          ? `<p class="instructions"><strong>Attempt any ${section.attemptRule.required} of ${section.attemptRule.offered} questions.</strong></p>`
          : "";

      return `<section><h2>${escapeHtml(section.title)}</h2><p class="instructions">${escapeHtml(section.instructions)}</p>${attemptText}${questions}</section>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(printablePaper.title)}</title><style>
    @page{size:A4;margin:${Math.max(10, Math.round(documentStyle.margin * 0.264583))}mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Georgia,serif;line-height:${documentStyle.lineHeight};margin:0;color:${documentStyle.textColor};background:${documentStyle.pageColor};font-size:11px}
    header{text-align:center;border-bottom:1px solid #cbd5e1;padding-bottom:10px;margin-bottom:12px}
    h1{font-family:Arial,sans-serif;font-size:18px;text-transform:uppercase;margin:6px 0}
    h2{font-family:Arial,sans-serif;font-size:12px;text-transform:uppercase;margin:14px 0 6px}
    .meta{display:flex;justify-content:center;gap:12px;font-family:Arial,sans-serif;font-size:10px;color:#475569}
    body::after{content:"Page";position:fixed;right:0;bottom:0;font-family:Arial,sans-serif;font-size:9px;color:#64748b}
    section{break-inside:auto}.question{margin:7px 0;break-inside:avoid-page}.q-main,.subpart{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:8px;align-items:start}
    .option{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;margin:3px 0 3px 32px;break-inside:avoid}
    .option div,.q-main div,.subpart div{min-width:0}
    .option p,.q-main p,.subpart p{margin:0 0 2px}
    .subpart{margin:4px 0 4px 24px}.subpart-opts{margin:0 0 4px 24px}
    .instructions{font-size:11px;color:#475569;margin:0 0 6px}.or{text-align:center;font-family:Arial,sans-serif;font-weight:bold;color:#1d4ed8;margin:5px 0}
    .watermark{position:fixed;inset:42% 0 auto;z-index:-1;text-align:center;font-family:Georgia,serif;font-size:54px;font-weight:700;color:${escapeHtml(documentStyle.accentColor)};opacity:${documentStyle.watermark?.opacity ?? 0};transform:${documentStyle.watermark?.position === "diagonal" ? "rotate(-28deg)" : "none"};pointer-events:none}
    .q-image-grid{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;justify-content:center}
    .option .q-image-grid{justify-content:flex-start}
    .q-image{max-width:180px;border:1px solid #cbd5e1;padding:3px;border-radius:4px}
    .q-image img{display:block;max-width:100%;max-height:120px;object-fit:contain}
    .q-image figcaption{font-family:Arial,sans-serif;font-size:8px;color:#64748b;margin-top:2px}
  </style>
  <!-- KaTeX CSS: styles pre-rendered math spans produced by katex.renderToString() -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
  <!-- KaTeX JS: must load before auto-render (defer preserves order) -->
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
  <!-- auto-render: catches any raw $...$ that escaped server-side rendering -->
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js"></script>
  <script>
    // Open print dialog only after:
    //  1. All deferred scripts (KaTeX + auto-render) have run
    //  2. CSS and its referenced web fonts are fully loaded (document.fonts.ready)
    // Without this, print fires before KaTeX CSS/fonts load → math appears as broken spans
    window.addEventListener('load', function () {
      if (window.renderMathInElement) {
        renderMathInElement(document.body, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$',  right: '$',  display: false }
          ],
          throwOnError: false
        });
      }
      var doPrint = function () { window.focus(); window.print(); };
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(doPrint);
      } else {
        doPrint();
      }
    });
  </script>
</head><body>${documentStyle.watermark?.text ? `<div class="watermark">${escapeHtml(documentStyle.watermark.text)}</div>` : ""}<header><div>Series: QPG/${escapeHtml(printablePaper.metadata.board || "CBSE")} · Q.P. Code: ${escapeHtml(printablePaper.metadata.qpCode || "30/S/1")}</div><h1>${escapeHtml(printablePaper.title)}</h1><div class="meta"><span>${escapeHtml(printablePaper.metadata.board)} Class ${escapeHtml(printablePaper.metadata.classLevel)}</span><span>${escapeHtml(printablePaper.metadata.subject)}</span><span>Time: ${formatDuration(printablePaper.metadata.durationMinutes)}</span><span>Max Marks: ${printablePaper.summary.totalMarks}</span></div></header>${sectionHtml}</body></html>`;
}

async function paperToDocxBlob(paper: Paper, documentStyle: DocumentStyle) {
  const docx = await import("docx");
  const children: InstanceType<typeof docx.Paragraph>[] = [];
  const printablePaper = normalizePaperStructure(paper);
  let questionNumber = 1;

  if (documentStyle.watermark?.text) {
    children.push(
      new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        children: [
          new docx.TextRun({
            text: documentStyle.watermark.text,
            color: documentStyle.accentColor.replace("#", ""),
            size: 42,
            italics: true,
          }),
        ],
      }),
    );
  }

  children.push(
    new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      children: [new docx.TextRun({ text: printablePaper.title, bold: true, size: 28 })],
    }),
    new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      children: [
        new docx.TextRun({
          text: `${printablePaper.metadata.board} Class ${printablePaper.metadata.classLevel} · ${printablePaper.metadata.subject} · Time: ${formatDuration(printablePaper.metadata.durationMinutes)} · Max Marks: ${printablePaper.summary.totalMarks}`,
          size: 20,
        }),
      ],
    }),
  );

  printablePaper.sections.forEach((section) => {
    children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [new docx.TextRun({ text: section.title, bold: true })] }));
    if (section.instructions) children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: section.instructions, size: 20 })] }));
    if (section.attemptRule && section.attemptRule.required < section.attemptRule.offered) {
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Attempt any ${section.attemptRule.required} of ${section.attemptRule.offered} questions.`, bold: true, size: 20 })] }));
    }

    section.questions.forEach((question) => {
      pushQuestionDocx(children, docx, questionNumber, question);
      questionNumber += 1;
    });
  });

  const doc = new docx.Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: Math.max(360, documentStyle.margin * 12),
              bottom: Math.max(360, documentStyle.margin * 12),
              left: Math.max(360, documentStyle.margin * 12),
              right: Math.max(360, documentStyle.margin * 12),
            },
          },
        },
        children,
      },
    ],
  });

  return docx.Packer.toBlob(doc);
}

function pushQuestionDocx(children: unknown[], docx: typeof import("docx"), questionNumber: number, question: PaperQuestion) {
  children.push(
    new docx.Paragraph({
      spacing: { before: 120 },
      children: [
        new docx.TextRun({ text: `${questionNumber}. `, bold: true, size: 22 }),
        new docx.TextRun({ text: plainTextFromRich(question.richText || question.text), size: 22 }),
        new docx.TextRun({ text: ` [${question.marks} marks]`, bold: true, size: 18 }),
      ],
    }),
  );
  pushImageReferences(children, docx, question.imageAssets, docx.AlignmentType.CENTER);
  (question.options ?? []).forEach((option) => pushOptionDocx(children, docx, option));
  (question.subparts ?? []).forEach((subpart) => {
    children.push(new docx.Paragraph({ indent: { left: 360 }, children: [new docx.TextRun({ text: `(${subpart.label}) ${plainTextFromRich(subpart.richText || subpart.text)} [${subpart.marks ?? ""} marks]`, size: 21 })] }));
    pushImageReferences(children, docx, subpart.imageAssets, docx.AlignmentType.CENTER);
    (subpart.options ?? []).forEach((option) => pushOptionDocx(children, docx, option, 540));
    if (subpart.optionalChoice) {
      children.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: "OR", bold: true, size: 18 })] }));
      children.push(new docx.Paragraph({ indent: { left: 360 }, children: [new docx.TextRun({ text: plainTextFromRich(subpart.optionalChoice.richText || subpart.optionalChoice.text), size: 21 })] }));
      pushImageReferences(children, docx, subpart.optionalChoice.imageAssets, docx.AlignmentType.CENTER);
      (subpart.optionalChoice.options ?? []).forEach((option) => pushOptionDocx(children, docx, option, 540));
    }
  });
  if (question.optionalChoice) {
    children.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: "OR", bold: true, size: 18 })] }));
    children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: plainTextFromRich(question.optionalChoice.richText || question.optionalChoice.text), size: 22 })] }));
    pushImageReferences(children, docx, question.optionalChoice.imageAssets, docx.AlignmentType.CENTER);
    (question.optionalChoice.options ?? []).forEach((option) => pushOptionDocx(children, docx, option));
  }
}

function pushOptionDocx(children: unknown[], docx: typeof import("docx"), option: PaperQuestionOption, indent = 360) {
  children.push(
    new docx.Paragraph({
      indent: { left: indent },
      children: [new docx.TextRun({ text: `${option.label ?? ""}. ${plainTextFromRich(option.richText || option.text)}`, size: 20 })],
    }),
  );
  pushImageReferences(children, docx, option.imageAssets, docx.AlignmentType.LEFT, indent + 180);
}

function pushImageReferences(children: unknown[], docx: typeof import("docx"), assets: PaperImageAsset[] | undefined, alignment: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType], indent = 0) {
  (assets ?? []).forEach((asset) => {
    children.push(
      new docx.Paragraph({
        alignment,
        indent: { left: indent },
        children: [new docx.TextRun({ text: `[Image: ${asset.caption || asset.filename || asset.name || asset.url}]`, italics: true, size: 18 })],
      }),
    );
  });
}

function plainTextFromRich(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function optionListToHtml(options?: PaperQuestionOption[]) {
  return (options ?? []).map((option, index) => optionToHtml(formatPrintOptionLabel(option.label, index), richOrTextHtml(option.richText, option.text), option.imageAssets)).join("");
}

function optionToHtml(label: string, contentHtml: string, imageAssets?: PaperImageAsset[]) {
  return `<div class="option"><strong>${escapeHtml(label)}</strong><div>${contentHtml}${imageAssetsToHtml(imageAssets, "option")}</div></div>`;
}

function formatPrintOptionLabel(label: string | undefined, index: number) {
  const normalized = (label || String.fromCharCode(65 + index)).trim();
  if (/^\(?[a-z]\)?\.?$/i.test(normalized)) return `(${normalized.replace(/[().]/g, "").toUpperCase()})`;
  if (/^\(?[ivx]+\)?\.?$/i.test(normalized)) return normalized.startsWith("(") ? normalized : `(${normalized})`;
  return normalized;
}

function imageAssetsToHtml(assets?: PaperImageAsset[], mode: "question" | "option" = "question") {
  if (!assets || assets.length === 0) return "";
  return `<div class="q-image-grid ${mode === "option" ? "option-image-grid" : ""}">${assets
    .map(
      (asset) => `<figure class="q-image"><img src="${escapeAttribute(asset.url)}" alt="${escapeAttribute(asset.altText || asset.caption || asset.filename || "Question image")}">${asset.caption || asset.filename || asset.name ? `<figcaption>${escapeHtml(asset.caption || asset.filename || asset.name || "")}</figcaption>` : ""}</figure>`,
    )
    .join("")}</div>`;
}

function textToHtml(text: string) {
  return printableTextToHtml(text);
}

function richOrTextHtml(richText: string | undefined, text: string | undefined) {
  const html = richText?.trim() ? renderPrintableRichHtml(richText) : "";
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped || /class="katex/.test(html) ? html : textToHtml(text ?? "");
}

function printableTextToHtml(text: string) {
  if (!text.trim()) return "";

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderPrintableInline(paragraph).replace(/\n/g, "<br>") || "<br>"}</p>`)
    .join("");
}

function renderPrintableRichHtml(html: string) {
  const placeholders: string[] = [];
  const stash = (value: string) => {
    const key = `%%QPG_PRINT_MATH_${placeholders.length}%%`;
    placeholders.push(value);
    return key;
  };

  const withMath = html.replace(/<span[^>]*data-latex=(["'])(.*?)\1[^>]*>(?:.*?)<\/span>/gi, (_match, _quote: string, latex: string) =>
    stash(renderPrintableLatex(unescapeHtml(latex))),
  );

  const rendered = withMath
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith("<")) return part;
      return renderPrintableInline(unescapeHtml(part));
    })
    .join("")
    .replace(/<p><\/p>/g, "")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/g, "");

  return placeholders.reduce((current, value, index) => current.replaceAll(`%%QPG_PRINT_MATH_${index}%%`, value), rendered);
}

function renderPrintableInline(value: string) {
  const placeholders: string[] = [];
  const stash = (html: string) => {
    const key = `%%QPG_INLINE_MATH_${placeholders.length}%%`;
    placeholders.push(html);
    return key;
  };

  let rendered = escapeHtml(value)
    .replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/g, (_match, blockLatex: string, inlineLatex: string) => stash(renderPrintableLatex(blockLatex ?? inlineLatex ?? "")))
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (match) => stash(renderPrintableLatex(unescapeHtml(match))))
    .replace(/\\sqrt\{([^{}]+)\}/g, (match) => stash(renderPrintableLatex(unescapeHtml(match))))
    .replace(/([A-Za-z])([23])(?=\b|[^A-Za-z0-9])/g, "$1<sup>$2</sup>")
    .replace(/\(([A-Za-z0-9\s+\-−–*/=.,]+)\)([23])(?=\b|[^A-Za-z0-9])/g, "($1)<sup>$2</sup>")
    .replace(/\b([A-Z][a-z]?)(\d+)(?=[A-Z]|$)/g, "$1<sub>$2</sub>");

  placeholders.forEach((html, index) => {
    rendered = rendered.replaceAll(`%%QPG_INLINE_MATH_${index}%%`, html);
  });

  return rendered;
}

function renderPrintableLatex(latex: string) {
  const normalized = normalizePrintableLatex(latex);
  if (!normalized) return "";

  try {
    return katex.renderToString(normalized, { throwOnError: false, strict: false, displayMode: false });
  } catch {
    return `<span class="math-preview">${escapeHtml(normalized)}</span>`;
  }
}

function normalizePrintableLatex(latex: string) {
  return normalizeLatexChars(latex.replace(/^\${1,2}/, "").replace(/\${1,2}$/, ""));
}

function normalizeTemplateParams(raw: Record<string, unknown>): Partial<PaperRequest> {
  const params: Partial<PaperRequest> = {};
  const board = raw.board;
  const classLevel = raw.classLevel ?? raw.class_level;
  const subject = raw.subject;
  const totalMarks = raw.totalMarks ?? raw.total_marks;
  const durationMinutes = raw.durationMinutes ?? raw.duration_minutes;

  if (board === "CBSE" || board === "ICSE") params.board = board;
  if (["6", "7", "8", "9", "10", "11", "12"].includes(String(classLevel))) params.classLevel = String(classLevel) as PaperRequest["classLevel"];
  if (["Maths", "Science", "Physics", "Chemistry", "Biology"].includes(String(subject))) params.subject = String(subject) as PaperRequest["subject"];
  if (totalMarks !== undefined) params.totalMarks = Number(totalMarks);
  if (durationMinutes !== undefined) params.durationMinutes = Number(durationMinutes);

  return params;
}

function dashboardFormattingToDocumentStyle(raw: Record<string, unknown>): Partial<DocumentStyle> {
  return {
    margin: numberOrUndefined(raw.margin),
    lineHeight: numberOrUndefined(raw.lineHeight ?? raw.line_height),
    fontSize: numberOrUndefined(raw.fontSize ?? raw.font_size),
    textColor: stringOrUndefined(raw.textColor ?? raw.text_color),
    accentColor: stringOrUndefined(raw.accentColor ?? raw.accent_color),
    pageColor: stringOrUndefined(raw.pageColor ?? raw.page_color),
  };
}

function normalizeAttemptRule(value: unknown) {
  const record = asRecord(value);
  const required = Number(record.required ?? 0);
  const offered = Number(record.offered ?? 0);
  if (!Number.isFinite(required) || !Number.isFinite(offered) || required <= 0 || offered <= 0) return undefined;

  return {
    required: Math.max(1, Math.floor(required)),
    offered: Math.max(1, Math.floor(offered)),
  };
}

function dashboardTemplateToPaperTemplate(template: DashboardSummary["templates"][number]): PaperTemplate {
  const payload = asRecord(template.payload);

  return {
    name: template.name,
    description: template.description,
    instructions: stringOrUndefined(payload.instructions),
    sections: Array.isArray(payload.sections) ? payload.sections.map(String) : undefined,
    layoutNotes: stringOrUndefined(payload.layout_notes ?? payload.layoutNotes),
    formatting: dashboardFormattingToDocumentStyle(template.formatting),
    inferredParams: normalizeTemplateParams(template.inferredParams),
  };
}

function normalizeVersionPayload(payload: Record<string, unknown>, paperId?: string): Paper {
  const metadata = asRecord(payload.metadata);
  const summary = asRecord(payload.summary);

  return recalculatePaper(normalizePaperStructure({
    id: String(payload.id ?? crypto.randomUUID()),
    paperId,
    title: String(payload.title ?? "Restored Question Paper"),
    metadata: {
      board: String(metadata.board ?? ""),
      classLevel: String(metadata.class_level ?? metadata.classLevel ?? ""),
      subject: String(metadata.subject ?? ""),
      chapter: String(metadata.chapter ?? ""),
      topic: String(metadata.topic ?? ""),
      durationMinutes: Number(metadata.duration_minutes ?? metadata.durationMinutes ?? 180),
      source: String(metadata.source ?? ""),
      format: metadata.format ? String(metadata.format) : undefined,
      qpCode: metadata.qp_code || metadata.qpCode ? String(metadata.qp_code ?? metadata.qpCode) : undefined,
    },
    summary: {
      totalMarks: Number(summary.total_marks ?? summary.totalMarks ?? 0),
      questionCount: Number(summary.question_count ?? summary.questionCount ?? 0),
      difficulty: String(summary.difficulty ?? ""),
      sourceCoverage: String(summary.source_coverage ?? summary.sourceCoverage ?? ""),
    },
    sections: Array.isArray(payload.sections)
      ? payload.sections.map((section) => {
          const sectionRecord = asRecord(section);
          return {
            id: String(sectionRecord.id ?? crypto.randomUUID()),
            title: String(sectionRecord.title ?? ""),
            instructions: String(sectionRecord.instructions ?? ""),
            difficulty: stringOrUndefined(sectionRecord.difficulty),
            targetMarks: numberOrUndefined(sectionRecord.targetMarks ?? sectionRecord.target_marks),
            attemptRule: normalizeAttemptRule(sectionRecord.attemptRule ?? sectionRecord.attempt_rule),
            questions: Array.isArray(sectionRecord.questions) ? sectionRecord.questions.map((question) => normalizeRawQuestion(asRecord(question))) : [],
          };
        })
      : [],
    documentStyle: asRecord(payload.documentStyle ?? payload.document_style),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
  }));
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"} ${remainder} minutes` : `${minutes} minutes`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function sameSubjectValue(left: string | undefined, right: string | undefined) {
  const normalize = (value: string | undefined) => {
    const lowered = (value || "").trim().toLowerCase();
    return lowered === "math" || lowered === "maths" || lowered === "mathematics" ? "maths" : lowered;
  };

  return normalize(left) === normalize(right);
}

function subjectIcon(subject: string) {
  const value = subject.toLowerCase();
  if (value.includes("math")) return "M";
  if (value.includes("physics")) return "P";
  if (value.includes("chemistry")) return "C";
  if (value.includes("biology")) return "B";
  if (value.includes("science")) return "S";
  return subject.slice(0, 2).toUpperCase();
}

function formatShortDate(value?: string) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function numberOrUndefined(value: unknown) {
  return value === undefined || value === null || value === "" ? undefined : Number(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
