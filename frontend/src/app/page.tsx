"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Database,
  Download,
  FileText,
  FileUp,
  HelpCircle,
  LayoutDashboard,
  LoaderCircle,
  RefreshCcw,
  Save,
  Send,
  Search,
  Settings,
  Sparkles,
  Square,
  Archive,
  BarChart3,
  BookOpen,
} from "lucide-react";
import { PaperEditor } from "@/components/paper-editor";
import {
  exportToClassroomViaApi,
  fetchChaptersViaApi,
  fetchDashboardViaApi,
  fetchQuestionBankViaApi,
  fetchRetrievalPreviewViaApi,
  fetchUsageViaApi,
  generateViaApi,
  getPaperViaApi,
  importQuestionFromImageViaApi,
  importQuestionFromSourceViaApi,
  refineViaApi,
  saveQuestionToBankViaApi,
  saveVersionViaApi,
} from "@/lib/api";
import { defaultRequest, requestFromPrompt } from "@/lib/request-defaults";
import {
  AiUsageSummary,
  DashboardSummary,
  DocumentStyle,
  GenerationStatus,
  Paper,
  PaperQuestion,
  PaperRequest,
  PaperTemplate,
  PaperVersion,
  QuestionBankItem,
  RetrievalPreview,
  RetrievalResult,
} from "@/lib/types";

type Mode = "structured" | "prompt";
type RightPanel = "chat" | "retrieval" | "bank" | "versions";
type AppView = "studio" | "library" | "analytics" | "templates";
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

