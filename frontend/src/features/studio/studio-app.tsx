"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
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
import { insertIntoActiveRichTextEditor, MathToolkitInsert } from "@/features/editor/rich-text-editor";
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
} from "@/lib/api";
import { defaultRequest, requestFromPrompt } from "@/lib/request-defaults";
import { normalizePaperStructure, normalizeRawQuestion, richTextFromText } from "@/lib/normalize-paper-structure";
import {
  AiUsageSummary,
  CatalogSubject,
  DashboardSummary,
  DirectSourceMix,
  DocumentStyle,
  GenerationStatus,
  Paper,
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
  SourceAvailability,
} from "@/lib/types";

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
  margin: 56,
  lineHeight: 1.55,
  fontSize: 16,
  textColor: "#111827",
  accentColor: "#895100",
  pageColor: "#ffffff",
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
  const [hasFocusedTextEditor, setHasFocusedTextEditor] = useState(false);
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
    variantCount: 3,
    questionTypes: ["MCQ", "Short Answer", "Long Answer"],
    sectionBlueprint: [],
    difficultyMix: difficultyPresets.Medium,
    directSourceMix: sourceMixPresets["NCERT + PYQ"],
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
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
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
        sourceBooks: nextSourceBooks,
        sourceCategories: nextSourceCategories,
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

    const nextRequest = mode === "prompt" ? requestFromPrompt(prompt) : request;
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
    if (!instruction || isChatting) return;

    setChatInput("");
    addUserMessage(instruction);

    if (!selectedPaper) {
      addAssistantMessage("Generate a paper first, then I can edit it.");
      return;
    }

    if (isImageImportCommand(instruction)) {
      const section = findSectionForChatCommand(selectedPaper, instruction);
      if (!section) {
        addAssistantMessage("I could not find a section for the image import.");
        return;
      }

      await importQuestionImage(section.id);
      addAssistantMessage(`Choose an image to import into ${section.title}.`);
      return;
    }

    const command = applyChatPaperCommand(selectedPaper, instruction, documentStyle);
    if (command.handled) {
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
      addAssistantMessage(command.message);
      return;
    }

    const refinementInstruction = command.providerInstruction ?? buildTargetedRefinementInstruction(selectedPaper, instruction);

    setIsChatting(true);
    setStatus({ status: "running", step: "refining", message: "Applying refinement", progress: 65 });

    try {
      const refinement = await refineViaApi(selectedPaper, refinementInstruction);
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

    const saved = await saveVersionViaApi(applyDocumentStyle(selectedPaper, documentStyle), "manual_structured_edit");

    if (!saved) {
      addAssistantMessage("Could not save this version. Check that Phoenix is running.");
      return;
    }

    await refreshVersions(selectedPaper.paperId);
    addAssistantMessage(`Saved structured version ${saved.version_number ?? ""}.`);
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

  function appendQuestion(question: PaperQuestion, sectionId?: string) {
    if (!selectedPaper) return;
    updateSelectedPaper(appendQuestionToPaper(selectedPaper, question, sectionId));
  }

  function exportCurrent(format: "pdf" | "docx") {
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
      win.print();
      return;
    }

    const blob = new Blob([html], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedPaper.title.replaceAll(" ", "-").toLowerCase()}.docx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function addUserMessage(text: string) {
    setChatMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "user", text }]);
  }

  function addAssistantMessage(text: string) {
    setChatMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "assistant", text }]);
  }

  const hasPaperWorkspace = selectedPaper || openPapers.length > 0 || variantPapers.length > 0 || isGenerating;
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
    setCreateFlow(null);
    void runGeneration();
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
        <PaperLabTopBar
          aiOpen={isAssistantOpen}
          appView={appView}
          currentTitle={selectedPaper?.title ?? "Untitled paper"}
          hasFocusedTextEditor={hasFocusedTextEditor}
          onToolkitInsert={(insert) => insertIntoActiveRichTextEditor(insert)}
          onExport={exportCurrent}
        onHome={() => {
          setAppView("studio");
          setSelectedPaper(null);
          setVariantPapers([]);
          setOpenPapers([]);
        }}
        onOpenSetup={openGuidedSetup}
        onOpenView={setAppView}
        onRefresh={() => void refreshDashboard()}
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
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-deep)] px-6 py-8">
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
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <PaperNavigator
            isGenerating={isGenerating}
            mode={mode}
            openPapers={openPapers}
            requestPreview={requestPreview}
            selectedPaper={selectedPaper}
            variantPapers={variantPapers}
            onAddBlank={openNewPaperChooser}
            onGenerate={() => void runGeneration()}
            onSelectOpenPaper={(paper) => void switchOpenPaper(paper)}
            onSelectVariant={(paper) => void selectVariant(paper)}
            onStop={stopGeneration}
          />

          <section className="min-w-0 flex-1 overflow-y-auto bg-[var(--bg-deep)] px-4 py-8">
            {lastError && (
              <div className="fade-up mx-auto mb-4 max-w-[980px] rounded-[var(--radius-md)] border border-[var(--error)] bg-[var(--error-container)] px-4 py-3 text-sm font-semibold text-[var(--on-error-container)] shadow-[var(--shadow-sm)]">
                <div className="font-black">Last error</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-xs font-medium">{lastError}</div>
              </div>
            )}

            <GenerationCanvasState isGenerating={isGenerating} status={status} />

            <PaperEditor
              documentStyle={documentStyle}
              isGenerating={isGenerating}
              paper={selectedPaper}
              onImportImage={(sectionId) => void importQuestionImage(sectionId)}
              onPaperChange={updateSelectedPaper}
              onTextEditorFocus={() => setHasFocusedTextEditor(true)}
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
          onToggleQuestionType={toggleQuestionType}
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
        />
      )}
    </main>
  );
}

function PaperLabTopBar({
  aiOpen,
  appView,
  currentTitle,
  hasFocusedTextEditor,
  onExport,
  onHome,
  onOpenSetup,
  onOpenView,
  onRefresh,
  onRestoreVersion,
  onSave,
  onTitleChange,
  onToggleAI,
  onToolkitInsert,
  status,
  versions,
}: {
  aiOpen: boolean;
  appView: AppView;
  currentTitle: string;
  hasFocusedTextEditor: boolean;
  onExport: (format: "pdf" | "docx") => void;
  onHome: () => void;
  onOpenSetup: () => void;
  onOpenView: (view: AppView) => void;
  onRefresh: () => void;
  onRestoreVersion: (version: PaperVersion) => void;
  onSave: () => void;
  onTitleChange: (title: string) => void;
  onToggleAI: () => void;
  onToolkitInsert: (insert: MathToolkitInsert) => boolean;
  status: GenerationStatus;
  versions: PaperVersion[];
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 items-center gap-3">
        <button className="group flex items-center gap-2" onClick={onHome} type="button">
          <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--ink)] text-[var(--paper-tint)] shadow-[var(--shadow-sm)]">
            <FileText size={16} />
          </span>
          <span className="hidden leading-none sm:block">
            <span className="block font-display text-xl italic tracking-tight text-[var(--ink)]">Paper Lab</span>
            <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--ink-3)]">Question Studio</span>
          </span>
        </button>

        {appView === "studio" && (
          <>
            <div className="mx-1 h-6 w-px bg-[var(--border)]" />
            {isEditingTitle ? (
              <input
                autoFocus
                className="w-56 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-1 font-display text-lg italic text-[var(--ink)] outline-none"
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
                className="max-w-[36vw] truncate rounded-md px-2 py-1 text-left font-display text-lg italic tracking-tight text-[var(--ink)] hover:bg-[var(--surface-2)]"
                onClick={() => {
                  setDraftTitle(currentTitle);
                  setIsEditingTitle(true);
                }}
                type="button"
              >
                {currentTitle}
              </button>
            )}

            <div className="relative">
              <button
                className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[11px] font-bold text-[var(--ink-2)]"
                onClick={() => setIsVersionOpen((current) => !current)}
                type="button"
              >
                <span className="text-[var(--accent)]">●</span>
                v{versions[0]?.versionNumber ?? 1}
              </button>
              {isVersionOpen && (
                <div className="scale-in absolute left-0 top-[calc(100%+6px)] w-64 rounded-[var(--radius-md)] border border-[var(--border-2)] bg-[var(--paper)] p-2 shadow-[var(--shadow-lg)]">
                  <div className="px-2 py-1 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-3)]">Versions</div>
                  {versions.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-[var(--ink-3)]">No versions saved yet.</div>
                  ) : (
                    versions.map((version) => (
                      <button
                        key={version.id}
                        className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs text-[var(--ink-2)] hover:bg-[var(--surface)]"
                        onClick={() => {
                          setIsVersionOpen(false);
                          onRestoreVersion(version);
                        }}
                        type="button"
                      >
                        <span>
                          <span className="font-mono font-black text-[var(--accent)]">v{version.versionNumber}</span>
                          <span className="ml-2">{version.changeSource.replaceAll("_", " ")}</span>
                        </span>
                        {version.marksTotal !== undefined && <span>{version.marksTotal}m</span>}
                      </button>
                    ))
                  )}
                  <button className="mt-1 w-full rounded-md border border-[var(--border)] px-2 py-2 text-left text-xs font-bold text-[var(--accent-deep)] hover:bg-[var(--accent-soft)]" onClick={onSave} type="button">
                    Save current as new version
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <nav className="hidden items-center gap-1 xl:flex" aria-label="Workspace views">
        {appView !== "studio" &&
          ([
            ["studio", "Studio"],
            ["library", "Library"],
            ["analytics", "Coverage"],
            ["templates", "Templates"],
          ] as const).map(([view, label]) => (
            <button key={view} className={topNavClass(appView === view)} onClick={() => onOpenView(view)} type="button">
              {label}
            </button>
          ))}
      </nav>

      {appView === "studio" && hasFocusedTextEditor && (
        <MathToolkit onInsert={onToolkitInsert} />
      )}

      <div className="flex items-center gap-2">
        {appView === "studio" && (
          <>
            <ProgressBadge status={status} />
            <span className="hidden items-center gap-1 text-xs font-semibold text-[var(--ink-2)] md:inline-flex">
              <Check size={14} className="text-emerald-700" />
              Saved
            </span>
            <button className="icon-button" onClick={onSave} title="Save version" type="button">
              <Save size={16} />
            </button>
            <div className="relative">
              <button className="icon-button" onClick={() => setIsExportOpen((current) => !current)} title="Export" type="button">
                <Download size={16} />
              </button>
              {isExportOpen && (
                <div className="scale-in absolute right-0 top-[calc(100%+6px)] w-44 rounded-[var(--radius-md)] border border-[var(--border-2)] bg-[var(--paper)] p-2 shadow-[var(--shadow-lg)]">
                  {(["pdf", "docx"] as const).map((format) => (
                    <button
                      key={format}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-bold uppercase text-[var(--ink-2)] hover:bg-[var(--surface)]"
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
            <button className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-bold ${aiOpen ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]" : "border-[var(--border)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`} onClick={onToggleAI} type="button">
              Assistant
            </button>
            <button className="icon-button" onClick={onOpenSetup} title="Open guided setup" type="button">
              <SlidersHorizontal size={16} />
            </button>
          </>
        )}
        {appView !== "studio" && (
          <button className="secondary-button !min-h-9 !w-auto px-4" onClick={onRefresh} type="button">
            <RefreshCcw size={15} />
            Refresh
          </button>
        )}
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-deep)] font-mono text-[11px] font-black text-[var(--paper-tint)]">TP</div>
      </div>
    </header>
  );
}

function MathToolkit({ onInsert }: { onInsert: (insert: MathToolkitInsert) => boolean }) {
  const tools: { label: string; insert: MathToolkitInsert }[] = [
    { label: "π", insert: { type: "text", value: "π" } },
    { label: "θ", insert: { type: "text", value: "θ" } },
    { label: "α", insert: { type: "text", value: "α" } },
    { label: "β", insert: { type: "text", value: "β" } },
    { label: "γ", insert: { type: "text", value: "γ" } },
    { label: "Δ", insert: { type: "text", value: "Δ" } },
    { label: "∞", insert: { type: "text", value: "∞" } },
    { label: "√", insert: { type: "math", value: "\\sqrt{x}" } },
    { label: "∛", insert: { type: "math", value: "\\sqrt[3]{x}" } },
    { label: "x²", insert: { type: "html", value: "x<sup>2</sup>" } },
    { label: "x³", insert: { type: "html", value: "x<sup>3</sup>" } },
    { label: "xₙ", insert: { type: "html", value: "x<sub>n</sub>" } },
    { label: "a/b", insert: { type: "math", value: "\\frac{a}{b}" } },
    { label: "±", insert: { type: "text", value: "±" } },
    { label: "×", insert: { type: "text", value: "×" } },
    { label: "÷", insert: { type: "text", value: "÷" } },
    { label: "≈", insert: { type: "text", value: "≈" } },
    { label: "≠", insert: { type: "text", value: "≠" } },
    { label: "≤", insert: { type: "text", value: "≤" } },
    { label: "≥", insert: { type: "text", value: "≥" } },
    { label: "∴", insert: { type: "text", value: "∴" } },
    { label: "∵", insert: { type: "text", value: "∵" } },
    { label: "∠", insert: { type: "text", value: "∠" } },
    { label: "⊥", insert: { type: "text", value: "⊥" } },
    { label: "∥", insert: { type: "text", value: "∥" } },
    { label: "△", insert: { type: "text", value: "△" } },
    { label: "≅", insert: { type: "text", value: "≅" } },
    { label: "∼", insert: { type: "text", value: "∼" } },
    { label: "∫", insert: { type: "math", value: "\\int_a^b f(x)\\,dx" } },
    { label: "d/dx", insert: { type: "math", value: "\\frac{d}{dx}" } },
    { label: "lim", insert: { type: "math", value: "\\lim_{x\\to a}" } },
    { label: "∑", insert: { type: "math", value: "\\sum_{n=1}^{k}" } },
    { label: "sin", insert: { type: "text", value: "sin θ" } },
    { label: "cos", insert: { type: "text", value: "cos θ" } },
    { label: "tan", insert: { type: "text", value: "tan θ" } },
    { label: "log", insert: { type: "text", value: "log x" } },
    { label: "ln", insert: { type: "text", value: "ln x" } },
    { label: "∈", insert: { type: "text", value: "∈" } },
    { label: "∉", insert: { type: "text", value: "∉" } },
    { label: "⊂", insert: { type: "text", value: "⊂" } },
    { label: "⊆", insert: { type: "text", value: "⊆" } },
    { label: "∪", insert: { type: "text", value: "∪" } },
    { label: "∩", insert: { type: "text", value: "∩" } },
    { label: "∅", insert: { type: "text", value: "∅" } },
    { label: "⇒", insert: { type: "text", value: "⇒" } },
    { label: "⇔", insert: { type: "text", value: "⇔" } },
    { label: "∀", insert: { type: "text", value: "∀" } },
    { label: "∃", insert: { type: "text", value: "∃" } },
    { label: "P(A)", insert: { type: "text", value: "P(A)" } },
    { label: "nCr", insert: { type: "math", value: "{}^nC_r" } },
    { label: "nPr", insert: { type: "math", value: "{}^nP_r" } },
    { label: "v=u+at", insert: { type: "text", value: "v = u + at" } },
    { label: "F=ma", insert: { type: "text", value: "F = ma" } },
    { label: "V=IR", insert: { type: "text", value: "V = IR" } },
    { label: "E=mc²", insert: { type: "html", value: "E = mc<sup>2</sup>" } },
    { label: "H₂O", insert: { type: "html", value: "H<sub>2</sub>O" } },
    { label: "CO₂", insert: { type: "html", value: "CO<sub>2</sub>" } },
    { label: "O₂", insert: { type: "html", value: "O<sub>2</sub>" } },
    { label: "NaCl", insert: { type: "text", value: "NaCl" } },
    { label: "C₆H₁₂O₆", insert: { type: "html", value: "C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>" } },
    { label: "→", insert: { type: "text", value: "→" } },
    { label: "⇌", insert: { type: "text", value: "⇌" } },
    { label: "Quad", insert: { type: "html", value: "ax<sup>2</sup> + bx + c = 0" } },
    { label: "AP", insert: { type: "text", value: "aₙ = a + (n - 1)d" } },
    { label: "Area", insert: { type: "html", value: "πr<sup>2</sup>" } },
    { label: "Vol", insert: { type: "html", value: "\\frac{4}{3}πr<sup>3</sup>" } },
    { label: "A-D", insert: { type: "text", value: "\nA. \nB. \nC. \nD. " } },
    { label: "(i)-(iv)", insert: { type: "text", value: "\n(i) \n(ii) \n(iii) \n(iv) " } },
    { label: "(a)-(d)", insert: { type: "text", value: "\n(a) \n(b) \n(c) \n(d) " } },
  ];

  return (
    <div className="hidden max-w-[42vw] items-center gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--paper)] px-2 py-1 shadow-[var(--shadow-sm)] lg:flex">
      <span className="px-2 font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[var(--accent)]">Math</span>
      {tools.map((tool) => (
        <button
          key={tool.label}
          className="min-h-7 rounded-full px-2 text-xs font-black text-[var(--ink-2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-deep)]"
          onClick={() => onInsert(tool.insert)}
          type="button"
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(36,20,11,0.32)] px-4 backdrop-blur-sm">
      <div className="scale-in w-full max-w-4xl overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-2)] bg-[var(--surface)] shadow-[var(--shadow-xl)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-7 py-6">
          <div>
            <div className="font-mono text-[11px] font-black uppercase tracking-[0.22em] text-[var(--accent)]">New Paper</div>
            <h2 className="mt-1 font-display text-3xl italic leading-none text-[var(--ink)]">How do you want to begin?</h2>
            <p className="mt-2 text-sm text-[var(--ink-2)]">Create a blank draft, use guided parameters, or describe the paper in plain English.</p>
          </div>
          <button className="icon-button bg-[var(--paper)]" onClick={onClose} title="Close" type="button">
            <X size={17} />
          </button>
        </header>

        <div className="grid gap-4 px-7 py-7 md:grid-cols-3">
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

        <footer className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--paper-tint)] px-7 py-4 text-xs text-[var(--ink-3)]">
          <span className="font-mono uppercase tracking-[0.14em]">CBSE-first · structured editor · saved in open papers</span>
          <button className="secondary-button w-auto px-4" onClick={onClose} type="button">
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
      className="group min-h-48 rounded-[var(--radius-lg)] border border-[var(--border-2)] bg-[var(--paper)] p-5 text-left shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:shadow-[var(--shadow-md)]"
      onClick={onClick}
      type="button"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent-deep)] transition group-hover:bg-[var(--accent)] group-hover:text-[var(--paper-tint)]">
        {icon}
      </span>
      <span className="mt-5 block font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--accent)]">{label}</span>
      <span className="mt-1 block font-display text-2xl italic leading-tight text-[var(--ink)]">{title}</span>
      <span className="mt-3 block text-sm leading-6 text-[var(--ink-2)]">{desc}</span>
      <span className="mt-5 inline-flex items-center gap-2 text-xs font-black text-[var(--accent-deep)]">
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
  onToggleQuestionType,
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
  onToggleQuestionType: (questionType: string) => void;
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
    <div className="fixed inset-0 z-50 bg-[rgba(34,23,16,0.34)] p-0 backdrop-blur-sm">
      <div className="scale-in mx-auto flex h-full max-h-[min(720px,100vh)] w-full max-w-[1036px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-2)] bg-[var(--bg)] shadow-[var(--shadow-xl)]">
        <CreateFlowHeader
          eyebrow="New paper · Guided setup"
          onClose={onClose}
          step={step}
          subtitle={steps[step].subtitle}
          title={steps[step].title}
          totalSteps={4}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-16 py-8">
          {step === 0 && <StepBoardClass dashboard={dashboard} onUpdateRequest={onUpdateRequest} request={request} />}
          {step === 1 && <StepSubject availableChapters={availableChapters} availableSubjects={availableSubjects} dashboard={dashboard} onUpdateRequest={onUpdateRequest} request={request} />}
          {step === 2 && <StepChapters availableChapters={availableChapters} onUpdateRequest={onUpdateRequest} request={request} />}
          {step === 3 && <StepFineTune onToggleQuestionType={onToggleQuestionType} onUpdateRequest={onUpdateRequest} questionTypeOptions={questionTypeOptions} retrievalPreview={retrievalPreview} request={request} />}
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
    <header className="flex items-start justify-between border-b border-[var(--border)] bg-[var(--paper-tint)] px-8 py-5">
      <div>
        <div className="font-mono text-[11px] font-black uppercase tracking-[0.22em] text-[var(--accent)]">{eyebrow}</div>
        <h2 className="mt-1 font-display text-3xl italic leading-none text-[var(--ink)]">{title}</h2>
        <p className="mt-3 text-sm text-[var(--ink-2)]">{subtitle}</p>
      </div>
      <div className="flex items-center gap-4">
        {step !== undefined && totalSteps !== undefined && (
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }).map((_, index) => (
              <span key={index} className={`h-2 rounded-full ${index === step ? "w-5 bg-[var(--accent)]" : index < step ? "w-2 bg-[var(--accent)]" : "w-2 bg-[var(--border-2)]"}`} />
            ))}
            <span className="ml-1 font-mono text-xs text-[var(--ink-2)]">{step + 1} / {totalSteps}</span>
          </div>
        )}
        <button className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--paper)] text-[var(--ink)] shadow-[var(--shadow-sm)]" onClick={onClose} type="button">
          <X size={17} />
        </button>
      </div>
    </header>
  );
}

function CreateFlowFooter({ leftText, onBack, onNext, primaryLabel, showBack, sparkles }: { leftText: string; onBack: () => void; onNext: () => void; primaryLabel: string; showBack: boolean; sparkles?: boolean }) {
  return (
    <footer className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--paper-tint)] px-8 py-4">
      <div className="flex items-center gap-3 font-mono text-xs text-[var(--accent-deep)]">
        <Bookmark size={14} fill="currentColor" />
        <span>{leftText}</span>
      </div>
      <div className="flex items-center gap-5">
        <button className="text-sm font-semibold text-[var(--ink-2)] hover:text-[var(--ink)]" onClick={onBack} type="button">
          {showBack ? "Back" : "Cancel"}
        </button>
        <button className="flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--ink)] px-5 text-sm font-black text-[var(--paper-tint)] shadow-[var(--shadow-md)] hover:bg-[var(--accent-deep)]" onClick={onNext} type="button">
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
    <div className="mx-auto grid max-w-[840px] gap-9 md:grid-cols-2">
      <div>
        <FlowLabel>Board</FlowLabel>
        <div className="space-y-2.5">
          {boardOptions.map((board) => (
            <button
              key={board.value}
              className={`flex w-full items-center gap-4 rounded-[var(--radius-md)] border px-4 py-3 text-left transition ${request.board === board.value ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--paper)]"} ${board.disabled ? "cursor-not-allowed opacity-50" : "hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]"}`}
              disabled={board.disabled}
              onClick={() => selectBoard(board.value)}
              type="button"
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${request.board === board.value ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border-2)] bg-[var(--paper)]"}`}>
                {request.board === board.value && <span className="h-2 w-2 rounded-full bg-[var(--paper-tint)]" />}
              </span>
              <span>
                <span className="block text-base text-[var(--ink)]">{board.label}</span>
                <span className="block text-xs text-[var(--ink-3)]">{board.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <FlowLabel>Class</FlowLabel>
        <div className="grid grid-cols-2 gap-2.5">
          {classOptions.map((classLevel) => {
            const disabled = request.board === "ICSE" && classLevel !== "10";
            return (
              <button
                key={classLevel}
                className={`h-11 rounded-[var(--radius-md)] border text-sm transition ${request.classLevel === classLevel ? "border-[var(--accent)] bg-[var(--accent-soft)] font-black text-[var(--ink)]" : "border-[var(--border)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]"} ${disabled ? "cursor-not-allowed opacity-45 hover:border-[var(--border)] hover:bg-[var(--paper)]" : ""}`}
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
    <div className="mx-auto max-w-[800px]">
      <FlowLabel>Subject</FlowLabel>
      <div className="grid gap-3 md:grid-cols-3">
        {subjects.map((subject) => {
          const selected = sameSubjectValue(request.subject, subject.value);
          const countLabel = selected && currentSubjectCount > 0 ? indexedDetail : `${subject.chapterCount} chapters · ${subject.bookCount} books`;

          return (
          <button
            key={subject.value}
            className={`min-h-32 rounded-[var(--radius-md)] border p-5 text-left transition ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--paper)]"} ${subject.disabled ? "cursor-not-allowed opacity-45" : "hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]"}`}
            disabled={subject.disabled}
            onClick={() => selectSubject(subject)}
            type="button"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-lg font-black text-[var(--accent-deep)]">{subjectIcon(subject.value)}</span>
            <span className="mt-4 block font-display text-xl text-[var(--ink)]">{subject.label}</span>
            <span className="mt-1 block text-xs text-[var(--ink-3)]">{countLabel}</span>
            {selected && dashboard?.counts.textbooks ? <span className="mt-1 block text-[11px] text-[var(--ink-3)]">{formatCount(dashboard.counts.textbooks)} total source books</span> : null}
          </button>
          );
        })}
      </div>
    </div>
  );
}

function StepChapters({ availableChapters, onUpdateRequest, request }: { availableChapters: string[]; onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void; request: PaperRequest }) {
  const chapters = availableChapters.length > 0 ? availableChapters : request.chapters;
  const toggleChapter = (chapter: string) => {
    const selected = request.chapters.includes(chapter);
    const next = request.chapterScope === "single" ? [chapter] : selected ? request.chapters.filter((item) => item !== chapter) : [...request.chapters, chapter];
    onUpdateRequest("chapterScope", next.length > 1 ? "multiple" : "single");
    onUpdateRequest("chapters", next);
    onUpdateRequest("chapter", next[0] ?? "");
    onUpdateRequest("topic", next.join(", "));
  };

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-4 flex items-center justify-between">
        <FlowLabel>Chapters to include</FlowLabel>
        <span className="text-sm text-[var(--ink-3)]">{request.chapters.length} selected</span>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        {chapters.map((chapter) => {
          const active = request.chapters.includes(chapter);
          return (
            <button
              key={chapter}
              className={`flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-left transition ${active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--paper)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]"}`}
              onClick={() => toggleChapter(chapter)}
              type="button"
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border ${active ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--paper-tint)]" : "border-[var(--border-2)] bg-[var(--paper)]"}`}>
                {active && <Check size={14} />}
              </span>
              <span>
                <span className="block text-base text-[var(--ink)]">{chapter}</span>
                <span className="block text-xs text-[var(--ink-3)]">Available in selected dump catalog</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepFineTune({
  onToggleQuestionType,
  onUpdateRequest,
  questionTypeOptions,
  retrievalPreview,
  request,
}: {
  onToggleQuestionType: (questionType: string) => void;
  onUpdateRequest: <K extends keyof PaperRequest>(key: K, value: PaperRequest[K]) => void;
  questionTypeOptions: string[];
  retrievalPreview: RetrievalPreview | null;
  request: PaperRequest;
}) {
  const updateDifficulty = (difficulty: PaperRequest["difficulty"]) => {
    onUpdateRequest("difficulty", difficulty);
    onUpdateRequest("difficultyMix", difficultyPresets[difficulty]);
  };
  const updateSource = (source: PaperRequest["source"]) => {
    onUpdateRequest("source", source);
    onUpdateRequest("directSourceMix", sourceMixPresets[source]);
  };
  const mix = request.difficultyMix ?? difficultyPresets[request.difficulty];
  const sourceMix = request.directSourceMix ?? sourceMixPresets[request.source];
  const availability = retrievalPreview?.availability;
  const hasNcert = !availability || availability.totals.ncert > 0;
  const hasPyq = !availability || availability.totals.pyq > 0;
  const hasQuestionBank = !availability || availability.totals.questionBank > 0;
  const sourceOptions = [
    { value: "NCERT" as const, label: "NCERT only", count: availability?.totals.ncert ?? 0, disabled: availability ? !hasNcert : false },
    { value: "PYQ" as const, label: "PYQ only", count: availability?.totals.pyq ?? 0, disabled: availability ? !hasPyq : false },
    { value: "NCERT + PYQ" as const, label: "NCERT + PYQ", count: (availability?.totals.ncert ?? 0) + (availability?.totals.pyq ?? 0), disabled: availability ? !hasNcert || !hasPyq : false },
  ];
  const bookOptions = uniqueSourceOptions(availability?.books ?? []);
  const categoryOptions = (availability?.categories ?? []).map((category) => category.category);

  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      <div className="grid gap-5 md:grid-cols-[1fr_1.05fr_1fr]">
        <NumberStepper label="Total marks" value={request.totalMarks} onChange={(value) => onUpdateRequest("totalMarks", value)} />
        <div>
          <FlowLabel>Difficulty</FlowLabel>
          <div className="grid h-11 grid-cols-4 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-1">
            {(["Easy", "Medium", "Hard", "Mixed"] as const).map((difficulty) => (
              <button key={difficulty} className={tabClass(request.difficulty === difficulty)} onClick={() => updateDifficulty(difficulty)} type="button">
                {difficulty}
              </button>
            ))}
          </div>
        </div>
        <NumberStepper label="Sets" value={request.variantCount} onChange={(value) => onUpdateRequest("variantCount", Math.max(1, Math.min(5, value)))} suffix="A / B / C..." />
      </div>

      <DifficultyMixSliders
        mix={mix}
        onChange={(nextMix) => {
          onUpdateRequest("difficulty", "Mixed");
          onUpdateRequest("difficultyMix", nextMix);
        }}
      />

      <div>
        <FlowLabel>Source</FlowLabel>
        <div className="flex flex-wrap gap-2">
          {sourceOptions.map(({ value, label, count, disabled }) => (
            <button
              key={value}
              className={`rounded-full border px-4 py-2 text-sm ${request.source === value ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]" : "border-[var(--border)] bg-[var(--paper)] text-[var(--ink-2)]"} ${disabled ? "cursor-not-allowed opacity-45" : "hover:bg-[var(--accent-soft-2)]"}`}
              disabled={disabled}
              onClick={() => updateSource(value)}
              type="button"
              title={disabled ? "No matching source rows in the dump for the selected chapter." : `${count} available source item(s)`}
            >
              {label}
              {availability ? <span className="ml-2 font-mono text-[10px] opacity-70">{count}</span> : null}
            </button>
          ))}
        </div>
        {availability ? (
          <div className="mt-2 text-xs text-[var(--ink-3)]">
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
        onChange={(nextMix) => onUpdateRequest("directSourceMix", nextMix)}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <ChipMultiSelect
          label="Books to pull from"
          emptyText="No source books match this chapter yet."
          options={bookOptions}
          selected={request.sourceBooks ?? []}
          onChange={(values) => onUpdateRequest("sourceBooks", values)}
        />
        <ChipMultiSelect
          label="Source categories"
          emptyText="No tagged categories match this chapter yet."
          options={categoryOptions}
          selected={request.sourceCategories ?? []}
          onChange={(values) => onUpdateRequest("sourceCategories", values)}
        />
      </div>

      <div>
        <FlowLabel>Question types</FlowLabel>
        <div className="grid gap-2.5 md:grid-cols-3 lg:grid-cols-4">
          {questionTypeOptions.map((questionType) => {
            const selected = request.questionTypes.includes(questionType);
            return (
              <button key={questionType} className={`flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border px-4 text-left ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--paper)] hover:bg-[var(--accent-soft-2)]"}`} onClick={() => onToggleQuestionType(questionType)} type="button">
                <span className={`flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--paper-tint)]" : "border-[var(--border-2)] bg-[var(--paper)]"}`}>
                  {selected && <Check size={14} />}
                </span>
                <span>
                  <span className="block text-sm text-[var(--ink)]">{questionType}</span>
                  <span className="block text-[11px] text-[var(--ink-3)]">{questionTypeDescription(questionType)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper)] p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-deep)]">
          <Sparkles size={19} />
        </span>
        <div>
          <div className="font-bold text-[var(--ink)]">
            You will generate a {request.totalMarks}-mark, {request.difficulty.toLowerCase()} paper across {request.chapterScope === "full_syllabus" ? "the full syllabus" : `${request.chapters.length} chapter${request.chapters.length === 1 ? "" : "s"}`}.
          </div>
          <div className="mt-1 text-xs text-[var(--ink-3)]">Drawing from {request.source}{request.sourceBooks?.length ? ` · ${request.sourceBooks.join(", ")}` : ""}. {request.questionTypes.length} question types selected. {request.variantCount} set{request.variantCount === 1 ? "" : "s"}.</div>
          <div className="mt-1 text-xs font-bold text-[var(--accent-deep)]">Difficulty mix: {mix.easy}% easy · {mix.medium}% medium · {mix.hard}% hard.</div>
          <div className="mt-1 text-xs font-bold text-[var(--accent-deep)]">Source mix target: {sourceMix.ncertDirect}% NCERT direct · {sourceMix.pyqDirect}% PYQ direct · {sourceMix.questionBank}% bank · {sourceMix.aiGenerated}% AI from dump.</div>
        </div>
      </div>
    </div>
  );
}

function ChipMultiSelect({
  emptyText,
  label,
  options,
  selected,
  onChange,
}: {
  emptyText?: string;
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div>
      <FlowLabel>{label}</FlowLabel>
      <div className="flex flex-wrap gap-2">
        {options.length === 0 ? <span className="rounded-full border border-dashed border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink-3)]">{emptyText ?? "No options available."}</span> : null}
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${isSelected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]" : "border-[var(--border)] bg-[var(--paper)] text-[var(--ink-2)] hover:bg-[var(--accent-soft-2)]"}`}
              onClick={() => onChange(isSelected ? selected.filter((item) => item !== option) : [...selected, option])}
              type="button"
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function uniqueSourceOptions(books: NonNullable<RetrievalPreview["availability"]>["books"]) {
  const preferredOrder = ["NCERT", "RD Sharma", "Selina", "OSWAL PYQ", "Most Likely Question Bank", "PYQ"];
  const options = Array.from(new Set(books.map((book) => book.sourceGroup || book.title).filter(Boolean)));

  return options.sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left);
    const rightIndex = preferredOrder.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    return left.localeCompare(right);
  });
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
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <FlowLabel>Difficulty percentage</FlowLabel>
        <span className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[var(--ink-3)]">Total 100%</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {(["easy", "medium", "hard"] as const).map((key) => (
          <label key={key} className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--ink-3)]">
            <span className="flex justify-between">
              <span>{key}</span>
              <span>{mix[key]}%</span>
            </span>
            <input
              className="mt-2 w-full accent-[var(--accent)]"
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
  mix,
  onChange,
}: {
  disabledSources: Partial<Record<keyof Pick<DirectSourceMix, "ncertDirect" | "pyqDirect" | "questionBank">, boolean>>;
  mix: DirectSourceMix;
  onChange: (mix: DirectSourceMix) => void;
}) {
  const keys = ["ncertDirect", "pyqDirect", "questionBank", "aiGenerated"] as const;
  const normalized = normalizeSourceMixForUi(mix, disabledSources);

  const update = (key: (typeof keys)[number], value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    const availableKeys = keys.filter((item) => item !== key && !disabledSources[item as keyof typeof disabledSources]);
    const remaining = 100 - clamped;
    const currentOtherTotal = availableKeys.reduce((total, item) => total + normalized[item], 0) || 1;
    const next = { ...normalized, [key]: clamped };

    availableKeys.forEach((item, index) => {
      if (index === availableKeys.length - 1) {
        next[item] = 100 - keys.reduce((total, sourceKey) => (sourceKey === item ? total : total + next[sourceKey]), 0);
      } else {
        next[item] = Math.round((normalized[item] / currentOtherTotal) * remaining);
      }
    });

    (["ncertDirect", "pyqDirect", "questionBank"] as const).forEach((item) => {
      if (disabledSources[item]) next[item] = 0;
    });

    onChange({ ...next, dumpDirect: next.ncertDirect + next.pyqDirect + next.questionBank, aiFromDump: next.aiGenerated });
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <FlowLabel>Source mix target</FlowLabel>
        <span className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[var(--ink-3)]">Direct pull vs AI</span>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {keys.map((key) => {
          const disabled = Boolean(disabledSources[key as keyof typeof disabledSources]);
          return (
            <label key={key} className={`text-xs font-bold uppercase tracking-[0.08em] ${disabled ? "text-[var(--ink-3)] opacity-50" : "text-[var(--ink-3)]"}`}>
              <span className="flex justify-between">
                <span>{sourceMixLabel(key)}</span>
                <span>{normalized[key]}%</span>
              </span>
              <input
                className="mt-2 w-full accent-[var(--accent)] disabled:opacity-50"
                disabled={disabled}
                max={100}
                min={0}
                type="range"
                value={normalized[key]}
                onChange={(event) => update(key, Number(event.target.value))}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-3 text-[11px] leading-5 text-[var(--ink-3)]">
        Direct questions are inserted untouched from the dump where compatible candidates exist. AI questions are still grounded in dump citations.
      </div>
    </div>
  );
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

function sourceMixLabel(key: keyof DirectSourceMix) {
  const labels: Partial<Record<keyof DirectSourceMix, string>> = {
    ncertDirect: "NCERT",
    pyqDirect: "PYQ",
    questionBank: "Bank",
    aiGenerated: "AI",
  };
  return labels[key] ?? key;
}

function FreePromptModal({ onClose, onGenerate, onPromptChange, prompt }: { onClose: () => void; onGenerate: () => void; onPromptChange: (value: string) => void; prompt: string }) {
  const extracted = requestFromPrompt(prompt);
  const rows = [
    ["Board", extracted.board],
    ["Class", extracted.classLevel ? `Class ${extracted.classLevel}` : ""],
    ["Subject", extracted.subject],
    ["Marks", extracted.totalMarks ? `${extracted.totalMarks}` : ""],
    ["Difficulty", extracted.difficulty],
    ["Chapters", extracted.chapters.join(", ")],
    ["Types", extracted.questionTypes.join(", ")],
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(34,23,16,0.34)] p-0 backdrop-blur-sm">
      <div className="scale-in mx-auto flex h-full max-h-[min(660px,100vh)] w-full max-w-[1024px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-2)] bg-[var(--bg)] shadow-[var(--shadow-xl)]">
        <CreateFlowHeader eyebrow="New paper · Free prompt" onClose={onClose} subtitle="Plain English. We will fill in the blanks and ask only if needed." title="Describe the paper" />
        <div className="grid min-h-0 flex-1 gap-7 overflow-y-auto px-16 py-7 md:grid-cols-[1.25fr_0.9fr]">
          <div>
            <FlowLabel>Your prompt</FlowLabel>
            <textarea
              className="min-h-48 w-full resize-y rounded-[var(--radius-md)] border border-[var(--border-2)] bg-[var(--paper)] p-5 font-display text-xl leading-8 text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)] focus:border-[var(--accent)]"
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="e.g. CBSE Class 10 Maths, 50 marks unit test on Quadratic Equations, mix of MCQ and long answer..."
              value={prompt}
            />
            <div className="mt-5">
              <FlowLabel>Try one of these</FlowLabel>
              {[
                "CBSE Class 10 Maths unit test on Quadratic Equations, 30 marks, only MCQs and short answers",
                "Class 12 Physics, mixed difficulty, 80 marks, full syllabus, 3 sets",
                "A practice sheet on Real Numbers for CBSE Class 10. Easy. NCERT-style.",
              ].map((sample) => (
                <button key={sample} className="mt-2 w-full rounded-[var(--radius-sm)] border border-dashed border-[var(--border-2)] bg-[var(--paper-tint)] px-4 py-3 text-left font-display text-base italic text-[var(--ink-2)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]" onClick={() => onPromptChange(sample)} type="button">
                  &quot;{sample}&quot;
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper-tint)] p-5">
            <FlowLabel>What I&apos;m picking up</FlowLabel>
            <div className="mt-4 space-y-2">
              {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[92px_1fr] rounded-[var(--radius-sm)] border border-dashed border-[var(--border-2)] px-3 py-2 text-sm">
                  <span className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-[var(--accent)]">{label}</span>
                  <span className={value ? "text-[var(--ink)]" : "italic text-[var(--ink-3)]"}>{value || "not specified"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <CreateFlowFooter leftText={prompt.trim() ? "Ready to generate from prompt" : "Start typing - suggestions appear live"} onBack={onClose} onNext={onGenerate} primaryLabel="Generate paper" showBack={false} sparkles />
      </div>
    </div>
  );
}

function FlowLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 font-mono text-[11px] font-black uppercase tracking-[0.18em] text-[var(--ink-3)]">{children}</div>;
}

function NumberStepper({ label, onChange, suffix, value }: { label: string; onChange: (value: number) => void; suffix?: string; value: number }) {
  return (
    <div>
      <FlowLabel>{label}</FlowLabel>
      <div className="grid h-11 grid-cols-[44px_1fr_44px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper)]">
        <button className="flex items-center justify-center text-[var(--ink-2)] hover:bg-[var(--surface-2)]" onClick={() => onChange(value - 1)} type="button">
          <Minus size={16} />
        </button>
        <div className="flex items-center justify-center gap-2 text-lg font-semibold text-[var(--ink)]">
          {value}
          {suffix && <span className="font-mono text-[10px] font-normal text-[var(--ink-3)]">{suffix}</span>}
        </div>
        <button className="flex items-center justify-center text-[var(--ink-2)] hover:bg-[var(--surface-2)]" onClick={() => onChange(value + 1)} type="button">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function questionTypeDescription(questionType: string) {
  const descriptions: Record<string, string> = {
    MCQ: "Multiple choice",
    "Fill in the Blanks": "Short fills",
    "True/False": "Binary",
    "Very Short Answer": "1-2 lines",
    "Short Answer": "3 marks each",
    "Long Answer": "5 marks each",
    "Case Study": "Source-based",
  };
  return descriptions[questionType] ?? "Question type";
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
    <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,var(--accent-soft-2),transparent_34%),var(--bg)] px-8 py-10">
      <div className="mx-auto max-w-7xl">
        <section className="fade-up grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="font-mono text-[11px] font-black uppercase tracking-[0.22em] text-[var(--accent)]">Question Studio</div>
            <h1 className="mt-3 max-w-3xl font-display text-6xl italic leading-[0.95] tracking-tight text-[var(--ink)]">
              Build the paper like an editor, generate it like an AI lab.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--ink-2)]">
              Start with parameters, a free prompt, or a blank canvas. Generated papers stay structured so every question, option, OR choice, source, and mark can be edited.
            </p>
          </div>
          <div className="rounded-[var(--radius-xl)] border border-[var(--border-2)] bg-[var(--paper)] p-5 shadow-[var(--shadow-lg)]">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--ink-3)]">Current default</div>
            <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--paper-tint)] p-5 font-serif shadow-inner">
              <div className="text-center font-display text-2xl italic text-[var(--ink)]">{request.subject} Assessment</div>
              <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-3)]">
                CBSE · Class {request.classLevel} · {request.totalMarks} marks
              </div>
              <div className="mt-5 space-y-3 text-sm text-[var(--ink-2)]">
                <div className="h-2 w-3/4 rounded-full bg-[var(--surface-2)]" />
                <div className="h-2 w-full rounded-full bg-[var(--surface-2)]" />
                <div className="h-2 w-2/3 rounded-full bg-[var(--surface-2)]" />
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="h-9 rounded border border-[var(--border)]" />
                  <div className="h-9 rounded border border-[var(--border)]" />
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <MiniStat label="Font" value={documentStyle.fontSize} />
              <MiniStat label="Spacing" value={documentStyle.lineHeight} />
              <MiniStat label="Sets" value={request.variantCount} />
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          <StartCard desc="Guided setup with board, class, subject, chapter, sources, question mix, and section blueprint." icon={LayoutDashboard} label="Parameters" onClick={onOpenStructured} title="Create from parameters" />
          <StartCard desc="Write a natural-language request and let the backend normalize it into the same PaperRequest shape." icon={Sparkles} label="Prompt" onClick={onOpenPrompt} title="Create from free prompt" />
          <StartCard desc="Open the structured editor immediately and add/import questions manually." icon={FileText} label="Blank" onClick={onCreateBlank} title="Start with blank paper" />
        </section>

        <section className="mt-10 grid gap-6 xl:grid-cols-[1fr_1.3fr]">
          <LandingPanel eyebrow="Recent" title="Saved papers">
            {(dashboard?.recentPapers ?? []).length === 0 ? (
              <EmptyWorkspaceState title="No saved papers yet" description="Saved versions will appear here once you generate or import a paper." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {(dashboard?.recentPapers ?? []).slice(0, 4).map((paper) => (
                  <button key={paper.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]" onClick={() => onOpenPaper(paper.id)} type="button">
                    <div className="font-display text-xl italic text-[var(--ink)]">{paper.title}</div>
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      {paper.board} · Class {paper.classLevel} · {paper.subject}
                    </div>
                    <div className="mt-4 flex gap-2 text-[11px] font-bold text-[var(--ink-2)]">
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
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {builtInTemplates.map((template) => (
                <button key={template.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)] hover:bg-[var(--accent-soft-2)]" onClick={() => onUseTemplate(template)} type="button">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-deep)]">
                    <FileText size={17} />
                  </div>
                  <div className="mt-3 font-display text-lg italic text-[var(--ink)]">{template.name}</div>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--ink-2)]">{template.description || "Reusable paper template with formatting and request hints."}</p>
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
    <button className="group rounded-[var(--radius-xl)] border border-[var(--border-2)] bg-[var(--paper)] p-5 text-left shadow-[var(--shadow-md)] transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[var(--shadow-lg)]" onClick={onClick} type="button">
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--ink)] text-[var(--paper-tint)]">
          <IconComponent size={20} />
        </span>
        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[var(--accent-deep)]">{label}</span>
      </div>
      <div className="mt-5 font-display text-2xl italic leading-tight text-[var(--ink)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">{desc}</p>
    </button>
  );
}

function LandingPanel({ children, eyebrow, title }: { children: React.ReactNode; eyebrow: string; title: string }) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--border-2)] bg-[var(--paper)] p-5 shadow-[var(--shadow-md)]">
      <div className="mb-4">
        <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--accent)]">{eyebrow}</div>
        <h2 className="mt-1 font-display text-2xl italic text-[var(--ink)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function PaperNavigator({
  isGenerating,
  mode,
  onAddBlank,
  onGenerate,
  onSelectOpenPaper,
  onSelectVariant,
  onStop,
  openPapers,
  requestPreview,
  selectedPaper,
  variantPapers,
}: {
  isGenerating: boolean;
  mode: Mode;
  onAddBlank: () => void;
  onGenerate: () => void;
  onSelectOpenPaper: (paper: Paper) => void;
  onSelectVariant: (paper: Paper) => void;
  onStop: () => void;
  openPapers: Paper[];
  requestPreview: PaperRequest;
  selectedPaper: Paper | null;
  variantPapers: Paper[];
}) {
  const sections = selectedPaper?.sections ?? [];
  const totalMarks = selectedPaper?.summary.totalMarks ?? requestPreview.totalMarks;

  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] lg:flex">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--ink-3)]">Open papers</div>
          <span className="font-mono text-[10px] font-black text-[var(--accent)]">{openPapers.length}</span>
        </div>
        {openPapers.length > 0 && (
          <div className="mt-3 space-y-1">
            {openPapers.map((paper, index) => (
              <button
                key={`${paper.id}-${paper.paperId ?? "draft"}`}
                className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-xs transition ${selectedPaper && (selectedPaper.id === paper.id || (selectedPaper.paperId && selectedPaper.paperId === paper.paperId)) ? "border-[var(--accent)] bg-[var(--paper)] font-black text-[var(--ink)] shadow-[var(--shadow-sm)]" : "border-transparent text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}
                onClick={() => onSelectOpenPaper(paper)}
                type="button"
              >
                <FileText className="shrink-0 text-[var(--accent)]" size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{paper.title || `Untitled paper ${index + 1}`}</span>
                  <span className="block truncate font-mono text-[10px] font-medium text-[var(--ink-3)]">
                    {paper.summary.totalMarks}m · {paper.summary.questionCount}q
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <button className="mt-3 flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-2)] px-3 py-2 text-left text-xs font-bold text-[var(--ink-2)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]" onClick={onAddBlank} type="button">
          <FileText size={15} />
          New paper
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {variantPapers.length > 0 && openPapers.length === 0 && (
          <div className="mb-4">
            <div className="px-2 pb-2 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-3)]">Generated sets</div>
            <div className="space-y-1">
              {variantPapers.map((paper, index) => (
                <button key={paper.id} className={`w-full rounded-[var(--radius-sm)] border px-3 py-2 text-left text-xs ${selectedPaper?.id === paper.id ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]" : "border-transparent text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`} onClick={() => onSelectVariant(paper)} type="button">
                  <span className="font-mono font-black">Set {String.fromCharCode(65 + index)}</span>
                  <span className="block truncate">{paper.summary.totalMarks} marks · {paper.summary.questionCount} questions</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper-tint)] p-3 text-xs text-[var(--ink-2)]">
          <div className="font-bold text-[var(--ink)]">Request</div>
          <div className="mt-1">{requestPreview.board} · Class {requestPreview.classLevel}</div>
          <div className="mt-1">{requestPreview.subject} · {requestPreview.totalMarks} marks</div>
          <div className="mt-1 line-clamp-2">{requestPreview.chapterScope === "full_syllabus" ? "Whole syllabus" : requestPreview.chapters.join(", ")}</div>
          <div className="mt-1 line-clamp-2">Types: {requestPreview.questionTypes.join(", ")}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-3)]">{mode === "prompt" ? "Free prompt" : "Parameters"}</div>
        </div>

        <div>
          <div className="px-2 pb-2 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-3)]">Jump to question</div>
          {sections.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--border)] p-3 text-xs text-[var(--ink-3)]">Questions appear here after generation or import.</div>
          ) : (
            <div className="space-y-2">
              {sections.map((section) => (
                <div key={section.id}>
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold text-[var(--ink-2)]">
                    <span>{section.title}</span>
                    <span>{section.questions.reduce((total, question) => total + Number(question.marks || 0), 0)}m</span>
                  </div>
                  {section.questions.map((question, index) => (
                    <button key={question.id} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--ink-2)] hover:bg-[var(--surface-2)]" onClick={() => document.getElementById(`question-${question.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} type="button">
                      <span className="font-mono font-black text-[var(--accent)]">Q{index + 1}</span>
                      <span className="truncate">{question.text || "Untitled question"}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--surface-2)] p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-3)]">Total marks</span>
          <span className="font-display text-2xl italic text-[var(--ink)]">{totalMarks}</span>
        </div>
        <button className="primary-button mt-3" disabled={isGenerating} onClick={onGenerate} type="button">
          {isGenerating ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}
          {isGenerating ? "Generating" : "Generate paper"}
        </button>
        {isGenerating && (
          <button className="secondary-button mt-2" onClick={onStop} type="button">
            <Square size={15} />
            Stop
          </button>
        )}
      </div>
    </aside>
  );
}

function GenerationCanvasState({ isGenerating, status }: { isGenerating: boolean; status: GenerationStatus }) {
  if (!isGenerating) return null;

  return (
    <div className="fade-up mx-auto mb-5 max-w-[980px] rounded-[var(--radius-lg)] border border-[var(--border-2)] bg-[var(--paper)] p-5 text-center shadow-[var(--shadow-md)]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
        <LoaderCircle className="animate-spin" size={22} />
      </div>
      <div className="mt-3 font-display text-2xl italic text-[var(--ink)]">Generating question paper</div>
      <div className="mt-1 text-sm text-[var(--ink-2)]">{status.message}</div>
      <div className="mx-auto mt-4 h-1.5 max-w-md overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${Math.max(8, Math.min(100, status.progress))}%` }} />
      </div>
    </div>
  );
}

function AssistantPanel({
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
  preview,
  questionBank,
  rightPanel,
  usage,
}: {
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
  preview: RetrievalPreview | null;
  questionBank: QuestionBankItem[];
  rightPanel: RightPanel;
  usage: AiUsageSummary | null;
}) {
  if (!isOpen) {
    return (
      <button
        className="fade-up fixed bottom-5 right-5 z-30 flex items-center gap-3 rounded-full bg-[var(--ink)] px-4 py-3 text-sm font-black text-[var(--paper-tint)] shadow-[var(--shadow-xl)] hover:-translate-y-0.5 hover:bg-[var(--accent-deep)]"
        onClick={onToggleOpen}
        type="button"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(244,213,168,0.18)] text-[var(--highlight)]">
          <Sparkles size={15} />
        </span>
        Ask assistant
        <span className="rounded bg-[rgba(255,255,255,0.12)] px-1.5 py-0.5 font-mono text-[10px]">⌘K</span>
      </button>
    );
  }

  return (
    <aside className="scale-in fixed bottom-5 right-5 z-30 flex h-[min(620px,calc(100vh-96px))] w-[390px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-2)] bg-[var(--paper)] shadow-[var(--shadow-xl)]">
      <div className="border-b border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-deep)] text-[var(--paper-tint)]">
              <Bot size={16} />
            </span>
            <div>
              <div className="text-sm font-bold text-[var(--ink)]">Assistant</div>
              <div className="text-[11px] text-[var(--ink-3)]">Refine, retrieve, restore</div>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title="Close assistant" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-1">
          {(["chat", "retrieval"] as RightPanel[]).map((panel) => (
            <button key={panel} className={tabClass(rightPanel === panel)} onClick={() => onSetPanel(panel)} type="button">
              {panel === "retrieval" ? "Sources" : panel}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {rightPanel === "chat" && (
          <div className="space-y-3">
            {usage && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--ink-2)]">
                <div className="font-bold text-[var(--ink)]">API usage</div>
                <div className="mt-1">{usage.totalTokens} tokens · ${usage.estimatedCostUsd.toFixed(6)}</div>
              </div>
            )}
            {chatMessages.map((message) => (
              <div key={message.id} className={message.role === "user" ? "ml-10 rounded-xl rounded-tr-sm bg-[var(--ink)] px-3 py-2 text-xs font-medium text-[var(--paper-tint)]" : "mr-8 rounded-xl rounded-tl-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-5 text-[var(--ink)]"}>
                {message.text}
              </div>
            ))}
            {isBusy && (
              <div className="mr-8 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-2)]">
                <LoaderCircle className="animate-spin" size={14} />
                Working on the paper...
              </div>
            )}
          </div>
        )}

        {rightPanel === "retrieval" && (
          <div className="space-y-4">
            <RetrievalPanel preview={preview} onImport={onImportSource} onRefresh={onRefreshRetrieval} />
            <div className="border-t border-[var(--border)] pt-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--accent)]">Question bank</div>
                <button className="text-[11px] font-bold text-[var(--ink-3)] hover:text-[var(--accent)]" onClick={onRefreshBank} type="button">
                  Refresh
                </button>
              </div>
              <QuestionBankPanel items={questionBank} onImport={onImportBank} onRefresh={onRefreshBank} compact />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="relative">
          <input
            className="input rounded-full pr-11"
            placeholder="Replace Q5, rebalance, format..."
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAsk();
            }}
          />
          <button className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--paper-tint)]" onClick={onAsk} type="button">
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
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-[var(--surface-container-low)] p-1">
        {(["all", "ncert", "pyq", "bank"] as const).map((tab) => (
          <button
            key={tab}
            className={`rounded-md px-2 py-1.5 text-[11px] font-black uppercase transition ${sourceTab === tab ? "bg-[var(--surface-container-lowest)] text-[var(--primary)] shadow-sm" : "text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"}`}
            onClick={() => setSourceTab(tab)}
            type="button"
          >
            {tab} {tabCounts[tab]}
          </button>
        ))}
      </div>
      {preview?.warnings.map((warning) => (
        <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          {warning}
        </div>
      ))}
      {sourceTab === "all" && hasSectionSources ? (
        <div className="space-y-4">
          {sectionChapters.map((chapter) => (
            <div key={chapter.name} className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-[var(--on-surface)]">{chapter.name}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-[var(--on-surface-variant)]">Dump-backed textbook questions, exercises, chunks, and matching PYQs</div>
                </div>
                {chapter.position !== undefined && <span className="rounded-full bg-[var(--surface-container-lowest)] px-2 py-1 text-[10px] font-black text-[var(--on-surface-variant)]">Ch {chapter.position}</span>}
              </div>

              <div className="mt-3 space-y-2">
                {chapter.sections
                  .filter((section) => section.ncert.length > 0 || section.pyq.length > 0)
                  .map((section) => (
                    <details key={`${chapter.name}-${section.name}`} className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)]" open={section.sectionType === "exercise"}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-bold text-[var(--on-surface)]">
                        <span>{section.name}</span>
                        <span className="rounded-full bg-[var(--surface-container-high)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--on-surface-variant)]">
                          {section.ncert.length + section.pyq.length}
                        </span>
                      </summary>
                      <div className="space-y-2 border-t border-[var(--outline-variant)] p-2">
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
        <div className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 text-xs text-[var(--on-surface-variant)]">No retrieval results yet. Add NCERT/PYQ data or generate a preview.</div>
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
    <button className="w-full rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-3 text-left text-xs hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]" onClick={() => onImport(result)} type="button">
      <span className="flex items-center justify-between gap-2">
        <span className="font-bold text-[var(--on-surface)]">{sourceLabel}</span>
        <span className="rounded-full bg-[var(--primary-fixed)] px-2 py-0.5 text-[10px] font-black text-[var(--primary)]">Import</span>
      </span>
      {bookLine && <span className="mt-1 block text-[11px] font-black uppercase tracking-[0.08em] text-[var(--accent)]">{bookLine}</span>}
      <span className="mt-1 block font-semibold text-[var(--on-surface)]">{result.title}</span>
      <span className="mt-1 line-clamp-4 block text-[var(--on-surface-variant)]">{result.excerpt}</span>
      {metaLine && <span className="mt-2 block text-[11px] font-bold text-[var(--primary)]">{metaLine}</span>}
      {taxonomy.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {taxonomy.map((item) => (
            <span key={item} className="rounded-full border border-[var(--outline-variant)] px-2 py-0.5 text-[10px] font-bold text-[var(--on-surface-variant)]">
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
    <div className="space-y-3">
      {!compact && (
        <button className="secondary-button" onClick={onRefresh} type="button">
          <RefreshCcw size={15} />
          Refresh bank
        </button>
      )}
      {items.length === 0 ? (
        <div className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 text-xs text-[var(--on-surface-variant)]">No saved questions yet. Use the save icon on any question card.</div>
      ) : (
        items.map((item) => (
          <button key={item.id} className="w-full rounded border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-3 text-left text-xs hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]" onClick={() => onImport(item)} type="button">
            <span className="font-bold text-[var(--on-surface)]">{item.questionType ?? "Question"} · {item.marks ?? "?"} marks</span>
            <span className="mt-1 line-clamp-4 block text-[var(--on-surface-variant)]">{item.text}</span>
            <span className="mt-2 block text-[11px] font-bold text-[var(--on-surface-variant)]">{item.chapter ?? "No chapter"} · {item.difficulty ?? "Mixed"}</span>
          </button>
        ))
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
      <div className="mx-auto grid max-w-[980px] gap-4">
        <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-8 text-center">
          <LoaderCircle className="mx-auto animate-spin text-[var(--primary)]" size={24} />
          <div className="mt-3 text-sm font-bold text-[var(--on-surface)]">Loading workspace data</div>
          <p className="mt-1 text-xs text-[var(--on-surface-variant)]">Phoenix dashboard data will appear here once the API responds.</p>
        </div>
      </div>
    );
  }

  if (view === "library") {
    return (
      <div className="mx-auto grid max-w-[1100px] gap-5">
        <DashboardMetricGrid dashboard={dashboard} />
        <WorkspacePanel title="Recent papers" eyebrow="Saved work">
          {dashboard.recentPapers.length === 0 ? (
            <EmptyWorkspaceState title="No saved papers yet" description="Generated or imported papers will appear here after a version is saved." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {dashboard.recentPapers.map((paper) => (
                <button key={paper.id} className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-4 text-left hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]" onClick={() => onSelectPaper(paper)} type="button">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-lg font-semibold text-[var(--on-surface)]">{paper.title}</div>
                      <div className="mt-1 font-mono text-[11px] text-[var(--on-surface-variant)]">
                        {paper.board} Class {paper.classLevel} · {paper.subject}
                      </div>
                    </div>
                    <span className="rounded-full bg-[var(--surface-container-lowest)] px-2 py-1 text-[10px] font-black uppercase text-[var(--primary)]">{paper.status || "saved"}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
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
      <div className="mx-auto grid max-w-[1100px] gap-5">
        <DashboardMetricGrid dashboard={dashboard} />
        <div className="grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
          <WorkspacePanel title="Syllabus coverage" eyebrow="Corpus readiness">
            {dashboard.chapterCoverage.length === 0 ? (
              <EmptyWorkspaceState title="No chapters indexed" description="Ingest NCERT/PYQ files to build the chapter coverage map." />
            ) : (
              <div className="space-y-3">
                {dashboard.chapterCoverage.map((chapter) => (
                  <div key={chapter.id} className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[var(--on-surface)]">{chapter.name}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--on-surface-variant)]">
                          NCERT {chapter.ncertCount} · PYQ {chapter.pyqCount} · Bank {chapter.bankCount}
                        </div>
                      </div>
                      <span className="font-mono text-xs font-black text-[var(--primary)]">{chapter.coverageScore}%</span>
                    </div>
                    <ProgressLine value={chapter.coverageScore} />
                  </div>
                ))}
              </div>
            )}
          </WorkspacePanel>
          <div className="grid gap-5">
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
      <div className="mx-auto grid max-w-[1100px] gap-5">
        <WorkspacePanel title="Template suite" eyebrow="Formatting presets">
          {dashboard.templates.length === 0 ? (
            <EmptyWorkspaceState title="No templates saved" description="Upload templates from the Studio panel to reuse formatting and missing-parameter hints." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.templates.map((template) => (
                <button key={template.id} className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-4 text-left hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]" onClick={() => onUseTemplate(template)} type="button">
                  <div className="font-display text-lg font-semibold text-[var(--on-surface)]">{template.name}</div>
                  <p className="mt-2 line-clamp-3 text-xs text-[var(--on-surface-variant)]">{template.description || "Reusable paper template with formatting and request hints."}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Object.keys(template.formatting).slice(0, 4).map((key) => (
                      <span key={key} className="rounded-full bg-[var(--surface-container-lowest)] px-2 py-1 text-[10px] font-black uppercase text-[var(--primary)]">{key}</span>
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
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Saved papers" value={dashboard.counts.papers} detail={`${dashboard.counts.completedRuns}/${dashboard.counts.generationRuns} runs completed`} />
      <MetricCard label="Indexed chapters" value={dashboard.counts.chapters} detail={`${dashboard.counts.ncertQuestions} NCERT items`} />
      <MetricCard label="PYQ questions" value={dashboard.counts.pyqQuestions} detail="Tagged by marks, type, difficulty" />
      <MetricCard label="Question bank" value={dashboard.counts.questionBankItems} detail={`${dashboard.counts.templates} templates ready`} />
    </div>
  );
}

function WorkspacePanel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)]">
      <div className="border-b border-[var(--outline-variant)] px-5 py-4">
        <div className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[var(--primary)]">{eyebrow}</div>
        <h2 className="mt-1 font-display text-xl font-semibold text-[var(--on-surface)]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-4">
      <div className="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-[var(--on-surface-variant)]">{label}</div>
      <div className="mt-2 text-3xl font-black text-[var(--primary)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--on-surface-variant)]">{detail}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] px-3 py-2">
      <div className="font-mono text-[10px] font-black uppercase text-[var(--on-surface-variant)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--on-surface)]">{value}</div>
    </div>
  );
}

function DistributionRows({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  if (rows.length === 0) return <EmptyWorkspaceState title="No tags yet" description="Tagged imported questions will appear here." />;

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-bold text-[var(--on-surface)]">{row.label}</span>
            <span className="font-mono font-black text-[var(--primary)]">{row.value}</span>
          </div>
          <ProgressLine value={(row.value / max) * 100} />
        </div>
      ))}
    </div>
  );
}

function ProgressLine({ value }: { value: number }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-container-high)]">
      <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function RunList({ runs }: { runs: DashboardSummary["recentRuns"] }) {
  if (runs.length === 0) return <EmptyWorkspaceState title="No runs yet" description="Generation attempts will appear here with their current status." />;

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const request = run.request;
        const subject = String(request.subject ?? "Unknown subject");
        const marks = String(request.total_marks ?? request.totalMarks ?? "?");

        return (
          <div key={run.id} className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] font-black uppercase text-[var(--primary)]">{run.status}</span>
              <span className="font-mono text-[10px] text-[var(--on-surface-variant)]">{formatShortDate(run.insertedAt)}</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-[var(--on-surface)]">
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
    <div className="rounded border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-5 text-center">
      <div className="text-sm font-black text-[var(--on-surface)]">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-xs text-[var(--on-surface-variant)]">{description}</p>
    </div>
  );
}

function ProgressBadge({ status }: { status: GenerationStatus }) {
  const done = status.status === "completed";
  const failed = status.status === "failed";
  return (
    <div className="hidden min-w-36 items-center gap-2 rounded-full border border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-1.5 text-xs font-semibold text-[var(--on-surface-variant)] sm:flex">
      {done ? <CheckCircle2 className="text-emerald-600" size={14} /> : failed ? <RefreshCcw className="text-red-600" size={14} /> : <LoaderCircle className={status.status === "running" || status.status === "queued" ? "animate-spin text-[var(--primary)]" : "text-[var(--outline)]"} size={14} />}
      <span>{Math.round(status.progress)}%</span>
    </div>
  );
}

function tabClass(active: boolean) {
  return `rounded-md px-2 py-2 text-[11px] font-bold capitalize ${active ? "bg-[var(--surface-container-lowest)] text-[var(--primary)] " : "text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"}`;
}

function topNavClass(active: boolean) {
  return `h-9 rounded-md px-3 text-xs font-black uppercase tracking-[0.05em] ${
    active ? "bg-[var(--primary-fixed)] text-[var(--primary)]" : "text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)] hover:text-[var(--on-surface)]"
  }`;
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
      bankQuestion?: PaperQuestion;
      skipVersion?: boolean;
    }
  | { handled: false; providerInstruction?: string };

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
    };
  }

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
    };
  }

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

    const nextPaper = moveQuestionIntoInternalChoice(paper, source, target);
    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Moved Q${moveToOr.source} into the OR choice of Q${moveToOr.target}. Marks still count only once for that question.`,
      versionLabel: "chat_move_question_to_or",
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
    };
  }

  const partChoice = parseAddSubpartChoiceCommand(normalizedInstruction);
  if (partChoice) {
    const target = refs.find((ref) => ref.number === partChoice.questionNumber);
    const subpart = target?.question.subparts?.find((item) => (item.label ?? "").toLowerCase() === partChoice.label);
    if (!target || !subpart) return { handled: true, paper, message: `I could not find part (${partChoice.label}) in Q${partChoice.questionNumber}.` };

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
    };
  }

  const wholeChoiceNumber = parseAddWholeQuestionChoiceCommand(normalizedInstruction);
  if (wholeChoiceNumber) {
    const target = refs.find((ref) => ref.number === wholeChoiceNumber);
    if (!target) return { handled: true, paper, message: `I could not find Q${wholeChoiceNumber} to add OR.` };

    const nextPaper = updateQuestionInPaper(paper, target.section.id, target.question.id, {
      optionalChoice: emptyChoiceFromQuestion(target.question),
    });

    return {
      handled: true,
      paper: applyDocumentStyle(nextPaper, documentStyle),
      message: `Added an OR internal choice block to Q${wholeChoiceNumber}.`,
      versionLabel: "chat_add_question_or",
    };
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
  if (!/\b(move|put|add|shift)\b/.test(lower) || !/\bor\b/.test(lower)) return null;
  if (/\b(similar|same topic|different|generate|new)\b/.test(lower)) return null;
  if (!/\b(?:q|ques|question|quesion)\s*\.?\s*\d+\b/.test(lower)) return null;

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
    lower.match(/\b(?:option|choice)\s*\(?([a-d])\)?/)?.[1] ??
    lower.match(/\(([a-d])\)/)?.[1];
  if (!questionNumber || !optionLabel) return null;
  return { action, questionNumber, optionLabel };
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
  return /\b(add|create|insert)\b/.test(instruction) && /\bsection\b/.test(instruction);
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
    options: question.options?.map((option) => ({ ...option, id: crypto.randomUUID() })),
    subparts: question.subparts?.map((subpart) => ({
      ...subpart,
      id: crypto.randomUUID(),
      optionalChoice: subpart.optionalChoice ? { ...subpart.optionalChoice, id: crypto.randomUUID() } : undefined,
    })),
    optionalChoice: question.optionalChoice ? { ...question.optionalChoice, id: crypto.randomUUID() } : undefined,
  });
}

function cloneSubpart(subpart: PaperSubpart): PaperSubpart {
  return {
    ...subpart,
    id: crypto.randomUUID(),
    optionalChoice: subpart.optionalChoice ? { ...subpart.optionalChoice, id: crypto.randomUUID() } : undefined,
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
  const totalMarks = paper.sections.reduce((paperTotal, section) => paperTotal + section.questions.reduce((sectionTotal, question) => sectionTotal + Number(question.marks || 0), 0), 0);
  const questionCount = paper.sections.reduce((count, section) => count + section.questions.length, 0);
  const topicWeightage: Record<string, number> = {};

  paper.sections.forEach((section) => {
    section.questions.forEach((question) => {
      const topic = question.topic || paper.metadata.topic || paper.metadata.chapter || section.title || "Unassigned";
      topicWeightage[topic] = (topicWeightage[topic] || 0) + Number(question.marks || 0);
    });
  });

  return {
    ...paper,
    summary: {
      ...paper.summary,
      totalMarks,
      questionCount,
    },
    topicWeightage,
    sourceMix: calculateSourceMix(paper),
    pageCount: Math.max(1, paper.sections.length + 1),
  };
}

function calculateSourceMix(paper: Paper): NonNullable<Paper["sourceMix"]> {
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
            .map((option) => optionToHtml(option.label || "", option.richText || textToHtml(option.text)))
            .join("");
          const choiceOptionsHtml = optionListToHtml((question.optionalChoice as { options?: { label?: string; text: string; richText?: string }[] } | undefined)?.options);
          const subpartsHtml = (question.subparts ?? [])
            .map(
              (subpart) => `
                <div class="subpart"><strong>(${escapeHtml(subpart.label || "")})</strong><div>${subpart.richText || textToHtml(subpart.text)}</div><span>[${subpart.marks ?? ""} marks]</span></div>
                ${subpart.optionalChoice ? `<div class="or">OR</div><div class="subpart choice"><strong></strong><div>${subpart.optionalChoice.richText || textToHtml(subpart.optionalChoice.text)}</div><span>[${subpart.optionalChoice.marks ?? subpart.marks ?? ""} marks]</span></div>` : ""}
              `,
            )
            .join("");
          const html = `
            <div class="question">
              <div class="q-main"><strong>${questionNumber++}.</strong><div>${question.richText || textToHtml(question.text)}</div><span>[${question.marks} marks]</span></div>
              ${optionsHtml}
              ${subpartsHtml}
              ${question.optionalChoice ? `<div class="or">OR</div><div class="q-main choice"><strong></strong><div>${question.optionalChoice.richText || textToHtml(question.optionalChoice.text)}</div><span>[${question.optionalChoice.marks ?? question.marks} marks]</span></div>${choiceOptionsHtml}` : ""}
            </div>`;
          return html;
        })
        .join("");

      return `<section><h2>${escapeHtml(section.title)}</h2><p class="instructions">${escapeHtml(section.instructions)}</p>${questions}</section>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(printablePaper.title)}</title><style>
    @page{size:A4;margin:${Math.max(16, Math.round(documentStyle.margin / 2))}px}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Georgia,serif;line-height:${documentStyle.lineHeight};margin:0;color:${documentStyle.textColor};background:${documentStyle.pageColor};font-size:${documentStyle.fontSize}px}
    header{text-align:center;border-bottom:1px solid #cbd5e1;padding-bottom:18px;margin-bottom:18px}
    h1{font-family:Arial,sans-serif;font-size:22px;text-transform:uppercase;margin:8px 0}
    h2{font-family:Arial,sans-serif;font-size:14px;text-transform:uppercase;margin-top:24px}
    .meta{display:flex;justify-content:center;gap:16px;font-family:Arial,sans-serif;font-size:12px;color:#475569}
    .question{margin:16px 0;break-inside:avoid;page-break-inside:avoid}.q-main,.subpart{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;align-items:start}
    .option{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;margin:6px 0 6px 44px;break-inside:avoid;page-break-inside:avoid}
    .option div,.q-main div,.subpart div{min-width:0}
    .option p,.q-main p,.subpart p{margin:0 0 4px}
    .subpart{margin:8px 0 8px 32px}
    .instructions{font-size:14px;color:#475569}.or{text-align:center;font-family:Arial,sans-serif;font-weight:bold;color:#1d4ed8;margin:10px 0}
  </style></head><body><header><div>Series: QPG/${escapeHtml(printablePaper.metadata.board || "CBSE")} · Q.P. Code: ${escapeHtml(printablePaper.metadata.qpCode || "30/S/1")}</div><h1>${escapeHtml(printablePaper.title)}</h1><div class="meta"><span>${escapeHtml(printablePaper.metadata.board)} Class ${escapeHtml(printablePaper.metadata.classLevel)}</span><span>${escapeHtml(printablePaper.metadata.subject)}</span><span>Time: ${formatDuration(printablePaper.metadata.durationMinutes)}</span><span>Max Marks: ${printablePaper.summary.totalMarks}</span></div></header>${sectionHtml}</body></html>`;
}

function optionListToHtml(options?: { label?: string; text: string; richText?: string }[]) {
  return (options ?? []).map((option) => optionToHtml(option.label || "", option.richText || textToHtml(option.text))).join("");
}

function optionToHtml(label: string, contentHtml: string) {
  return `<div class="option"><strong>${escapeHtml(label)}</strong><div>${contentHtml}</div></div>`;
}

function textToHtml(text: string) {
  return richTextFromText(text) || escapeHtml(text).replaceAll("\n", "<br>");
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

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