export default function Home() {
  const [appView, setAppView] = useState<AppView>("studio");
  const [mode, setMode] = useState<Mode>("structured");
  const [rightPanel, setRightPanel] = useState<RightPanel>("chat");
  const [request, setRequest] = useState<PaperRequest>({
    ...defaultRequest,
    chapter: "Quadratic Equations",
    chapterScope: "single",
    chapters: ["Quadratic Equations"],
    topic: "Quadratic Equations",
    totalMarks: 50,
    durationMinutes: 120,
    variantCount: 3,
  });
  const [prompt, setPrompt] = useState("CBSE class 10 maths 50 marks from Quadratic Equations using NCERT and PYQ format");
  const [availableChapters, setAvailableChapters] = useState<string[]>([]);
  const [documentStyle, setDocumentStyle] = useState<DocumentStyle>(defaultDocumentStyle);
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
    setVariantPapers((papers) => papers.map((paper) => applyTemplateToExistingPaper(paper, paperTemplate)));
    addAssistantMessage(`Template selected: ${template.name}`);
  }

  async function refreshRetrievalPreview(nextRequest = requestPreview) {
    const preview = await fetchRetrievalPreviewViaApi(nextRequest);
    setRetrievalPreview(preview);
  }

  async function refreshQuestionBank() {
    const items = await fetchQuestionBankViaApi(request);
    setQuestionBank(items);
  }

  async function refreshDashboard() {
    setDashboard(await fetchDashboardViaApi());
  }

  async function loadTemplate(file: File) {
    const text = await file.text();
    const template = parseTemplate(file.name, text);
    setRequest((current) => ({ ...current, template }));
    setDocumentStyle((current) => ({ ...current, ...template.formatting }));

    if (template.inferredParams) {
      setRequest((current) => ({
        ...current,
        ...template.inferredParams,
        template,
      }));
    }

    addAssistantMessage(`Template loaded: ${template.name}`);
  }

  async function runGeneration() {
    if (isGenerating) return;

    const nextRequest = mode === "prompt" ? requestFromPrompt(prompt) : request;
    setSelectedPaper(null);
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
      setSelectedPaper(paper);
      await refreshVersions(paper.paperId);
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
    setSelectedPaper(paper);
    setDocumentStyle((current) => ({ ...current, ...paper.documentStyle }));
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
    const paper = await getPaperViaApi(paperId);
    const latestVersion = paper?.versions?.[0];

    if (!latestVersion) {
      addAssistantMessage("I could not load that paper. It has no saved version payload yet.");
      return;
    }

    const restored = normalizeVersionPayload(latestVersion.payload, paperId);
    const mergedStyle = { ...documentStyle, ...restored.documentStyle };
    setSelectedPaper(applyDocumentStyle(restored, mergedStyle));
    setDocumentStyle(mergedStyle);
    await refreshVersions(paperId);
    addAssistantMessage(`Loaded ${restored.title} from the library.`);
  }

  function stopGeneration() {
    setIsGenerating(false);
    setStatus({ status: "idle", step: "stopped", message: "Stopped locally", progress: 0 });
  }

  function updateSelectedPaper(paper: Paper) {
    const styledPaper = applyDocumentStyle(recalculatePaper(paper), documentStyle);
    setSelectedPaper(styledPaper);
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

    setIsChatting(true);
    setStatus({ status: "running", step: "refining", message: "Applying refinement", progress: 65 });

    try {
      const refinement = await refineViaApi(selectedPaper, instruction);
      const nextPaper = applyDocumentStyle(recalculatePaper(refinement.preview), documentStyle);
      setSelectedPaper(nextPaper);
      setVariantPapers((papers) => papers.map((item) => (item.id === nextPaper.id ? nextPaper : item)));
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

  async function replaceQuestionWithAi(sectionId: string, questionId: string, questionNumber: number) {
    const section = selectedPaper?.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);

    await askAi(
      [
        `Replace global question ${questionNumber} in ${section?.title ?? "the paper"}.`,
        `Question id: ${questionId}.`,
        `Current question: ${question?.text ?? ""}`,
        `Preserve ${question?.marks ?? "the same"} marks, ${question?.type ?? "same"} type, ${question?.difficulty ?? "same"} difficulty, and the paper total.`,
        "Generate a genuinely different valid question from the selected chapters using owned NCERT/PYQ context.",
      ].join("\n"),
    );
  }

  async function replaceOptionalChoiceWithAi(sectionId: string, questionId: string, questionNumber: number) {
    const section = selectedPaper?.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);

    await askAi(
      [
        `Replace the OR internal choice of global question ${questionNumber} in ${section?.title ?? "the paper"}.`,
        `Question id: ${questionId}.`,
        `Main question: ${question?.text ?? ""}`,
        `Current OR choice: ${question?.optionalChoice?.text ?? ""}`,
        `Preserve ${question?.marks ?? "the same"} marks, ${question?.type ?? "same"} type, ${question?.difficulty ?? "same"} difficulty, and the paper total.`,
        "Only change the optionalChoice branch, not the main question.",
      ].join("\n"),
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
    setSelectedPaper(restored);
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

      const basePaper = selectedPaper ?? createDraftPaper(importRequest, documentStyle);
      updateSelectedPaper(appendQuestionToPaper(basePaper, imported));
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

  async function exportToClassroom() {
    if (!selectedPaper) return;

    const courseId = window.prompt("Google Classroom course ID");
    if (!courseId) return;

    const attachmentUrl = window.prompt("Public Google Drive/link URL to attach");
    if (!attachmentUrl) return;

    const result = await exportToClassroomViaApi(selectedPaper, { courseId, attachmentUrl });
    const statusText = result?.status === "created" ? "Created Classroom material." : "Prepared Classroom payload. Add GOOGLE_CLASSROOM_ACCESS_TOKEN to publish directly.";
    addAssistantMessage(statusText);
  }

  function addUserMessage(text: string) {
    setChatMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "user", text }]);
  }

  function addAssistantMessage(text: string) {
    setChatMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "assistant", text }]);
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--background)] text-[var(--on-surface)]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--outline-variant)] bg-[var(--surface)] px-6">
        <div className="flex min-w-0 items-center gap-6">
          <div className="hidden items-center gap-2 rounded border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] px-2 py-1.5 lg:flex">
            <Search size={15} className="text-[var(--on-surface-variant)]" />
            <input className="w-56 bg-transparent font-mono text-[12px] outline-none placeholder:text-[var(--outline)]" placeholder="Command..." />
            <span className="rounded-sm border border-[var(--outline-variant)] bg-[var(--surface-variant)] px-1 font-mono text-[10px] text-[var(--on-surface-variant)]">Ctrl K</span>
          </div>
          <div>
            <div className="font-display text-2xl font-semibold text-[var(--primary)]">Academic Command Center</div>
            <div className="font-mono text-[11px] text-[var(--on-surface-variant)]">Question Paper Studio · owned corpus workflow</div>
          </div>
          <nav className="hidden h-16 items-center gap-1 xl:flex">
            {[
              ["studio", "Studio"],
              ["library", "Library"],
              ["analytics", "Analytics"],
              ["templates", "Templates"],
            ].map(([view, label]) => (
              <button key={view} className={topNavClass(appView === view)} onClick={() => setAppView(view as AppView)} type="button">
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button className="hidden rounded border border-[var(--outline-variant)] bg-[var(--on-surface)] px-4 py-2 text-xs font-black uppercase tracking-[0.05em] text-[var(--surface)] hover:bg-[var(--primary)] md:inline-flex" onClick={() => void runGeneration()} type="button">
            Create New Paper
          </button>
          <button className="icon-button" title="Help" type="button">
            <HelpCircle size={16} />
          </button>
          <button className="icon-button" title="Settings" type="button">
            <Settings size={16} />
          </button>
          <div className="ml-1 flex h-8 w-8 items-center justify-center rounded border border-[var(--outline-variant)] bg-[var(--surface-container-high)] font-mono text-[11px] font-bold text-[var(--primary)]">TP</div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="hidden w-[320px] shrink-0 border-r border-[var(--outline-variant)] bg-[var(--surface-container-low)] lg:flex lg:flex-col">
        <div className="border-b border-[var(--outline-variant)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[var(--outline-variant)] bg-[var(--surface-container-high)] text-[var(--primary)]">
              <FileText size={18} />
            </div>
            <div>
              <div className="font-display text-xl font-semibold text-[var(--on-surface)]">Paper Lab</div>
              <p className="font-mono text-[11px] text-[var(--on-surface-variant)]">Senior Faculty Portal</p>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-1">
            {[
              { view: "studio" as AppView, label: "Generation Studio", icon: LayoutDashboard },
              { view: "library" as AppView, label: "Paper Library", icon: Archive },
              { view: "analytics" as AppView, label: "Syllabus Coverage", icon: BarChart3 },
              { view: "templates" as AppView, label: "Template Suite", icon: BookOpen },
            ].map((item) => (
              <button key={item.view} className={sideNavClass(appView === item.view)} onClick={() => setAppView(item.view)} type="button">
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </div>

          <div className="border-t border-[var(--outline-variant)]" />

          {appView === "studio" && (
            <>
          <div className="grid grid-cols-2 rounded-lg bg-[var(--surface-container-high)] p-1">
            <button className={tabClass(mode === "structured")} onClick={() => setMode("structured")} type="button">
              Parameters
            </button>
            <button className={tabClass(mode === "prompt")} onClick={() => setMode("prompt")} type="button">
              Prompt
            </button>
          </div>

          {mode === "prompt" ? (
            <Field label="Free prompt">
              <textarea className="input min-h-32 resize-none" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Board">
                  <Select value={request.board} onChange={(event) => updateRequest("board", event.target.value as PaperRequest["board"])}>
                    <option>CBSE</option>
                    <option>ICSE</option>
                  </Select>
                </Field>
                <Field label="Class">
                  <Select value={request.classLevel} onChange={(event) => updateRequest("classLevel", event.target.value as PaperRequest["classLevel"])}>
                    {["9", "10", "11", "12"].map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Template (optional)">
                <Select
                  value={request.template?.name ?? ""}
                  onChange={(event) => {
                    const template = dashboard?.templates.find((item) => item.name === event.target.value);

                    if (!template) {
                      setRequest((current) => ({ ...current, template: null }));
                      return;
                    }

                    applyDashboardTemplate(template);
                  }}
                >
                  <option value="">Default editor style</option>
                  {(dashboard?.templates ?? []).map((template) => (
                    <option key={template.id} value={template.name}>
                      {template.name}
                    </option>
                  ))}
                </Select>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-2 text-xs font-bold text-[var(--on-surface-variant)] hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]">
                  <FileUp size={15} />
                  <span>{request.template?.name ?? "Upload TXT / MD / JSON"}</span>
                  <input
                    className="sr-only"
                    type="file"
                    accept=".txt,.md,.json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void loadTemplate(file);
                    }}
                  />
                </label>
              </Field>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3">
                <StyleNumber label="Font" value={documentStyle.fontSize} min={12} max={22} onChange={(fontSize) => setDocumentStyle((current) => ({ ...current, fontSize }))} />
                <StyleNumber label="Spacing" value={documentStyle.lineHeight} min={1.1} max={2.2} step={0.05} onChange={(lineHeight) => setDocumentStyle((current) => ({ ...current, lineHeight }))} />
                <StyleNumber label="Margin" value={documentStyle.margin} min={24} max={96} onChange={(margin) => setDocumentStyle((current) => ({ ...current, margin }))} />
                <label className="grid gap-1 text-[11px] font-bold text-[var(--on-surface-variant)]">
                  <span>Text color</span>
                  <input className="h-8 w-full rounded border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-1" type="color" value={documentStyle.textColor} onChange={(event) => setDocumentStyle((current) => ({ ...current, textColor: event.target.value }))} />
                </label>
              </div>

              <Field label="Subject">
                <Select value={request.subject} onChange={(event) => updateRequest("subject", event.target.value as PaperRequest["subject"])}>
                  {["Maths", "Physics", "Chemistry", "Biology"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Chapter scope">
                <Select value={request.chapterScope} onChange={(event) => updateRequest("chapterScope", event.target.value as PaperRequest["chapterScope"])}>
                  <option value="single">One chapter</option>
                  <option value="multiple">List of chapters</option>
                  <option value="full_syllabus">Whole syllabus</option>
                </Select>
              </Field>

              {request.chapterScope !== "full_syllabus" && (
                <Field label={request.chapterScope === "single" ? "Choose chapter" : "Choose chapters"}>
                  <ChapterPicker
                    availableChapters={availableChapters}
                    mode={request.chapterScope}
                    selectedChapters={request.chapters}
                    onChange={(chapters) => {
                      updateRequest("chapters", chapters);
                      updateRequest("chapter", chapters[0] ?? "");
                      updateRequest("topic", chapters.join(", "));
                    }}
                  />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Field label="Marks">
                  <input className="input" type="number" value={request.totalMarks} onChange={(event) => updateRequest("totalMarks", Number(event.target.value))} />
                </Field>
                <Field label="Sets">
                  <input className="input" type="number" min={1} max={5} value={request.variantCount} onChange={(event) => updateRequest("variantCount", Number(event.target.value))} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Difficulty">
                  <Select value={request.difficulty} onChange={(event) => updateRequest("difficulty", event.target.value as PaperRequest["difficulty"])}>
                    <option>Easy</option>
                    <option>Medium</option>
                    <option>Hard</option>
                  </Select>
                </Field>
                <Field label="Source">
                  <Select value={request.source} onChange={(event) => updateRequest("source", event.target.value as PaperRequest["source"])}>
                    <option>NCERT</option>
                    <option>PYQ</option>
                    <option>NCERT + PYQ</option>
                  </Select>
                </Field>
              </div>
            </>
          )}

          <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 text-xs text-[var(--on-surface-variant)]">
            <div className="font-bold text-[var(--on-surface)]">Request</div>
            <div className="mt-1">
              {requestPreview.board} Class {requestPreview.classLevel} {requestPreview.subject}, {requestPreview.totalMarks} marks
            </div>
            <div className="mt-1 truncate">{requestPreview.chapterScope === "full_syllabus" ? "Whole syllabus" : requestPreview.chapters.join(", ")}</div>
          </div>

          {variantPapers.length > 0 && (
            <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-3">
              <div className="mb-2 text-xs font-bold text-[var(--on-surface)]">Generated sets</div>
              <div className="space-y-2">
                {variantPapers.map((paper, index) => (
                  <button
                    key={paper.id}
                    className={`w-full rounded-md border px-3 py-2 text-left text-xs font-semibold ${
                      selectedPaper?.id === paper.id ? "border-[var(--primary)] bg-[var(--primary-fixed)] text-[var(--primary)]" : "border-[var(--outline-variant)] bg-[var(--surface-container-low)] text-[var(--on-surface-variant)]"
                    }`}
                    onClick={() => void selectVariant(paper)}
                    type="button"
                  >
                    Set {String.fromCharCode(65 + index)}
                    <span className="block font-normal">{paper.summary.totalMarks} marks · {paper.summary.questionCount} questions</span>
                  </button>
                ))}
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {appView === "studio" && <div className="space-y-2 border-t border-[var(--outline-variant)] p-4">
          <button className="primary-button" disabled={isGenerating} onClick={() => void runGeneration()} type="button">
            {isGenerating ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}
            {isGenerating ? "Generating" : "Generate paper"}
          </button>
          {isGenerating && (
            <button className="secondary-button" onClick={stopGeneration} type="button">
              <Square size={15} />
              Stop
            </button>
          )}
        </div>}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] px-4">
          <div>
            <div className="text-sm font-bold">{appView === "studio" ? selectedPaper?.title ?? "Untitled paper" : viewTitle(appView)}</div>
            <div className="text-xs text-[var(--on-surface-variant)]">{appView === "studio" ? status.message : viewSubtitle(appView)}</div>
          </div>
          <div className="flex items-center gap-2">
            {appView === "studio" ? (
              <>
                <ProgressBadge status={status} />
                <button className="icon-button" onClick={() => void saveCurrentVersion()} title="Save version" type="button">
                  <Save size={16} />
                </button>
                <button className="icon-button" onClick={() => exportCurrent("pdf")} title="Export PDF" type="button">
                  <Download size={16} />
                </button>
                <button className="hidden rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-2 text-xs font-bold text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] md:inline-flex" onClick={() => exportCurrent("docx")} type="button">
                  DOCX
                </button>
                <button className="hidden rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-2 text-xs font-bold text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] md:inline-flex" onClick={() => void exportToClassroom()} type="button">
                  Classroom
                </button>
              </>
            ) : (
              <button className="secondary-button !min-h-9 !w-auto px-4" onClick={() => void refreshDashboard()} type="button">
                <RefreshCcw size={15} />
                Refresh
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-8">
          {appView === "studio" && lastError && (
            <div className="mx-auto mb-4 max-w-[980px] rounded-lg border border-[var(--error)] bg-[var(--error-container)] px-4 py-3 text-sm font-semibold text-[var(--on-error-container)]">
              <div className="font-black">Last error</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-xs font-medium">{lastError}</div>
            </div>
          )}
          {appView === "studio" ? (
            <PaperEditor
              documentStyle={documentStyle}
              isGenerating={isGenerating}
              paper={selectedPaper}
              onImportImage={(sectionId) => void importQuestionImage(sectionId)}
              onPaperChange={updateSelectedPaper}
              onReplaceQuestion={(sectionId, questionId, questionNumber) => void replaceQuestionWithAi(sectionId, questionId, questionNumber)}
              onReplaceOptionalChoice={(sectionId, questionId, questionNumber) => void replaceOptionalChoiceWithAi(sectionId, questionId, questionNumber)}
              onSaveQuestionToBank={(question) => void saveQuestionToBank(question)}
            />
          ) : (
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
          )}
        </div>
      </section>

      {appView === "studio" && <aside className="hidden w-[380px] shrink-0 border-l border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] lg:flex lg:flex-col">
        <div className="border-b border-[var(--outline-variant)] px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Bot size={18} />
            V2 controls
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-[var(--surface-container-high)] p-1">
            {(["chat", "retrieval", "bank", "versions"] as RightPanel[]).map((panel) => (
              <button key={panel} className={tabClass(rightPanel === panel)} onClick={() => setRightPanel(panel)} type="button">
                {panel}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {rightPanel === "chat" && (
            <>
              {usage && (
                <div className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 text-xs text-[var(--on-surface-variant)]">
                  <div className="font-bold text-[var(--on-surface)]">API usage</div>
                  <div className="mt-1">{usage.totalTokens} tokens · ${usage.estimatedCostUsd.toFixed(6)}</div>
                </div>
              )}
              {chatMessages.map((message) => (
                <div key={message.id} className={message.role === "user" ? "ml-8 rounded bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--on-primary)]" : "mr-8 rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-2 text-xs text-[var(--on-surface)]"}>
                  {message.text}
                </div>
              ))}
              {(isGenerating || isChatting) && (
                <div className="mr-8 flex items-center gap-2 rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-3 py-2 text-xs text-[var(--on-surface-variant)]">
                  <LoaderCircle className="animate-spin" size={14} />
                  {isChatting ? "Editing paper..." : "Generating paper..."}
                </div>
              )}
            </>
          )}

          {rightPanel === "retrieval" && (
            <RetrievalPanel preview={retrievalPreview} onImport={(result) => void importSourceQuestion(result)} onRefresh={() => void refreshRetrievalPreview()} />
          )}

          {rightPanel === "bank" && (
            <QuestionBankPanel items={questionBank} onImport={(item) => void importBankQuestion(item)} onRefresh={() => void refreshQuestionBank()} />
          )}

          {rightPanel === "versions" && (
            <VersionPanel versions={versions} onRestore={(version) => void restoreVersion(version)} />
          )}
        </div>

        <div className="border-t border-[var(--outline-variant)] p-4">
          <div className="relative">
            <input
              className="input pr-11"
              placeholder="Format, replace Q5, move marking scheme..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void askAi();
              }}
            />
            <button className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--on-primary)]" onClick={() => void askAi()} type="button">
              <Send size={14} />
            </button>
          </div>
        </div>
      </aside>}
      </div>
    </main>
  );
}

function RetrievalPanel({ preview, onImport, onRefresh }: { preview: RetrievalPreview | null; onImport: (result: RetrievalResult) => void; onRefresh: () => void }) {
  const results = [...(preview?.ncert ?? []), ...(preview?.pyq ?? []), ...(preview?.questionBank ?? [])];
  const sectionChapters = preview?.sectionSources?.chapters ?? [];
  const hasSectionSources = sectionChapters.some((chapter) => chapter.sections.some((section) => section.ncert.length > 0 || section.pyq.length > 0));

  return (
    <div className="space-y-3">
      <button className="secondary-button" onClick={onRefresh} type="button">
        <Database size={15} />
        Refresh retrieval
      </button>
      {preview?.warnings.map((warning) => (
        <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          {warning}
        </div>
      ))}
      {hasSectionSources ? (
        <div className="space-y-4">
          {sectionChapters.map((chapter) => (
            <div key={chapter.name} className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-[var(--on-surface)]">{chapter.name}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-[var(--on-surface-variant)]">NCERT exercises/examples and matching PYQs</div>
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
      ) : results.length === 0 ? (
        <div className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 text-xs text-[var(--on-surface-variant)]">No retrieval results yet. Add NCERT/PYQ data or generate a preview.</div>
      ) : (
        results.map((result) => <SourceResultButton key={`${result.sourceType}-${result.id}`} result={result} onImport={onImport} />)
      )}
    </div>
  );
}

function SourceResultButton({ result, onImport }: { result: RetrievalResult; onImport: (result: RetrievalResult) => void }) {
  const sourceLabel = result.sourceType.replaceAll("_", " ").toUpperCase();

  return (
    <button className="w-full rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-3 text-left text-xs hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]" onClick={() => onImport(result)} type="button">
      <span className="flex items-center justify-between gap-2">
        <span className="font-bold text-[var(--on-surface)]">{sourceLabel}</span>
        <span className="rounded-full bg-[var(--primary-fixed)] px-2 py-0.5 text-[10px] font-black text-[var(--primary)]">Import</span>
      </span>
      <span className="mt-1 block font-semibold text-[var(--on-surface)]">{result.title}</span>
      <span className="mt-1 line-clamp-4 block text-[var(--on-surface-variant)]">{result.excerpt}</span>
      <span className="mt-2 block text-[11px] font-bold text-[var(--primary)]">
        {result.sectionLabel ?? result.questionType ?? "source"} · {result.marks ?? "?"} marks
      </span>
    </button>
  );
}

function QuestionBankPanel({ items, onImport, onRefresh }: { items: QuestionBankItem[]; onImport: (item: QuestionBankItem) => void; onRefresh: () => void }) {
  return (
    <div className="space-y-3">
      <button className="secondary-button" onClick={onRefresh} type="button">
        <RefreshCcw size={15} />
        Refresh bank
      </button>
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

function VersionPanel({ versions, onRestore }: { versions: PaperVersion[]; onRestore: (version: PaperVersion) => void }) {
  if (versions.length === 0) {
    return <div className="rounded border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 text-xs text-[var(--on-surface-variant)]">No versions saved yet.</div>;
  }

  return (
    <div className="space-y-2">
      {versions.map((version) => (
        <button key={version.id} className="w-full rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] px-3 py-2 text-left text-xs text-[var(--on-surface-variant)] hover:border-[var(--primary-container)] hover:bg-[var(--primary-fixed)]" onClick={() => onRestore(version)} type="button">
          <span className="font-bold text-[var(--on-surface)]">Version {version.versionNumber}</span>
          <span className="block">{version.changeSource.replaceAll("_", " ")}</span>
          {version.marksTotal !== undefined && <span className="block text-[11px]">{version.marksTotal} marks</span>}
        </button>
      ))}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-bold text-[var(--on-surface-variant)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ""}`} />;
}

function ChapterPicker({
  availableChapters,
  mode,
  selectedChapters,
  onChange,
}: {
  availableChapters: string[];
  mode: PaperRequest["chapterScope"];
  selectedChapters: string[];
  onChange: (chapters: string[]) => void;
}) {
  const chapters = availableChapters.length > 0 ? availableChapters : selectedChapters;

  if (chapters.length === 0) {
    return (
      <input
        className="input"
        placeholder="Type chapter name"
        value={selectedChapters.join(", ")}
        onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
      />
    );
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-2">
      {chapters.map((chapter) => {
        const selected = selectedChapters.includes(chapter);

        return (
          <button
            key={chapter}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold ${
              selected ? "bg-[var(--primary-fixed)] text-[var(--primary)]" : "text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]"
            }`}
            onClick={() => {
              if (mode === "single") {
                onChange([chapter]);
                return;
              }

              onChange(selected ? selectedChapters.filter((item) => item !== chapter) : [...selectedChapters, chapter]);
            }}
            type="button"
          >
            <span>{chapter}</span>
            {selected && <CheckCircle2 size={14} />}
          </button>
        );
      })}
    </div>
  );
}

function StyleNumber({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-[var(--on-surface-variant)]">
      <span className="flex items-center justify-between">
        {label}
        <span className="font-semibold text-[var(--outline)]">{value}</span>
      </span>
      <input className="accent-[var(--primary)]" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
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

function sideNavClass(active: boolean) {
  return `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-black uppercase tracking-[0.04em] ${
    active ? "bg-[var(--primary-fixed)] text-[var(--primary)]" : "text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
  }`;
}

function viewTitle(view: AppView) {
  switch (view) {
    case "library":
      return "Paper Library";
    case "analytics":
      return "Syllabus Coverage";
    case "templates":
      return "Template Suite";
    default:
      return "Question Paper Studio";
  }
}

function viewSubtitle(view: AppView) {
  switch (view) {
    case "library":
      return "Saved papers, versions, and recent AI runs";
    case "analytics":
      return "Real corpus coverage by chapter, source, and difficulty";
    case "templates":
      return "Reusable formatting and request presets";
    default:
      return "Structured generation workspace";
  }
}

function describeRequest(request: PaperRequest) {
  return `${request.board} class ${request.classLevel} ${request.subject}, ${request.totalMarks} marks, ${request.chapters.join(", ") || "whole syllabus"}`;
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

  return {
    ...paper,
    sections: paper.sections.map((section) =>
      section.id === targetSectionId
        ? {
            ...section,
            questions: [...section.questions, { ...question, id: crypto.randomUUID() }],
          }
        : section,
    ),
  };
}

function paperToHtml(paper: Paper, documentStyle: DocumentStyle) {
  let questionNumber = 1;
  const sectionHtml = paper.sections
    .map((section) => {
      const questions = section.questions
        .map((question) => {
          const html = `
            <div class="question">
              <div class="q-main"><strong>${questionNumber++}.</strong><div>${question.richText || textToHtml(question.text)}</div><span>[${question.marks} marks]</span></div>
              ${question.optionalChoice ? `<div class="or">OR</div><div class="q-main choice"><strong></strong><div>${question.optionalChoice.richText || textToHtml(question.optionalChoice.text)}</div><span>[${question.optionalChoice.marks ?? question.marks} marks]</span></div>` : ""}
            </div>`;
          return html;
        })
        .join("");

      return `<section><h2>${escapeHtml(section.title)}</h2><p class="instructions">${escapeHtml(section.instructions)}</p>${questions}</section>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(paper.title)}</title><style>
    body{font-family:Georgia,serif;line-height:${documentStyle.lineHeight};margin:${documentStyle.margin}px;color:${documentStyle.textColor};background:${documentStyle.pageColor}}
    header{text-align:center;border-bottom:1px solid #cbd5e1;padding-bottom:18px;margin-bottom:18px}
    h1{font-family:Arial,sans-serif;font-size:22px;text-transform:uppercase;margin:8px 0}
    h2{font-family:Arial,sans-serif;font-size:14px;text-transform:uppercase;margin-top:24px}
    .meta{display:flex;justify-content:center;gap:16px;font-family:Arial,sans-serif;font-size:12px;color:#475569}
    .question{margin:16px 0}.q-main{display:grid;grid-template-columns:32px 1fr auto;gap:12px;align-items:start}
    .instructions{font-size:14px;color:#475569}.or{text-align:center;font-family:Arial,sans-serif;font-weight:bold;color:#1d4ed8;margin:10px 0}
  </style></head><body><header><div>Series: QPG/${escapeHtml(paper.metadata.board || "CBSE")} · Q.P. Code: ${escapeHtml(paper.metadata.qpCode || "30/S/1")}</div><h1>${escapeHtml(paper.title)}</h1><div class="meta"><span>${escapeHtml(paper.metadata.board)} Class ${escapeHtml(paper.metadata.classLevel)}</span><span>${escapeHtml(paper.metadata.subject)}</span><span>Time: ${formatDuration(paper.metadata.durationMinutes)}</span><span>Max Marks: ${paper.summary.totalMarks}</span></div></header>${sectionHtml}</body></html>`;
}

function textToHtml(text: string) {
  return escapeHtml(text).replaceAll("\n", "<br>");
}

function parseTemplate(name: string, text: string): PaperTemplate {
  const parsed = parseJsonTemplate(name, text);
  if (parsed) return parsed;

  const lower = text.toLowerCase();
  const marksMatch = text.match(/(?:maximum|max)\s*marks?\s*:?\s*(\d+)/i) ?? text.match(/(\d+)\s*marks?/i);
  const classMatch = text.match(/class\s*(9|10|11|12)/i);
  const subject = lower.includes("physics")
    ? "Physics"
    : lower.includes("chemistry")
      ? "Chemistry"
      : lower.includes("biology")
        ? "Biology"
        : lower.includes("math")
          ? "Maths"
          : undefined;
  const board = lower.includes("icse") ? "ICSE" : lower.includes("cbse") ? "CBSE" : undefined;
  const durationMinutes = inferDurationMinutes(text);
  const formatting: Partial<DocumentStyle> = {
    margin: lower.includes("narrow margin") ? 36 : lower.includes("wide margin") ? 76 : defaultDocumentStyle.margin,
    lineHeight: lower.includes("double spacing") ? 2 : lower.includes("single spacing") ? 1.2 : defaultDocumentStyle.lineHeight,
    fontSize: Number(text.match(/font\s*size\s*:?\s*(\d+)/i)?.[1] ?? defaultDocumentStyle.fontSize),
  };
  const inferredParams: Partial<PaperRequest> = {};

  if (board) inferredParams.board = board;
  if (classMatch?.[1]) inferredParams.classLevel = classMatch[1] as PaperRequest["classLevel"];
  if (subject) inferredParams.subject = subject;
  if (marksMatch?.[1]) inferredParams.totalMarks = Number(marksMatch[1]);
  if (durationMinutes) inferredParams.durationMinutes = durationMinutes;

  return {
    name,
    description: "Uploaded text template",
    instructions: text.slice(0, 2000),
    sections: Array.from(text.matchAll(/section\s+[a-e][^\n]*/gi)).map((match) => match[0]),
    inferredParams,
    formatting,
    layoutNotes: inferLayoutNotes(text),
    markingSchemePosition: lower.includes("marking scheme at end") || lower.includes("marking scheme to the end") ? "end" : undefined,
  };
}

function parseJsonTemplate(name: string, text: string): PaperTemplate | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const formatting = asRecord(raw.formatting);
    const inferred = asRecord(raw.inferredParams ?? raw.inferred_params);

    return {
      name: String(raw.name ?? name),
      description: raw.description ? String(raw.description) : undefined,
      instructions: raw.instructions ? String(raw.instructions) : undefined,
      sections: Array.isArray(raw.sections) ? raw.sections.map(String) : undefined,
      inferredParams: normalizeTemplateParams(inferred),
      layoutNotes: stringOrUndefined(raw.layoutNotes ?? raw.layout_notes),
      imageNotes: stringOrUndefined(raw.imageNotes ?? raw.image_notes),
      markingSchemePosition: normalizePosition(raw.markingSchemePosition ?? raw.marking_scheme_position, ["start", "end"]),
      answerKeyPosition: normalizePosition(raw.answerKeyPosition ?? raw.answer_key_position, ["inline", "end", "separate"]),
      formatting: {
        margin: numberOrUndefined(formatting.margin),
        lineHeight: numberOrUndefined(formatting.lineHeight ?? formatting.line_height),
        fontSize: numberOrUndefined(formatting.fontSize ?? formatting.font_size),
        textColor: stringOrUndefined(formatting.textColor ?? formatting.text_color),
        accentColor: stringOrUndefined(formatting.accentColor ?? formatting.accent_color),
        pageColor: stringOrUndefined(formatting.pageColor ?? formatting.page_color),
      },
    };
  } catch {
    return null;
  }
}

function normalizeTemplateParams(raw: Record<string, unknown>): Partial<PaperRequest> {
  const params: Partial<PaperRequest> = {};
  const board = raw.board;
  const classLevel = raw.classLevel ?? raw.class_level;
  const subject = raw.subject;
  const totalMarks = raw.totalMarks ?? raw.total_marks;
  const durationMinutes = raw.durationMinutes ?? raw.duration_minutes;

  if (board === "CBSE" || board === "ICSE") params.board = board;
  if (["9", "10", "11", "12"].includes(String(classLevel))) params.classLevel = String(classLevel) as PaperRequest["classLevel"];
  if (["Maths", "Physics", "Chemistry", "Biology"].includes(String(subject))) params.subject = String(subject) as PaperRequest["subject"];
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

  return recalculatePaper({
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
            questions: Array.isArray(sectionRecord.questions) ? sectionRecord.questions.map((question) => normalizeQuestion(asRecord(question))) : [],
          };
        })
      : [],
    documentStyle: asRecord(payload.documentStyle ?? payload.document_style),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
  });
}

function normalizeQuestion(record: Record<string, unknown>): PaperQuestion {
  const optionalChoice = asRecord(record.optionalChoice ?? record.optional_choice);
  const sourceCitations = record.sourceCitations ?? record.source_citations;

  return {
    id: String(record.id ?? crypto.randomUUID()),
    text: String(record.text ?? ""),
    richText: String(record.richText ?? record.rich_text ?? ""),
    marks: Number(record.marks ?? 0),
    type: String(record.type ?? record.question_type ?? ""),
    difficulty: String(record.difficulty ?? ""),
    source: String(record.source ?? ""),
    topic: stringOrUndefined(record.topic),
    tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
    sourceCitations: Array.isArray(sourceCitations) ? sourceCitations.map(String) : undefined,
    optionalChoice:
      optionalChoice.text || optionalChoice.richText || optionalChoice.rich_text
        ? {
            id: stringOrUndefined(optionalChoice.id),
            text: String(optionalChoice.text ?? ""),
            richText: String(optionalChoice.richText ?? optionalChoice.rich_text ?? ""),
            marks: optionalChoice.marks ? Number(optionalChoice.marks) : undefined,
            type: stringOrUndefined(optionalChoice.type ?? optionalChoice.question_type),
            difficulty: stringOrUndefined(optionalChoice.difficulty),
            source: stringOrUndefined(optionalChoice.source),
            topic: stringOrUndefined(optionalChoice.topic),
            tags: Array.isArray(optionalChoice.tags) ? optionalChoice.tags.map(String) : undefined,
            answer: stringOrUndefined(optionalChoice.answer),
            answerRichText: stringOrUndefined(optionalChoice.answerRichText ?? optionalChoice.answer_rich_text),
          }
        : undefined,
    answer: String(record.answer ?? ""),
    answerRichText: String(record.answerRichText ?? record.answer_rich_text ?? ""),
  };
}

function inferLayoutNotes(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join("\n")
    .slice(0, 3000);
}

function inferDurationMinutes(text: string) {
  const hourMatch = text.match(/(?:time allowed|time|duration)\s*:?\s*(\d+(?:\.\d+)?)\s*hours?/i);
  if (hourMatch?.[1]) return Math.round(Number(hourMatch[1]) * 60);
  const minuteMatch = text.match(/(?:time allowed|time|duration)\s*:?\s*(\d+)\s*minutes?/i);
  return minuteMatch?.[1] ? Number(minuteMatch[1]) : undefined;
}

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"} ${remainder} minutes` : `${minutes} minutes`;
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

function normalizePosition<T extends string>(value: unknown, allowed: T[]): T | undefined {
  return allowed.includes(String(value) as T) ? (String(value) as T) : undefined;
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
