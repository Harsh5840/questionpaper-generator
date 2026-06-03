"use client";

import type React from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpFromLine,
  Bold,
  Copy,
  FilePlus2,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  LogIn,
  LogOut,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Shapes,
  Sigma,
  Trash2,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import katex from "katex";
import { DocumentStyle, Paper, PaperImageAsset, PaperQuestion, PaperQuestionOption, PaperSection, PaperSubpart } from "@/lib/types";
import { normalizePaperStructure } from "@/lib/normalize-paper-structure";
import { RichTextEditor } from "./rich-text-editor";

interface PaperEditorProps {
  paper: Paper | null;
  documentStyle: DocumentStyle;
  isGenerating?: boolean;
  onPaperChange: (paper: Paper) => void;
  onDocumentStyleChange?: (style: DocumentStyle) => void;
  onReplaceQuestion: (sectionId: string, questionId: string, questionNumber: number, instruction?: string) => Promise<void> | void;
  onReplaceOptionalChoice: (sectionId: string, questionId: string, questionNumber: number, instruction?: string) => Promise<void> | void;
  onSaveQuestionToBank: (question: PaperQuestion) => void;
  onImportImage: (sectionId: string) => void;
  onUploadImage?: (file: File) => Promise<PaperImageAsset>;
  onTextEditorFocus?: () => void;
}

interface DraggedQuestion {
  sectionId: string;
  questionId: string;
}

interface DraggedDiagram {
  sectionId: string;
  questionId: string;
  diagramId: string;
  subpartId?: string;
}

export function PaperEditor({
  paper,
  documentStyle,
  isGenerating = false,
  onPaperChange,
  onDocumentStyleChange,
  onReplaceQuestion,
  onReplaceOptionalChoice,
  onSaveQuestionToBank,
  onImportImage,
  onUploadImage,
  onTextEditorFocus,
}: PaperEditorProps) {
  const [draggedQuestion, setDraggedQuestion] = useState<DraggedQuestion | null>(null);
  const [draggedDiagram, setDraggedDiagram] = useState<DraggedDiagram | null>(null);
  const [expandedAnswers, setExpandedAnswers] = useState<Record<string, boolean>>({});
  const [replacingQuestions, setReplacingQuestions] = useState<Record<string, boolean>>({});
  const [replacingChoices, setReplacingChoices] = useState<Record<string, boolean>>({});
  const [replacePrompt, setReplacePrompt] = useState<{
    sectionId: string;
    questionId: string;
    questionNumber: number;
    mode: "question" | "choice";
    text: string;
  } | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [previousPaper, setPreviousPaper] = useState<Paper | null>(null);
  const [marksWarning, setMarksWarning] = useState<string | null>(null);
  const marksWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    questionId?: string; sectionId?: string;
    inMathField?: boolean; latex?: string;
  } | null>(null);

  const stats = useMemo(() => (paper ? calculateStats(paper) : null), [paper]);
  const sourceMix = useMemo(() => (paper ? calculateSourceMix(paper) : null), [paper]);

  useEffect(() => {
    const clearActiveQuestion = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".question-row")) return;
      if (target.closest(".math-live-panel")) return;

      setActiveQuestionId(null);
    };

    document.addEventListener("pointerdown", clearActiveQuestion);
    return () => document.removeEventListener("pointerdown", clearActiveQuestion);
  }, []);

  useEffect(() => {
    const handleMathContextMenu = (event: Event) => {
      const custom = event as CustomEvent<{ x: number; y: number; latex: string }>;
      const questionRow = (event.target as Element | null)?.closest<HTMLElement>(".question-row");
      setContextMenu({
        x: custom.detail.x,
        y: custom.detail.y,
        questionId: questionRow?.id?.replace("question-", ""),
        inMathField: true,
        latex: custom.detail.latex,
      });
    };
    document.addEventListener("qpg:math-contextmenu", handleMathContextMenu);
    return () => document.removeEventListener("qpg:math-contextmenu", handleMathContextMenu);
  }, []);

  if (!paper) {
    return (
      <div
        className="relative mx-auto flex min-h-[1120px] w-full max-w-[900px] items-center justify-center border border-slate-200 bg-white p-12 text-center shadow-sm"
        style={{ backgroundColor: documentStyle.pageColor }}
      >
        <div className="max-w-sm text-slate-400">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            {isGenerating ? <RefreshCcw className="animate-spin" size={24} /> : <Plus size={24} />}
          </div>
          <p className="text-sm font-bold text-slate-500">{isGenerating ? "Generating structured paper" : "Blank paper workspace"}</p>
          <p className="mt-1 text-xs">Generate a paper or import questions. Cards with marks, drag handles, and rich text controls will appear here.</p>
        </div>
      </div>
    );
  }

  const updatePaper = (updater: (current: Paper) => Paper) => {
    onPaperChange(recalculatePaper(normalizePaperStructure(updater(paper))));
  };

  const triggerMarksWarning = useCallback((message: string) => {
    setMarksWarning(message);
    if (marksWarningTimer.current) clearTimeout(marksWarningTimer.current);
    marksWarningTimer.current = setTimeout(() => setMarksWarning(null), 3500);
  }, []);

  const updateDocumentStyle = (patch: Partial<DocumentStyle>) => {
    onDocumentStyleChange?.({ ...documentStyle, ...patch });
  };

  const updateSection = (sectionId: string, patch: Partial<PaperSection>) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    }));
  };

  const updateQuestion = (sectionId: string, questionId: string, patch: Partial<PaperQuestion>) => {
    if ("marks" in patch) {
      const section = paper.sections.find((s) => s.id === sectionId);
      if (section?.targetMarks) {
        const newTotal = section.questions.reduce(
          (t, q) => t + (q.id === questionId ? Number(patch.marks ?? 0) : countedQuestionMarks(q)),
          0,
        );
        if (newTotal !== section.targetMarks) {
          triggerMarksWarning(`Section total: ${newTotal}m — target: ${section.targetMarks}m`);
        }
      }
    }
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) => (question.id === questionId ? { ...question, ...patch } : question)),
            }
          : section,
      ),
    }));
  };

  const emptyOption = (index: number): PaperQuestionOption => ({
    id: crypto.randomUUID(),
    label: String.fromCharCode(65 + index),
    text: "",
    richText: "",
    isCorrect: false,
  });

  const relabelOptions = (options: PaperQuestionOption[]) => options.map((option, index) => ({ ...option, label: String.fromCharCode(65 + index) }));

  const ensureMcqOptions = (options: PaperQuestionOption[] | undefined, minimum = 4) => {
    const current = options ?? [];
    const missing = Math.max(minimum - current.length, 0);
    return relabelOptions([...current, ...Array.from({ length: missing }, (_item, index) => emptyOption(current.length + index))]);
  };

  const updateQuestionOption = (
    sectionId: string,
    questionId: string,
    optionIndex: number,
    patch: Partial<NonNullable<PaperQuestion["options"]>[number]>,
  ) => {
    const section = paper.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);
    const options = question?.options ?? [];

    updateQuestion(sectionId, questionId, {
      options: options.map((option, index) => (index === optionIndex ? { ...option, ...patch } : option)),
    });
  };

  const deleteQuestionOption = (sectionId: string, questionId: string, optionIndex: number) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.options ?? [];
    updateQuestion(sectionId, questionId, {
      options: options.filter((_option, index) => index !== optionIndex).map((option, index) => ({ ...option, label: option.label || String.fromCharCode(65 + index) })),
    });
  };

  const duplicateQuestionOption = (sectionId: string, questionId: string, optionIndex: number) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.options ?? [];
    const option = options[optionIndex];
    if (!option) return;

    updateQuestion(sectionId, questionId, {
      options: [
        ...options.slice(0, optionIndex + 1),
        { ...option, id: crypto.randomUUID(), label: String.fromCharCode(65 + optionIndex + 1) },
        ...options.slice(optionIndex + 1),
      ].map((item, index) => ({ ...item, label: item.label && /^[([]?[ivx]+[)]?$/i.test(item.label) ? item.label : String.fromCharCode(65 + index) })),
    });
  };

  const addQuestionOption = (sectionId: string, questionId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.options ?? [];

    updateQuestion(sectionId, questionId, {
      type: "MCQ",
      options: relabelOptions([...options, emptyOption(options.length)]),
    });
  };

  const deleteQuestion = (sectionId: string, questionId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, questions: section.questions.filter((question) => question.id !== questionId) } : section,
      ),
    }));
  };

  const duplicateQuestion = (sectionId: string, questionId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;

        const nextQuestions: PaperQuestion[] = [];
        section.questions.forEach((question) => {
          nextQuestions.push(question);
          if (question.id === questionId) {
            nextQuestions.push({ ...question, id: crypto.randomUUID(), text: `${question.text}\n`, richText: question.richText });
          }
        });

        return { ...section, questions: nextQuestions };
      }),
    }));
  };

  const duplicateOptionalChoiceAsQuestion = (sectionId: string, questionId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;

        const nextQuestions: PaperQuestion[] = [];
        section.questions.forEach((question) => {
          nextQuestions.push(question);

          if (question.id === questionId && question.optionalChoice) {
            nextQuestions.push(choiceToQuestion(question));
          }
        });

        return { ...section, questions: nextQuestions };
      }),
    }));
  };

  const addBlankQuestion = (sectionId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: [
                ...section.questions,
                {
                  id: crypto.randomUUID(),
                  text: "",
                  richText: "",
                  marks: 1,
                  type: "SA",
                  difficulty: section.difficulty || current.summary.difficulty || "Medium",
                  source: "Manual",
                  topic: current.metadata.topic,
                  answer: "",
                },
              ],
            }
          : section,
      ),
    }));
  };

  const addMcqQuestion = (sectionId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: [
                ...section.questions,
                {
                  id: crypto.randomUUID(),
                  text: "",
                  richText: "",
                  marks: 1,
                  type: "MCQ",
                  difficulty: section.difficulty || current.summary.difficulty || "Medium",
                  source: "Manual",
                  topic: current.metadata.topic,
                  answer: "",
                  options: ["A", "B", "C", "D"].map((label) => ({
                    id: crypto.randomUUID(),
                    label,
                    text: "",
                    richText: "",
                    isCorrect: false,
                  })),
                },
              ],
            }
          : section,
      ),
    }));
  };

  const addSection = () => {
    updatePaper((current) => ({
      ...current,
      sections: [
        ...current.sections,
        {
          id: crypto.randomUUID(),
          title: `Section ${String.fromCharCode(65 + current.sections.length)}`,
          instructions: "Answer all questions in this section.",
          difficulty: "Mixed",
          targetMarks: 0,
          attemptRule: undefined,
          questions: [],
        },
      ],
    }));
  };

  const updateSectionAttemptRule = (sectionId: string, field: "required" | "offered", value: number) => {
    const section = paper.sections.find((item) => item.id === sectionId);
    const current = section?.attemptRule ?? { required: section?.questions.length || 1, offered: section?.questions.length || 1 };
    const next = {
      ...current,
      [field]: Math.max(1, Math.floor(value || 1)),
    };

    updateSection(sectionId, {
      attemptRule: next.required >= next.offered ? undefined : { required: Math.min(next.required, next.offered), offered: next.offered },
    });
  };

  const addDiagramPlaceholder = (sectionId: string, questionId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    updateQuestion(sectionId, questionId, {
      diagramBlocks: [
        ...(question?.diagramBlocks ?? []),
        {
          id: crypto.randomUUID(),
          title: "Diagram placeholder",
          caption: "Upload or generate a diagram later.",
          status: "placeholder",
        },
      ],
    });
  };

  const addSubpartDiagramPlaceholder = (sectionId: string, questionId: string, subpartId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const subpart = question?.subparts?.find((item) => item.id === subpartId);

    updateSubpart(sectionId, questionId, subpartId, {
      diagramBlocks: [
        ...(subpart?.diagramBlocks ?? []),
        {
          id: crypto.randomUUID(),
          title: `Diagram for part (${subpart?.label ?? ""})`,
          caption: "Upload or generate a diagram later.",
          status: "placeholder",
        },
      ],
    });
  };

  const moveDraggedDiagramToQuestion = (targetSectionId: string, targetQuestionId: string) => {
    if (!draggedDiagram) return;

    updatePaper((current) => moveDiagram(current, draggedDiagram, { sectionId: targetSectionId, questionId: targetQuestionId }));
    setDraggedDiagram(null);
  };

  const moveDraggedDiagramToSubpart = (targetSectionId: string, targetQuestionId: string, targetSubpartId: string) => {
    if (!draggedDiagram) return;

    updatePaper((current) => moveDiagram(current, draggedDiagram, { sectionId: targetSectionId, questionId: targetQuestionId, subpartId: targetSubpartId }));
    setDraggedDiagram(null);
  };

  const deleteQuestionDiagram = (sectionId: string, questionId: string, diagramId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    updateQuestion(sectionId, questionId, {
      diagramBlocks: (question?.diagramBlocks ?? []).filter((diagram) => diagram.id !== diagramId),
    });
  };

  const deleteSubpartDiagram = (sectionId: string, questionId: string, subpartId: string, diagramId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const subpart = question?.subparts?.find((item) => item.id === subpartId);
    updateSubpart(sectionId, questionId, subpartId, {
      diagramBlocks: (subpart?.diagramBlocks ?? []).filter((diagram) => diagram.id !== diagramId),
    });
  };

  const uploadAsset = async (file: File) => {
    if (!onUploadImage) return null;
    return onUploadImage(file);
  };

  const attachQuestionImage = async (sectionId: string, questionId: string, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId ? { ...question, imageAssets: [...(question.imageAssets ?? []), asset] } : question,
              ),
            }
          : section,
      ),
    }));
  };

  const attachQuestionOptionImage = async (sectionId: string, questionId: string, optionIndex: number, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId
                  ? {
                      ...question,
                      options: (question.options ?? []).map((option, index) =>
                        index === optionIndex ? { ...option, imageAssets: [...(option.imageAssets ?? []), asset] } : option,
                      ),
                    }
                  : question,
              ),
            }
          : section,
      ),
    }));
  };

  const attachSubpartImage = async (sectionId: string, questionId: string, subpartId: string, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId
                  ? {
                      ...question,
                      subparts: (question.subparts ?? []).map((subpart) =>
                        subpart.id === subpartId ? { ...subpart, imageAssets: [...(subpart.imageAssets ?? []), asset] } : subpart,
                      ),
                    }
                  : question,
              ),
            }
          : section,
      ),
    }));
  };

  const attachQuestionChoiceImage = async (sectionId: string, questionId: string, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId && question.optionalChoice
                  ? {
                      ...question,
                      optionalChoice: {
                        ...question.optionalChoice,
                        imageAssets: [...(question.optionalChoice.imageAssets ?? []), asset],
                      },
                    }
                  : question,
              ),
            }
          : section,
      ),
    }));
  };

  const attachSubpartChoiceImage = async (sectionId: string, questionId: string, subpartId: string, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId
                  ? {
                      ...question,
                      subparts: (question.subparts ?? []).map((subpart) =>
                        subpart.id === subpartId && subpart.optionalChoice
                          ? {
                              ...subpart,
                              optionalChoice: {
                                ...subpart.optionalChoice,
                                imageAssets: [...(subpart.optionalChoice.imageAssets ?? []), asset],
                              },
                            }
                          : subpart,
                      ),
                    }
                  : question,
              ),
            }
          : section,
      ),
    }));
  };

  const removeQuestionImage = (sectionId: string, questionId: string, assetId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    updateQuestion(sectionId, questionId, { imageAssets: (question?.imageAssets ?? []).filter((asset) => asset.id !== assetId) });
  };

  const removeOptionImage = (sectionId: string, questionId: string, optionIndex: number, assetId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    updateQuestion(sectionId, questionId, {
      options: (question?.options ?? []).map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: (option.imageAssets ?? []).filter((asset) => asset.id !== assetId) } : option,
      ),
    });
  };

  const removeSubpartImage = (sectionId: string, questionId: string, subpartId: string, assetId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    updateSubpart(sectionId, questionId, subpartId, {
      imageAssets: (question?.subparts?.find((item) => item.id === subpartId)?.imageAssets ?? []).filter((asset) => asset.id !== assetId),
    });
  };

  const attachSubpartOptionImage = async (sectionId: string, questionId: string, subpartId: string, optionIndex: number, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.options ?? [];

    updateSubpart(sectionId, questionId, subpartId, {
      options: options.map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: [...(option.imageAssets ?? []), asset] } : option,
      ),
    });
  };

  const removeSubpartOptionImage = (sectionId: string, questionId: string, subpartId: string, optionIndex: number, assetId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.options ?? [];

    updateSubpart(sectionId, questionId, subpartId, {
      options: options.map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: (option.imageAssets ?? []).filter((asset) => asset.id !== assetId) } : option,
      ),
    });
  };

  const removeQuestionChoiceImage = (sectionId: string, questionId: string, assetId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    if (!question?.optionalChoice) return;

    updateInternalChoice(sectionId, questionId, {
      imageAssets: (question.optionalChoice.imageAssets ?? []).filter((asset) => asset.id !== assetId),
    });
  };

  const removeSubpartChoiceImage = (sectionId: string, questionId: string, subpartId: string, assetId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    if (!subpart?.optionalChoice) return;

    updateSubpartChoice(sectionId, questionId, subpartId, {
      imageAssets: (subpart.optionalChoice.imageAssets ?? []).filter((asset) => asset.id !== assetId),
    });
  };

  const attachSubpartChoiceOptionImage = async (sectionId: string, questionId: string, subpartId: string, optionIndex: number, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.optionalChoice?.options ?? [];

    updateSubpartChoice(sectionId, questionId, subpartId, {
      options: options.map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: [...(option.imageAssets ?? []), asset] } : option,
      ),
    });
  };

  const removeSubpartChoiceOptionImage = (sectionId: string, questionId: string, subpartId: string, optionIndex: number, assetId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.optionalChoice?.options ?? [];

    updateSubpartChoice(sectionId, questionId, subpartId, {
      options: options.map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: (option.imageAssets ?? []).filter((asset) => asset.id !== assetId) } : option,
      ),
    });
  };

  const addInternalChoice = (sectionId: string, questionId: string) => {
    const section = paper.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);

    updateQuestion(sectionId, questionId, {
      optionalChoice: blankQuestionChoice(question),
    });
  };

  const updateInternalChoice = (sectionId: string, questionId: string, patch: Partial<PaperQuestion>) => {
    const section = paper.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);
    if (!question?.optionalChoice) return;

    updateQuestion(sectionId, questionId, {
      optionalChoice: { ...question.optionalChoice, ...patch },
    });
  };

  const updateInternalChoiceOption = (
    sectionId: string,
    questionId: string,
    optionIndex: number,
    patch: Partial<NonNullable<PaperQuestion["options"]>[number]>,
  ) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.optionalChoice?.options ?? [];

    updateInternalChoice(sectionId, questionId, {
      options: options.map((option, index) => (index === optionIndex ? { ...option, ...patch } : option)),
    });
  };

  const attachInternalChoiceOptionImage = async (sectionId: string, questionId: string, optionIndex: number, file: File) => {
    const asset = await uploadAsset(file);
    if (!asset) return;

    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.optionalChoice?.options ?? [];

    updateInternalChoice(sectionId, questionId, {
      options: options.map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: [...(option.imageAssets ?? []), asset] } : option,
      ),
    });
  };

  const removeInternalChoiceOptionImage = (sectionId: string, questionId: string, optionIndex: number, assetId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.optionalChoice?.options ?? [];

    updateInternalChoice(sectionId, questionId, {
      options: options.map((option, index) =>
        index === optionIndex ? { ...option, imageAssets: (option.imageAssets ?? []).filter((asset) => asset.id !== assetId) } : option,
      ),
    });
  };

  const addInternalChoiceOption = (sectionId: string, questionId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.optionalChoice?.options ?? [];

    updateInternalChoice(sectionId, questionId, {
      type: "MCQ",
      options: relabelOptions([...options, emptyOption(options.length)]),
    });
  };

  const createInternalChoiceMcq = (sectionId: string, questionId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);

    updateInternalChoice(sectionId, questionId, {
      type: "MCQ",
      options: ensureMcqOptions(question?.optionalChoice?.options, 4),
    });
  };

  const duplicateInternalChoiceOption = (sectionId: string, questionId: string, optionIndex: number) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.optionalChoice?.options ?? [];
    const option = options[optionIndex];
    if (!option) return;

    updateInternalChoice(sectionId, questionId, {
      options: relabelOptions([...options.slice(0, optionIndex + 1), { ...option, id: crypto.randomUUID() }, ...options.slice(optionIndex + 1)]),
    });
  };

  const deleteInternalChoiceOption = (sectionId: string, questionId: string, optionIndex: number) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const options = question?.optionalChoice?.options ?? [];

    updateInternalChoice(sectionId, questionId, {
      options: relabelOptions(options.filter((_option, index) => index !== optionIndex)),
    });
  };

  const removeInternalChoice = (sectionId: string, questionId: string) => {
    updateQuestion(sectionId, questionId, { optionalChoice: undefined });
  };

  const addSubpart = (sectionId: string, questionId: string) => {
    const section = paper.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);
    const subparts = question?.subparts ?? [];

    updateQuestion(sectionId, questionId, {
      subparts: [
        ...subparts,
        {
          id: crypto.randomUUID(),
          label: nextSubpartLabel(subparts),
          text: "",
          richText: "",
          marks: 1,
          answer: "",
        },
      ],
    });
  };

  const updateSubpart = (sectionId: string, questionId: string, subpartId: string, patch: Partial<PaperSubpart>) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    if (!question?.subparts) return;

    updateQuestion(sectionId, questionId, {
      subparts: question.subparts.map((subpart) => (subpart.id === subpartId ? { ...subpart, ...patch } : subpart)),
    });
  };

  const updateSubpartOption = (
    sectionId: string,
    questionId: string,
    subpartId: string,
    optionIndex: number,
    patch: Partial<PaperQuestionOption>,
  ) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.options ?? [];

    updateSubpart(sectionId, questionId, subpartId, {
      options: options.map((option, index) => (index === optionIndex ? { ...option, ...patch } : option)),
    });
  };

  const addSubpartOption = (sectionId: string, questionId: string, subpartId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.options ?? [];

    updateSubpart(sectionId, questionId, subpartId, {
      options: relabelOptions([...options, emptyOption(options.length)]),
    });
  };

  const createSubpartMcq = (sectionId: string, questionId: string, subpartId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);

    updateSubpart(sectionId, questionId, subpartId, {
      options: ensureMcqOptions(subpart?.options, 4),
    });
  };

  const duplicateSubpartOption = (sectionId: string, questionId: string, subpartId: string, optionIndex: number) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.options ?? [];
    const option = options[optionIndex];
    if (!option) return;

    updateSubpart(sectionId, questionId, subpartId, {
      options: relabelOptions([...options.slice(0, optionIndex + 1), { ...option, id: crypto.randomUUID() }, ...options.slice(optionIndex + 1)]),
    });
  };

  const deleteSubpartOption = (sectionId: string, questionId: string, subpartId: string, optionIndex: number) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.options ?? [];

    updateSubpart(sectionId, questionId, subpartId, {
      options: relabelOptions(options.filter((_option, index) => index !== optionIndex)),
    });
  };

  const deleteSubpart = (sectionId: string, questionId: string, subpartId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    if (!question?.subparts) return;

    updateQuestion(sectionId, questionId, {
      subparts: question.subparts
        .filter((subpart) => subpart.id !== subpartId)
        .map((subpart, index) => ({ ...subpart, label: String.fromCharCode(97 + index) })),
    });
  };

  const duplicateSubpart = (sectionId: string, questionId: string, subpartId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    if (!question?.subparts) return;
    const sourceIndex = question.subparts.findIndex((subpart) => subpart.id === subpartId);
    const source = question.subparts[sourceIndex];
    if (!source) return;

    updateQuestion(sectionId, questionId, {
      subparts: [
        ...question.subparts.slice(0, sourceIndex + 1),
        { ...source, id: crypto.randomUUID(), optionalChoice: source.optionalChoice ? { ...source.optionalChoice, id: crypto.randomUUID() } : undefined },
        ...question.subparts.slice(sourceIndex + 1),
      ].map((subpart, index) => ({ ...subpart, label: String.fromCharCode(97 + index) })),
    });
  };

  const moveSubpartToChoice = (sectionId: string, questionId: string, sourceSubpartId: string, targetSubpartId: string) => {
    if (sourceSubpartId === targetSubpartId) return;
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    if (!question?.subparts) return;
    const source = question.subparts.find((subpart) => subpart.id === sourceSubpartId);
    if (!source) return;

    updateQuestion(sectionId, questionId, {
      subparts: question.subparts
        .filter((subpart) => subpart.id !== sourceSubpartId)
        .map((subpart) =>
          subpart.id === targetSubpartId
            ? {
                ...subpart,
                optionalChoice: {
                  id: crypto.randomUUID(),
                  text: source.text,
                  richText: source.richText,
                  options: source.options?.map((option) => ({ ...option, id: crypto.randomUUID() })),
                  imageAssets: source.imageAssets?.map((asset) => ({ ...asset })),
                  marks: source.marks,
                  type: source.options && source.options.length > 0 ? "MCQ" : undefined,
                  answer: source.answer,
                  answerRichText: source.answerRichText,
                },
              }
            : subpart,
        )
        .map((subpart, index) => ({ ...subpart, label: String.fromCharCode(97 + index) })),
    });
  };

  const moveSubpartToOtherQuestionChoice = (
    sectionId: string,
    sourceQuestionId: string,
    sourceSubpartId: string,
    targetQuestionId: string,
    targetSubpartId: string,
  ) => {
    if (sourceQuestionId === targetQuestionId) {
      moveSubpartToChoice(sectionId, sourceQuestionId, sourceSubpartId, targetSubpartId);
      return;
    }
    const sourceQuestion = paper.sections.find((s) => s.id === sectionId)?.questions.find((q) => q.id === sourceQuestionId);
    const source = sourceQuestion?.subparts?.find((sp) => sp.id === sourceSubpartId);
    if (!source) return;

    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        return {
          ...section,
          questions: section.questions.map((question) => {
            if (question.id === sourceQuestionId) {
              return {
                ...question,
                subparts: (question.subparts ?? [])
                  .filter((sp) => sp.id !== sourceSubpartId)
                  .map((sp, i) => ({ ...sp, label: String.fromCharCode(97 + i) })),
              };
            }
            if (question.id === targetQuestionId) {
              return {
                ...question,
                subparts: (question.subparts ?? []).map((sp) =>
                  sp.id === targetSubpartId
                    ? {
                        ...sp,
                        optionalChoice: {
                          id: crypto.randomUUID(),
                          text: source.text,
                          richText: source.richText,
                          options: source.options?.map((o) => ({ ...o, id: crypto.randomUUID() })),
                          imageAssets: source.imageAssets?.map((a) => ({ ...a })),
                          marks: source.marks,
                          type: source.options && source.options.length > 0 ? "MCQ" : undefined,
                          answer: source.answer,
                          answerRichText: source.answerRichText,
                        },
                      }
                    : sp,
                ),
              };
            }
            return question;
          }),
        };
      }),
    }));
  };

  const addSubpartChoice = (sectionId: string, questionId: string, subpartId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const subpart = question?.subparts?.find((item) => item.id === subpartId);
    if (!subpart) return;

    updateSubpart(sectionId, questionId, subpartId, {
      optionalChoice: {
        id: crypto.randomUUID(),
        text: "",
        richText: "",
        marks: subpart.marks,
        answer: "",
        answerRichText: "",
      },
    });
  };

  const moveSubpartOrChoice = (sectionId: string, questionId: string, fromSubpartId: string, toSubpartId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id !== sectionId ? section : {
          ...section,
          questions: section.questions.map((question) => {
            if (question.id !== questionId) return question;
            const fromSp = question.subparts?.find((s) => s.id === fromSubpartId);
            if (!fromSp?.optionalChoice) return question;
            return {
              ...question,
              subparts: (question.subparts ?? []).map((sp) => {
                if (sp.id === fromSubpartId) return { ...sp, optionalChoice: undefined };
                if (sp.id === toSubpartId) return { ...sp, optionalChoice: fromSp.optionalChoice };
                return sp;
              }),
            };
          }),
        }
      ),
    }));
  };

  const updateSubpartChoice = (sectionId: string, questionId: string, subpartId: string, patch: Partial<NonNullable<PaperSubpart["optionalChoice"]>>) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const subpart = question?.subparts?.find((item) => item.id === subpartId);
    if (!subpart?.optionalChoice) return;

    updateSubpart(sectionId, questionId, subpartId, {
      optionalChoice: { ...subpart.optionalChoice, ...patch },
    });
  };

  const updateSubpartChoiceOption = (
    sectionId: string,
    questionId: string,
    subpartId: string,
    optionIndex: number,
    patch: Partial<PaperQuestionOption>,
  ) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.optionalChoice?.options ?? [];

    updateSubpartChoice(sectionId, questionId, subpartId, {
      options: options.map((option, index) => (index === optionIndex ? { ...option, ...patch } : option)),
    });
  };

  const addSubpartChoiceOption = (sectionId: string, questionId: string, subpartId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.optionalChoice?.options ?? [];

    updateSubpartChoice(sectionId, questionId, subpartId, {
      type: "MCQ",
      options: relabelOptions([...options, emptyOption(options.length)]),
    });
  };

  const createSubpartChoiceMcq = (sectionId: string, questionId: string, subpartId: string) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);

    updateSubpartChoice(sectionId, questionId, subpartId, {
      type: "MCQ",
      options: ensureMcqOptions(subpart?.optionalChoice?.options, 4),
    });
  };

  const duplicateSubpartChoiceOption = (sectionId: string, questionId: string, subpartId: string, optionIndex: number) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.optionalChoice?.options ?? [];
    const option = options[optionIndex];
    if (!option) return;

    updateSubpartChoice(sectionId, questionId, subpartId, {
      options: relabelOptions([...options.slice(0, optionIndex + 1), { ...option, id: crypto.randomUUID() }, ...options.slice(optionIndex + 1)]),
    });
  };

  const deleteSubpartChoiceOption = (sectionId: string, questionId: string, subpartId: string, optionIndex: number) => {
    const subpart = paper.sections
      .find((section) => section.id === sectionId)
      ?.questions.find((item) => item.id === questionId)
      ?.subparts?.find((item) => item.id === subpartId);
    const options = subpart?.optionalChoice?.options ?? [];

    updateSubpartChoice(sectionId, questionId, subpartId, {
      options: relabelOptions(options.filter((_option, index) => index !== optionIndex)),
    });
  };

  const removeSubpartChoice = (sectionId: string, questionId: string, subpartId: string) => {
    updateSubpart(sectionId, questionId, subpartId, { optionalChoice: undefined });
  };

  const moveQuestionToInternalChoice = (sourceSectionId: string, sourceQuestionId: string, targetQuestionId: string) => {
    if (sourceQuestionId === targetQuestionId) return;

    updatePaper((current) => {
      let movingQuestion: PaperQuestion | null = null;
      const targetAlreadyHasChoice = current.sections.some((section) =>
        section.questions.some((question) => question.id === targetQuestionId && choiceHasContent(question.optionalChoice)),
      );

      if (targetAlreadyHasChoice) return current;

      const sectionsWithoutSource = current.sections.map((section) => ({
        ...section,
        questions: section.questions.filter((question) => {
          if (section.id === sourceSectionId && question.id === sourceQuestionId) {
            movingQuestion = question;
            return false;
          }

          return true;
        }),
      }));

      if (!movingQuestion) return current;

      return {
        ...current,
        sections: sectionsWithoutSource.map((section) => ({
          ...section,
          questions: section.questions.map((question) =>
            question.id === targetQuestionId
              ? {
                  ...question,
                  optionalChoice: questionToChoice(movingQuestion as PaperQuestion),
                }
              : question,
          ),
        })),
      };
    });

    setActiveQuestionId(targetQuestionId);
  };

  const moveDraggedQuestion = (targetSectionId: string, targetQuestionId?: string) => {
    if (!draggedQuestion) return;

    updatePaper((current) => {
      let movingQuestion: PaperQuestion | null = null;
      const sectionsWithoutQuestion = current.sections.map((section) => {
        if (section.id !== draggedQuestion.sectionId) return section;

        return {
          ...section,
          questions: section.questions.filter((question) => {
            if (question.id === draggedQuestion.questionId) {
              movingQuestion = question;
              return false;
            }

            return true;
          }),
        };
      });

      if (!movingQuestion) return current;

      return {
        ...current,
        sections: sectionsWithoutQuestion.map((section) => {
          if (section.id !== targetSectionId) return section;

          if (!targetQuestionId) return { ...section, questions: [...section.questions, movingQuestion as PaperQuestion] };

          const targetIndex = section.questions.findIndex((question) => question.id === targetQuestionId);
          if (targetIndex < 0) return { ...section, questions: [...section.questions, movingQuestion as PaperQuestion] };

          return {
            ...section,
            questions: [
              ...section.questions.slice(0, targetIndex),
              movingQuestion as PaperQuestion,
              ...section.questions.slice(targetIndex),
            ],
          };
        }),
      };
    });

    setDraggedQuestion(null);
  };

  const promoteChoiceToQuestion = (sectionId: string, questionId: string) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const nextQuestions: PaperQuestion[] = [];
        section.questions.forEach((question) => {
          if (question.id === questionId && question.optionalChoice) {
            nextQuestions.push({ ...question, optionalChoice: undefined });
            nextQuestions.push({ ...choiceToQuestion(question), id: crypto.randomUUID() });
          } else {
            nextQuestions.push(question);
          }
        });
        return { ...section, questions: nextQuestions };
      }),
    }));
  };

  const replaceQuestion = async (sectionId: string, questionId: string, questionNumber: number, instruction?: string) => {
    setPreviousPaper(paper);
    setReplacingQuestions((current) => ({ ...current, [questionId]: true }));

    try {
      await onReplaceQuestion(sectionId, questionId, questionNumber, instruction);
    } finally {
      setReplacingQuestions((current) => ({ ...current, [questionId]: false }));
    }
  };

  const replaceInternalChoice = async (sectionId: string, questionId: string, questionNumber: number, instruction?: string) => {
    setPreviousPaper(paper);
    setReplacingChoices((current) => ({ ...current, [questionId]: true }));

    try {
      await onReplaceOptionalChoice(sectionId, questionId, questionNumber, instruction);
    } finally {
      setReplacingChoices((current) => ({ ...current, [questionId]: false }));
    }
  };

  const focusQuestion = (questionId: string) => {
    setActiveQuestionId(questionId);
    onTextEditorFocus?.();
  };

  const templateName = paper.metadata.format || (paper.metadata.source?.toLowerCase().includes("pyq") ? "Full Syllabus" : "Default");
  const templateTone = templateToneFor(templateName);
  const questionTargets =
    stats &&
    paper.sections.flatMap((section) =>
      section.questions.map((question) => ({
        id: question.id,
        label: `Q${stats.questionNumberById[question.id] ?? "?"}`,
        hasChoice: choiceHasContent(question.optionalChoice),
      })),
    );
  const visualPageCount = Math.max(1, paper.pageCount ?? 1);

  return (
    <div
      className="mx-auto flex w-full max-w-[980px] flex-col gap-8"
      onContextMenu={(e) => {
        // Rich-text surfaces have their own Insert Symbol panel — don't also open the question menu
        if ((e.target as Element).closest(".rich-text-surface, .math-live-host")) return;
        e.preventDefault();
        const questionRow = (e.target as Element).closest<HTMLElement>(".question-row");
        setContextMenu({ x: e.clientX, y: e.clientY, questionId: questionRow?.id?.replace("question-", "") });
      }}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <div
        className={`paper-page relative mx-auto min-h-[1120px] w-full max-w-[900px] border bg-white shadow-sm ${templateTone.articleClass}`}
        style={{
          backgroundColor: documentStyle.pageColor,
          color: documentStyle.textColor,
          fontSize: documentStyle.fontSize,
          lineHeight: documentStyle.lineHeight,
          padding: documentStyle.margin,
          minHeight: visualPageCount * 1120,
        }}
      >
        <div className="absolute right-6 top-4 flex items-center gap-2">
          {previousPaper && (
            <button
              className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-blue-700 shadow-sm hover:bg-blue-100"
              title="Undo last AI edit"
              onClick={() => { onPaperChange(previousPaper); setPreviousPaper(null); }}
              type="button"
            >
              <RotateCcw size={11} />
              Undo AI
            </button>
          )}
          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Page 1 / {visualPageCount}
          </span>
        </div>
        {marksWarning && (
          <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 font-sans text-[11px] font-bold text-amber-800 shadow-md">
            <AlertTriangle size={12} />
            {marksWarning}
          </div>
        )}
        {Array.from({ length: visualPageCount }).map((_page, index) => (
          <div
            key={`page-marker-${index + 1}`}
            className="pointer-events-none absolute inset-x-0 z-0"
            style={{ top: index * 1120 }}
          >
            {index > 0 && (
              <div className="mx-[-1px] flex items-center gap-2 border-t border-slate-300/70">
                <span className="rounded-b bg-slate-100 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400 shadow-sm">
                  Page {index + 1}
                </span>
              </div>
            )}
            <div className="absolute right-6 top-[1092px] rounded bg-white/85 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400 shadow-sm">
              {index + 1} / {visualPageCount}
            </div>
          </div>
        ))}
        {documentStyle.watermark?.text && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 z-0 text-center font-display text-6xl font-black italic"
            style={{
              color: documentStyle.accentColor,
              opacity: documentStyle.watermark.opacity,
              transform: documentStyle.watermark.position === "diagonal" ? "rotate(-28deg)" : undefined,
            }}
          >
            {documentStyle.watermark.text}
          </div>
        )}
      <header className={`pb-5 text-center ${templateTone.headerClass}`}>
        <div className="mb-4 flex justify-between text-left text-xs font-bold text-slate-600">
          <span>Series: QPG/{paper.metadata.board || "CBSE"}</span>
          <span>Q.P. Code: {paper.metadata.qpCode || "30/S/1"}</span>
        </div>
        <div className={`mx-auto mb-3 inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] ${templateTone.badgeClass}`}>
          {templateName}
        </div>
        <input
          aria-label="Paper title"
          className="w-full bg-transparent text-center font-sans text-2xl font-black uppercase tracking-normal text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          value={paper.title}
          onChange={(event) => updatePaper((current) => ({ ...current, title: event.target.value }))}
        />
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-sm font-semibold text-slate-600">
          <span>{paper.metadata.board} Class {paper.metadata.classLevel}</span>
          <span>{paper.metadata.subject}</span>
          <span>Time: {formatDuration(paper.metadata.durationMinutes)}</span>
          <span>Max Marks: {stats?.totalMarks ?? paper.summary.totalMarks}</span>
        </div>
      </header>

      {stats && (
        <div className="my-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
            <span>Topic-wise weightage</span>
            <span>{stats.questionCount} questions · {stats.totalMarks} marks</span>
          </div>
          <div className="space-y-2">
            {stats.topicWeights.map((item) => (
              <div key={item.topic} className="grid grid-cols-[130px_1fr_48px] items-center gap-2 text-xs text-slate-600">
                <span className="truncate font-semibold">{item.topic}</span>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${item.percent}%` }} />
                </div>
                <span className="text-right font-bold">{item.marks}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sourceMix && (
        <div className="my-5 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-amber-950">
            <span>Source mix</span>
            <span>{sourceMix.total} questions tracked</span>
          </div>
          <div className="grid gap-2 text-xs text-amber-950 sm:grid-cols-5">
            <SourceMixPill label="NCERT direct" value={sourceMix.ncert} />
            <SourceMixPill label="PYQ direct" value={sourceMix.pyq} />
            <SourceMixPill label="Question bank" value={sourceMix.questionBank} />
            <SourceMixPill label="AI generated" value={sourceMix.aiGenerated} />
            <SourceMixPill label="Uncited" value={sourceMix.uncited} />
          </div>
        </div>
      )}

      <section className="my-6 text-sm text-slate-800">
        <h2 className="mb-2 font-sans text-sm font-black uppercase">General Instructions</h2>
        {templateTone.instructions.map((instruction) => (
          <p key={instruction}>
            {instruction
              .replace("{questionCount}", String(stats?.questionCount ?? paper.summary.questionCount))
              .replace("{sectionCount}", String(paper.sections.length))}
          </p>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2" onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}>
        <input
          aria-label="Watermark text"
          className="w-44 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
          placeholder="Watermark"
          value={documentStyle.watermark?.text ?? ""}
          onChange={(event) =>
            updateDocumentStyle({
              watermark: event.target.value.trim()
                ? {
                    text: event.target.value,
                    opacity: documentStyle.watermark?.opacity ?? 0.08,
                    position: documentStyle.watermark?.position ?? "diagonal",
                  }
                : undefined,
            })
          }
        />
        <button className="editor-mini-button" onClick={addSection} type="button">
          <FilePlus2 size={14} />
          Add section
        </button>
      </div>

      <div className="mt-8 space-y-8">
        {paper.sections.map((section, sectionIndex) => {
          const offeredMarks = section.questions.reduce((total, question) => total + countedQuestionMarks(question), 0);
          const sectionMarks = countedSectionMarks(section);
          const hasAttemptChoice =
            Boolean(section.attemptRule) &&
            Number(section.attemptRule?.required || 0) < section.questions.length;

          return (
            <Fragment key={section.id}>
            <section
              className="paper-section relative rounded-lg border border-transparent"
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => moveDraggedQuestion(section.id)}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
                <input
                  aria-label="Section title"
                  className="min-w-48 flex-1 bg-transparent font-sans text-sm font-black uppercase tracking-normal text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  value={section.title}
                  onChange={(event) => updateSection(section.id, { title: event.target.value })}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
                    Difficulty
                    <select
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      value={section.difficulty || ""}
                      onChange={(event) => updateSection(section.id, { difficulty: event.target.value || undefined })}
                    >
                      <option value="">Mixed</option>
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                    </select>
                  </label>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                    {sectionMarks} marks{hasAttemptChoice && offeredMarks !== sectionMarks ? ` counted · ${offeredMarks} offered` : ""}
                  </span>
                  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500" title="Require students to attempt fewer questions than offered">
                    <input
                      className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
                      type="checkbox"
                      checked={!!section.attemptRule && section.attemptRule.required < section.questions.length}
                      onChange={(event) => {
                        if (event.target.checked) {
                          const offered = section.questions.length;
                          const required = Math.max(1, offered - 1);
                          updateSection(section.id, { attemptRule: { required, offered } });
                        } else {
                          updateSection(section.id, { attemptRule: undefined });
                        }
                      }}
                    />
                    Do
                  </label>
                  {section.attemptRule && section.attemptRule.required < section.questions.length && (
                    <>
                      <input
                        className="w-12 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                        min={1}
                        max={section.questions.length - 1}
                        type="number"
                        value={section.attemptRule.required}
                        onChange={(event) => updateSectionAttemptRule(section.id, "required", Number(event.target.value))}
                      />
                      <span className="text-[11px] font-bold text-slate-500">
                        of {section.questions.length}
                      </span>
                      {new Set(section.questions.map((q) => q.marks)).size > 1 && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          <AlertTriangle size={10} />
                          marks vary
                        </span>
                      )}
                    </>
                  )}
                  {section.questions.length === 0 || !section.questions.every((q) => q.type === "MCQ") ? (
                    <button className="editor-mini-button" onClick={() => addBlankQuestion(section.id)} type="button">
                      <Plus size={14} />
                      {section.questions.length === 0 ? "Add Question" : (() => {
                        const counts: Record<string, number> = {};
                        section.questions.forEach((q) => { if (q.type && q.type !== "MCQ") counts[q.type] = (counts[q.type] ?? 0) + 1; });
                        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
                        return `Add ${top ?? "SA"}`;
                      })()}
                    </button>
                  ) : null}
                  <button className="editor-mini-button" onClick={() => addMcqQuestion(section.id)} type="button">
                    <Plus size={14} />
                    Add MCQ
                  </button>
                  <button className="editor-mini-button" onClick={() => onImportImage(section.id)} type="button">
                    <ImagePlus size={14} />
                    Image
                  </button>
                </div>
              </div>

              <textarea
                aria-label={`${section.title} instructions`}
                className="mb-4 min-h-10 w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-slate-600 outline-none hover:border-slate-200 focus:border-blue-400 focus:bg-white"
                placeholder="Section instructions"
                value={section.instructions}
                onChange={(event) => updateSection(section.id, { instructions: event.target.value })}
              />
              {hasAttemptChoice && (
                <p className="-mt-3 mb-3 px-2 font-sans text-[11px] font-bold text-slate-700">
                  Attempt any {section.attemptRule?.required} of {section.attemptRule?.offered} questions. Counted marks: {sectionMarks}.
                </p>
              )}

              <div className="space-y-1">
                {section.questions.map((question) => {
                  const questionNumber = stats?.questionNumberById[question.id] ?? 0;
                  const isAnswerOpen = expandedAnswers[question.id] ?? false;
                  const isReplacing = replacingQuestions[question.id] ?? false;
                  const isChoiceReplacing = replacingChoices[question.id] ?? false;
                  const isActiveQuestion = activeQuestionId === question.id;

                  return (
                    <div
                      key={question.id}
                      id={`question-${question.id}`}
                      className={`question-row group relative rounded-lg border transition ${
                        isActiveQuestion ? "is-active border-amber-300 bg-amber-50/35 p-2 shadow-sm" : "border-transparent bg-transparent px-0 py-0.5"
                      } ${isReplacing ? "ai-replacing border-blue-300 bg-blue-50/70" : ""}`}
                      draggable
                      onClick={() => setActiveQuestionId(question.id)}
                      onDragStart={() => setDraggedQuestion({ sectionId: section.id, questionId: question.id })}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.stopPropagation();
                        moveDraggedQuestion(section.id, question.id);
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                          <div className="flex items-center gap-0.5">
                            <GripVertical className={isActiveQuestion ? "cursor-grab text-slate-400" : "cursor-grab text-slate-200 opacity-0 group-hover:opacity-100"} size={11} />
                            <span className="font-sans text-[11px] font-black text-slate-950 leading-none">{questionNumber}.</span>
                          </div>
                          {!isActiveQuestion && (
                            <span className="font-mono text-[9px] font-bold text-slate-400 leading-none">{question.marks}m</span>
                          )}
                        </div>

                        <div className={`min-w-0 flex-1 ${isActiveQuestion ? "space-y-2" : "space-y-0.5"}`}>
                          <RichTextEditor
                            label={`Question ${questionNumber}`}
                            minHeight="normal"
                            placeholder="Write the question..."
                            value={question.text}
                            htmlValue={question.richText}
                            onFocus={() => focusQuestion(question.id)}
                            onChange={(text) => updateQuestion(section.id, question.id, { text })}
                            onHtmlChange={(richText) => updateQuestion(section.id, question.id, { richText })}
                          />

                          <ImageAssetList
                            assets={question.imageAssets}
                            compact={!isActiveQuestion}
                            readOnly={!isActiveQuestion}
                            onDelete={(assetId) => removeQuestionImage(section.id, question.id, assetId)}
                          />

                          {(isActiveQuestion || (question.diagramBlocks && question.diagramBlocks.length > 0)) && (
                            <DiagramDropZone
                              emptyText="Drag a diagram here to attach it to the whole question. It prints before options and subparts."
                              onDrop={() => moveDraggedDiagramToQuestion(section.id, question.id)}
                            >
                              {question.diagramBlocks && question.diagramBlocks.length > 0 && (
                                <DiagramBlockList
                                  diagrams={question.diagramBlocks}
                                  label="Question diagram"
                                  onDelete={(diagramId) => deleteQuestionDiagram(section.id, question.id, diagramId)}
                                  onDragStart={(diagramId) => setDraggedDiagram({ sectionId: section.id, questionId: question.id, diagramId })}
                                />
                              )}
                            </DiagramDropZone>
                          )}

                          {question.options && question.options.length > 0 && (
                            <div className={isActiveQuestion ? "space-y-2 rounded-md border border-slate-200 bg-white p-2" : optionsGridClass(question.options)}>
                              {question.options.map((option, optionIndex) => (
                                isActiveQuestion ? (
                                  <div key={option.id ?? `${question.id}-option-${optionIndex}`} className="group/option grid grid-cols-[44px_1fr_auto] gap-2">
                                    <input
                                      aria-label={`Question ${questionNumber} option ${optionIndex + 1} label`}
                                      className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-center text-xs font-black text-slate-700"
                                      value={option.label ?? String.fromCharCode(65 + optionIndex)}
                                      onChange={(event) => updateQuestionOption(section.id, question.id, optionIndex, { label: event.target.value })}
                                    />
                                    <div className="min-w-0 space-y-2">
                                      <RichTextEditor
                                        label={`Question ${questionNumber} option ${option.label ?? optionIndex + 1}`}
                                        minHeight="compact"
                                        placeholder="Write option..."
                                        value={option.text}
                                        htmlValue={option.richText}
                                        toolbarMode="focus"
                                        onFocus={() => focusQuestion(question.id)}
                                        onChange={(text) => updateQuestionOption(section.id, question.id, optionIndex, { text })}
                                        onHtmlChange={(richText) => updateQuestionOption(section.id, question.id, optionIndex, { richText })}
                                      />
                                      <ImageAssetList
                                        assets={option.imageAssets}
                                        compact
                                        onDelete={(assetId) => removeOptionImage(section.id, question.id, optionIndex, assetId)}
                                      />
                                    </div>
                                    <TextBlockActions
                                      className="opacity-100 lg:opacity-0 lg:group-hover/option:opacity-100"
                                      onDuplicate={() => duplicateQuestionOption(section.id, question.id, optionIndex)}
                                      onAddImage={onUploadImage ? (file) => void attachQuestionOptionImage(section.id, question.id, optionIndex, file) : undefined}
                                      onDelete={() => deleteQuestionOption(section.id, question.id, optionIndex)}
                                    />
                                  </div>
                                ) : (
                                  <div key={option.id ?? `${question.id}-option-${optionIndex}`} className="paper-option-row">
                                    <span className="paper-option-label">{formatOptionLabel(option.label, optionIndex)}</span>
                                    <span className="paper-option-text" dangerouslySetInnerHTML={{ __html: richDisplayHtml(option.richText, option.text) }} />
                                    {option.imageAssets && option.imageAssets.length > 0 && <ImageAssetList assets={option.imageAssets} compact readOnly onDelete={() => undefined} />}
                                  </div>
                                )
                              ))}
                              {isActiveQuestion && (
                                <button className="editor-mini-button ml-11" onClick={() => addQuestionOption(section.id, question.id)} type="button">
                                  <Plus size={14} />
                                  Add option
                                </button>
                              )}
                            </div>
                          )}

                          {question.subparts && question.subparts.length > 0 && (
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                              {question.subparts.map((subpart) => (
                                <div key={subpart.id} className="group/subpart rounded-md border border-slate-200 bg-white p-2">
                                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                                    <span className="rounded bg-slate-100 px-2 py-1 font-black text-slate-800">({subpart.label})</span>
                                    <MarksInput
                                      aria-label={`Question ${questionNumber} subpart ${subpart.label} marks`}
                                      value={subpart.marks ?? 0}
                                      onCommit={(marks) => updateSubpart(section.id, question.id, subpart.id, { marks })}
                                    />
                                    <span>Marks</span>
                                    <select
                                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                      defaultValue=""
                                      title="Move this part into another part's OR slot (within or across questions)"
                                      onChange={(event) => {
                                        const val = event.target.value;
                                        if (val) {
                                          const [tQId, tSpId] = val.split("::");
                                          moveSubpartToOtherQuestionChoice(section.id, question.id, subpart.id, tQId, tSpId);
                                        }
                                        event.currentTarget.value = "";
                                      }}
                                    >
                                      <option value="">Move to part OR...</option>
                                      {section.questions.flatMap((tQ) => {
                                        const tQNum = stats?.questionNumberById[tQ.id] ?? "?";
                                        return (tQ.subparts ?? [])
                                          .filter((tSp) => !(tQ.id === question.id && tSp.id === subpart.id))
                                          .map((tSp) => (
                                            <option
                                              key={`${tQ.id}::${tSp.id}`}
                                              value={`${tQ.id}::${tSp.id}`}
                                              disabled={!!tSp.optionalChoice}
                                            >
                                              Q{tQNum}({tSp.label}){tSp.optionalChoice ? " (OR filled)" : ""}
                                            </option>
                                          ));
                                      })}
                                    </select>
                                    <button className="editor-mini-button text-red-600" onClick={() => deleteSubpart(section.id, question.id, subpart.id)} type="button">
                                      Delete part
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <div className="min-w-0 space-y-2">
                                      <RichTextEditor
                                        label={`Question ${questionNumber} subpart ${subpart.label}`}
                                        minHeight="compact"
                                        placeholder="Write this subpart..."
                                        value={subpart.text}
                                        htmlValue={subpart.richText}
                                        toolbarMode="focus"
                                        onFocus={() => focusQuestion(question.id)}
                                        onChange={(text) => updateSubpart(section.id, question.id, subpart.id, { text })}
                                        onHtmlChange={(richText) => updateSubpart(section.id, question.id, subpart.id, { richText })}
                                      />
                                      <ImageAssetList
                                        assets={subpart.imageAssets}
                                        compact
                                        onDelete={(assetId) => removeSubpartImage(section.id, question.id, subpart.id, assetId)}
                                      />
                                      {subpart.options && subpart.options.length > 0 && (
                                        <div className="space-y-2 rounded-md border border-amber-100 bg-amber-50/50 p-2">
                                          {subpart.options.map((option, optionIndex) => (
                                            <div key={option.id ?? `${subpart.id}-option-${optionIndex}`} className="group/subpart-option grid grid-cols-[44px_1fr_auto] gap-2">
                                              <input
                                                aria-label={`Question ${questionNumber} subpart ${subpart.label} option ${optionIndex + 1} label`}
                                                className="h-9 rounded-md border border-amber-100 bg-white px-2 text-center text-xs font-black text-slate-700"
                                                value={option.label ?? String.fromCharCode(65 + optionIndex)}
                                                onChange={(event) => updateSubpartOption(section.id, question.id, subpart.id, optionIndex, { label: event.target.value })}
                                              />
                                              <div className="min-w-0 space-y-2">
                                                <RichTextEditor
                                                  label={`Question ${questionNumber} part ${subpart.label} option ${option.label ?? optionIndex + 1}`}
                                                  minHeight="compact"
                                                  placeholder="Write part option..."
                                                  value={option.text}
                                                  htmlValue={option.richText}
                                                  toolbarMode="focus"
                                                  onFocus={() => focusQuestion(question.id)}
                                                  onChange={(text) => updateSubpartOption(section.id, question.id, subpart.id, optionIndex, { text })}
                                                  onHtmlChange={(richText) => updateSubpartOption(section.id, question.id, subpart.id, optionIndex, { richText })}
                                                />
                                                <ImageAssetList
                                                  assets={option.imageAssets}
                                                  compact
                                                  onDelete={(assetId) => removeSubpartOptionImage(section.id, question.id, subpart.id, optionIndex, assetId)}
                                                />
                                              </div>
                                              <TextBlockActions
                                                className="opacity-100 lg:opacity-0 lg:group-hover/subpart-option:opacity-100"
                                                onDuplicate={() => duplicateSubpartOption(section.id, question.id, subpart.id, optionIndex)}
                                                onAddImage={onUploadImage ? (file) => void attachSubpartOptionImage(section.id, question.id, subpart.id, optionIndex, file) : undefined}
                                                onDelete={() => deleteSubpartOption(section.id, question.id, subpart.id, optionIndex)}
                                              />
                                            </div>
                                          ))}
                                          <button className="editor-mini-button ml-11" onClick={() => addSubpartOption(section.id, question.id, subpart.id)} type="button">
                                            <Plus size={14} />
                                            Add part option
                                          </button>
                                        </div>
                                      )}
                                      {(!subpart.options || subpart.options.length === 0) && (
                                        <button className="editor-mini-button" onClick={() => createSubpartMcq(section.id, question.id, subpart.id)} type="button">
                                          <Plus size={14} />
                                          Create MCQ in part
                                        </button>
                                      )}
                                    </div>
                                    <TextBlockActions
                                      className="opacity-100 lg:opacity-0 lg:group-hover/subpart:opacity-100"
                                      hasChoice={!!subpart.optionalChoice}
                                      onDuplicate={() => duplicateSubpart(section.id, question.id, subpart.id)}
                                      onAddChoice={!subpart.optionalChoice ? () => addSubpartChoice(section.id, question.id, subpart.id) : undefined}
                                      onRemoveChoice={subpart.optionalChoice ? () => removeSubpartChoice(section.id, question.id, subpart.id) : undefined}
                                      onAddDiagram={() => addSubpartDiagramPlaceholder(section.id, question.id, subpart.id)}
                                      onAddImage={onUploadImage ? (file) => void attachSubpartImage(section.id, question.id, subpart.id, file) : undefined}
                                      onDelete={() => deleteSubpart(section.id, question.id, subpart.id)}
                                    />
                                  </div>
                                  <DiagramDropZone
                                    emptyText={`Drag a diagram here to attach it to part (${subpart.label}).`}
                                    onDrop={() => moveDraggedDiagramToSubpart(section.id, question.id, subpart.id)}
                                  >
                                    {subpart.diagramBlocks && subpart.diagramBlocks.length > 0 && (
                                      <DiagramBlockList
                                        diagrams={subpart.diagramBlocks}
                                        label={`Part (${subpart.label}) diagram`}
                                        onDelete={(diagramId) => deleteSubpartDiagram(section.id, question.id, subpart.id, diagramId)}
                                        onDragStart={(diagramId) => setDraggedDiagram({ sectionId: section.id, questionId: question.id, subpartId: subpart.id, diagramId })}
                                      />
                                    )}
                                  </DiagramDropZone>
                                  {subpart.optionalChoice && (
                                    <div className="mt-2 rounded-md border border-dashed border-blue-200 bg-blue-50/60 p-2">
                                      <div className="mb-2 flex items-center justify-between text-xs font-black text-blue-700">
                                        <span>OR for part ({subpart.label})</span>
                                        <button className="editor-mini-button text-red-600" onClick={() => removeSubpartChoice(section.id, question.id, subpart.id)} type="button">
                                          Remove OR
                                        </button>
                                      </div>
                                      <div className="grid grid-cols-[1fr_auto] gap-2">
                                        <div className="min-w-0 space-y-2">
                                          <RichTextEditor
                                            label={`Question ${questionNumber} subpart ${subpart.label} OR`}
                                            minHeight="compact"
                                            placeholder="Write the OR alternative for this subpart..."
                                            value={subpart.optionalChoice.text}
                                            htmlValue={subpart.optionalChoice.richText}
                                            toolbarMode="focus"
                                            onFocus={() => focusQuestion(question.id)}
                                            onChange={(text) => updateSubpartChoice(section.id, question.id, subpart.id, { text })}
                                            onHtmlChange={(richText) => updateSubpartChoice(section.id, question.id, subpart.id, { richText })}
                                          />
                                          <ImageAssetList
                                            assets={subpart.optionalChoice.imageAssets}
                                            compact
                                            onDelete={(assetId) => removeSubpartChoiceImage(section.id, question.id, subpart.id, assetId)}
                                          />
                                          {subpart.optionalChoice.options && subpart.optionalChoice.options.length > 0 && (
                                            <div className="space-y-2 rounded-md border border-blue-100 bg-white/80 p-2">
                                              {subpart.optionalChoice.options.map((option, optionIndex) => (
                                                <div key={option.id ?? `${subpart.id}-choice-option-${optionIndex}`} className="group/subpart-or-option grid grid-cols-[44px_1fr_auto] gap-2">
                                                  <input
                                                    aria-label={`Question ${questionNumber} subpart ${subpart.label} OR option ${optionIndex + 1} label`}
                                                    className="h-9 rounded-md border border-blue-100 bg-white px-2 text-center text-xs font-black text-slate-700"
                                                    value={option.label ?? String.fromCharCode(65 + optionIndex)}
                                                    onChange={(event) =>
                                                      updateSubpartChoiceOption(section.id, question.id, subpart.id, optionIndex, { label: event.target.value })
                                                    }
                                                  />
                                                  <div className="min-w-0 space-y-2">
                                                    <RichTextEditor
                                                      label={`Question ${questionNumber} part ${subpart.label} OR option ${option.label ?? optionIndex + 1}`}
                                                      minHeight="compact"
                                                      placeholder="Write OR option..."
                                                      value={option.text}
                                                      htmlValue={option.richText}
                                                      toolbarMode="focus"
                                                      onFocus={() => focusQuestion(question.id)}
                                                      onChange={(text) =>
                                                        updateSubpartChoiceOption(section.id, question.id, subpart.id, optionIndex, { text })
                                                      }
                                                      onHtmlChange={(richText) =>
                                                        updateSubpartChoiceOption(section.id, question.id, subpart.id, optionIndex, { richText })
                                                      }
                                                    />
                                                    <ImageAssetList
                                                      assets={option.imageAssets}
                                                      compact
                                                      onDelete={(assetId) =>
                                                        removeSubpartChoiceOptionImage(section.id, question.id, subpart.id, optionIndex, assetId)
                                                      }
                                                    />
                                                  </div>
                                                  <TextBlockActions
                                                    className="opacity-100 lg:opacity-0 lg:group-hover/subpart-or-option:opacity-100"
                                                    onDuplicate={() => duplicateSubpartChoiceOption(section.id, question.id, subpart.id, optionIndex)}
                                                    onAddImage={
                                                      onUploadImage
                                                        ? (file) => void attachSubpartChoiceOptionImage(section.id, question.id, subpart.id, optionIndex, file)
                                                        : undefined
                                                    }
                                                    onDelete={() => deleteSubpartChoiceOption(section.id, question.id, subpart.id, optionIndex)}
                                                  />
                                                </div>
                                              ))}
                                              <button className="editor-mini-button ml-11" onClick={() => addSubpartChoiceOption(section.id, question.id, subpart.id)} type="button">
                                                <Plus size={14} />
                                                Add OR option
                                              </button>
                                            </div>
                                          )}
                                          {(!subpart.optionalChoice.options || subpart.optionalChoice.options.length === 0) && (
                                            <button className="editor-mini-button" onClick={() => createSubpartChoiceMcq(section.id, question.id, subpart.id)} type="button">
                                              <Plus size={14} />
                                              Create MCQ OR
                                            </button>
                                          )}
                                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-blue-700">
                                            <select
                                              className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700"
                                              defaultValue=""
                                              title="Move this OR choice to another subpart's OR slot"
                                              onChange={(event) => {
                                                const toId = event.target.value;
                                                if (toId) moveSubpartOrChoice(section.id, question.id, subpart.id, toId);
                                                event.currentTarget.value = "";
                                              }}
                                            >
                                              <option value="">Move OR to…</option>
                                              {(question.subparts ?? [])
                                                .filter((sp) => sp.id !== subpart.id && !sp.optionalChoice)
                                                .map((sp) => (
                                                  <option key={sp.id} value={sp.id}>Part ({sp.label ?? "?"})</option>
                                                ))}
                                            </select>
                                            <input
                                              aria-label={`Question ${questionNumber} subpart ${subpart.label} OR marks`}
                                              className="w-14 rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-800"
                                              min={0}
                                              type="number"
                                              value={subpart.optionalChoice.marks ?? subpart.marks ?? 0}
                                              onChange={(event) => updateSubpartChoice(section.id, question.id, subpart.id, { marks: Number(event.target.value) })}
                                            />
                                            <span>Marks</span>
                                            <select
                                              className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700"
                                              value={subpart.optionalChoice.type ?? ((subpart.optionalChoice.options?.length ?? 0) > 0 ? "MCQ" : "SA")}
                                              onChange={(event) => {
                                                const type = event.target.value;
                                                updateSubpartChoice(section.id, question.id, subpart.id, {
                                                  type,
                                                  options: type === "MCQ" ? ensureMcqOptions(subpart.optionalChoice?.options, 4) : subpart.optionalChoice?.options,
                                                });
                                              }}
                                            >
                                              {["MCQ", "VSA", "SA", "LA", "Case Study"].map((type) => (
                                                <option key={type}>{type}</option>
                                              ))}
                                            </select>
                                            <select
                                              className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700"
                                              value={subpart.optionalChoice.difficulty ?? question.difficulty}
                                              onChange={(event) => updateSubpartChoice(section.id, question.id, subpart.id, { difficulty: event.target.value })}
                                            >
                                              {["Low", "Medium", "High", "Easy", "Hard"].map((difficulty) => (
                                                <option key={difficulty}>{difficulty}</option>
                                              ))}
                                            </select>
                                          </div>
                                        </div>
                                        <TextBlockActions
                                          onAddImage={onUploadImage ? (file) => void attachSubpartChoiceImage(section.id, question.id, subpart.id, file) : undefined}
                                          onDelete={() => removeSubpartChoice(section.id, question.id, subpart.id)}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {question.optionalChoice && !isActiveQuestion && (
                            <div className="paper-choice-compact">
                              <div className="paper-choice-label">OR</div>
                              <div className="paper-choice-body">
                                <span dangerouslySetInnerHTML={{ __html: richDisplayHtml(question.optionalChoice.richText, question.optionalChoice.text) }} />
                                <ImageAssetList assets={question.optionalChoice.imageAssets} compact readOnly onDelete={() => undefined} />
                                {question.optionalChoice.options && question.optionalChoice.options.length > 0 && (
                                  <div className={`${optionsGridClass(question.optionalChoice.options)} mt-1`}>
                                    {question.optionalChoice.options.map((option, optionIndex) => (
                                      <div key={option.id ?? `${question.id}-choice-compact-${optionIndex}`} className="paper-option-row">
                                        <span className="paper-option-label">{formatOptionLabel(option.label, optionIndex)}</span>
                                        <span className="paper-option-text" dangerouslySetInnerHTML={{ __html: richDisplayHtml(option.richText, option.text) }} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {question.optionalChoice && isActiveQuestion && (
                            <div className={`choice-row group/choice relative rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-3 ${isChoiceReplacing ? "ai-replacing border-blue-300 bg-blue-100/70" : ""}`}>
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-black text-blue-700">OR</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    className="editor-mini-button text-blue-700"
                                    title="Promote OR choice to standalone question"
                                    onClick={() => promoteChoiceToQuestion(section.id, question.id)}
                                    type="button"
                                  >
                                    <ArrowUpFromLine size={11} />
                                    Move out of OR
                                  </button>
                                  <button
                                    className="editor-mini-button text-red-600"
                                    onClick={() => removeInternalChoice(section.id, question.id)}
                                    type="button"
                                  >
                                    <X size={11} />
                                    Remove OR
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-start gap-3">
                                <div className="pt-2 font-display text-sm font-black text-blue-700">Alt</div>
                                <div className="min-w-0 flex-1 space-y-3">
                                  <RichTextEditor
                                    label={`Question ${questionNumber} internal choice`}
                                    minHeight="compact"
                                    placeholder="Write the internal choice..."
                                    value={question.optionalChoice.text}
                                    htmlValue={question.optionalChoice.richText}
                                    toolbarMode="focus"
                                    onFocus={() => focusQuestion(question.id)}
                                    onChange={(text) => updateInternalChoice(section.id, question.id, { text })}
                                    onHtmlChange={(richText) => updateInternalChoice(section.id, question.id, { richText })}
                                  />
                                  <ImageAssetList
                                    assets={question.optionalChoice.imageAssets}
                                    compact
                                    onDelete={(assetId) => removeQuestionChoiceImage(section.id, question.id, assetId)}
                                  />
                                  {(!question.optionalChoice.options || question.optionalChoice.options.length === 0) && (
                                    <button className="editor-mini-button" onClick={() => createInternalChoiceMcq(section.id, question.id)} type="button">
                                      <Plus size={14} />
                                      Create MCQ OR
                                    </button>
                                  )}
                                  {question.optionalChoice.options && question.optionalChoice.options.length > 0 && (
                                    <div className="space-y-2 rounded-md border border-blue-100 bg-white/80 p-2">
                                      {question.optionalChoice.options.map((option, optionIndex) => (
                                        <div key={option.id ?? `${question.id}-choice-option-${optionIndex}`} className="group/or-option grid grid-cols-[44px_1fr_auto] gap-2">
                                          <input
                                            aria-label={`Question ${questionNumber} OR option ${optionIndex + 1} label`}
                                            className="h-9 rounded-md border border-blue-100 bg-white px-2 text-center text-xs font-black text-slate-700"
                                            value={option.label ?? String.fromCharCode(65 + optionIndex)}
                                            onChange={(event) => updateInternalChoiceOption(section.id, question.id, optionIndex, { label: event.target.value })}
                                          />
                                          <div className="min-w-0 space-y-2">
                                            <RichTextEditor
                                              label={`Question ${questionNumber} OR option ${option.label ?? optionIndex + 1}`}
                                              minHeight="compact"
                                              placeholder="Write OR option..."
                                              value={option.text}
                                              htmlValue={option.richText}
                                              toolbarMode="focus"
                                              onFocus={() => focusQuestion(question.id)}
                                              onChange={(text) => updateInternalChoiceOption(section.id, question.id, optionIndex, { text })}
                                              onHtmlChange={(richText) => updateInternalChoiceOption(section.id, question.id, optionIndex, { richText })}
                                            />
                                            <ImageAssetList
                                              assets={option.imageAssets}
                                              compact
                                              onDelete={(assetId) => removeInternalChoiceOptionImage(section.id, question.id, optionIndex, assetId)}
                                            />
                                          </div>
                                          <TextBlockActions
                                            className="opacity-100 lg:opacity-0 lg:group-hover/or-option:opacity-100"
                                            onDuplicate={() => duplicateInternalChoiceOption(section.id, question.id, optionIndex)}
                                            onAddImage={
                                              onUploadImage ? (file) => void attachInternalChoiceOptionImage(section.id, question.id, optionIndex, file) : undefined
                                            }
                                            onDelete={() => deleteInternalChoiceOption(section.id, question.id, optionIndex)}
                                          />
                                        </div>
                                      ))}
                                      <button className="editor-mini-button ml-11" onClick={() => addInternalChoiceOption(section.id, question.id)} type="button">
                                        <Plus size={14} />
                                        Add OR option
                                      </button>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                                    <input
                                      aria-label={`Question ${questionNumber} OR marks`}
                                      className="w-16 rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-800"
                                      min={0}
                                      type="number"
                                      value={question.optionalChoice.marks ?? question.marks}
                                      onChange={(event) => updateInternalChoice(section.id, question.id, { marks: Number(event.target.value) })}
                                    />
                                    <span>Marks</span>
                                    <select
                                      className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700"
                                      value={question.optionalChoice.type ?? question.type}
                                      onChange={(event) => {
                                        const type = event.target.value;
                                        updateInternalChoice(section.id, question.id, {
                                          type,
                                          options: type === "MCQ" ? ensureMcqOptions(question.optionalChoice?.options, 4) : question.optionalChoice?.options,
                                        });
                                      }}
                                    >
                                      {["MCQ", "VSA", "SA", "LA", "Case Study"].map((type) => (
                                        <option key={type}>{type}</option>
                                      ))}
                                    </select>
                                    <select
                                      className="rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700"
                                      value={question.optionalChoice.difficulty ?? question.difficulty}
                                      onChange={(event) => updateInternalChoice(section.id, question.id, { difficulty: event.target.value })}
                                    >
                                      {["Low", "Medium", "High", "Easy", "Hard"].map((difficulty) => (
                                        <option key={difficulty}>{difficulty}</option>
                                      ))}
                                    </select>
                                    <input
                                      className="min-w-28 rounded-md border border-blue-100 bg-white px-2 py-1 text-xs text-slate-700"
                                      placeholder="Topic"
                                      value={question.optionalChoice.topic ?? question.topic ?? ""}
                                      onChange={(event) => updateInternalChoice(section.id, question.id, { topic: event.target.value })}
                                    />
                                    <span className="rounded bg-white px-2 py-1 text-blue-700">{question.optionalChoice.source || question.source || "Manual OR"}</span>
                                  </div>
                                  {(expandedAnswers[`${question.id}:choice`] ?? false) && (
                                    <RichTextEditor
                                      label={`Question ${questionNumber} OR answer`}
                                      minHeight="answer"
                                      placeholder="Write OR answer / marking scheme..."
                                      value={question.optionalChoice.answer ?? ""}
                                      htmlValue={question.optionalChoice.answerRichText}
                                      toolbarMode="focus"
                                      onFocus={() => focusQuestion(question.id)}
                                      onChange={(answer) => updateInternalChoice(section.id, question.id, { answer })}
                                      onHtmlChange={(answerRichText) => updateInternalChoice(section.id, question.id, { answerRichText })}
                                    />
                                  )}
                                </div>
                                <TextBlockActions
                                  className="opacity-100 lg:opacity-0 lg:group-hover/choice:opacity-100"
                                  isReplacing={isChoiceReplacing}
                                  onReplace={() =>
                                    setReplacePrompt({
                                      sectionId: section.id,
                                      questionId: question.id,
                                      questionNumber,
                                      mode: "choice",
                                      text: "Replace this OR choice with a different valid alternative from the same chapter. Preserve marks, type, difficulty, and total paper marks.",
                                    })
                                  }
                                  onDuplicate={() => duplicateOptionalChoiceAsQuestion(section.id, question.id)}
                                  onAnswer={() => setExpandedAnswers((current) => ({ ...current, [`${question.id}:choice`]: !(current[`${question.id}:choice`] ?? false) }))}
                                  onAddImage={onUploadImage ? (file) => void attachQuestionChoiceImage(section.id, question.id, file) : undefined}
                                  onSave={() => onSaveQuestionToBank(choiceToQuestion(question))}
                                  onDelete={() => removeInternalChoice(section.id, question.id)}
                                />
                              </div>
                            </div>
                          )}

                          {isActiveQuestion && (
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                              <MarksInput
                                aria-label={`Question ${questionNumber} marks`}
                                value={question.marks}
                                onCommit={(marks) => updateQuestion(section.id, question.id, { marks })}
                              />
                              <span>Marks</span>
                              {section.targetMarks && section.questions.length > 0 && question.marks !== Math.round(section.targetMarks / section.questions.length) && (
                                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700" title="Marks differ from section average">
                                  <AlertTriangle size={10} />
                                  {question.marks}m vs avg {Math.round(section.targetMarks / section.questions.length)}m
                                </span>
                              )}
                              <select
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                defaultValue=""
                                title="Move this question into another question's OR slot"
                                onChange={(event) => {
                                  const targetQuestionId = event.target.value;
                                  if (targetQuestionId) moveQuestionToInternalChoice(section.id, question.id, targetQuestionId);
                                  event.currentTarget.value = "";
                                }}
                              >
                                <option value="">Move to OR...</option>
                                {(questionTargets || [])
                                  .filter((target) => target.id !== question.id)
                                  .map((target) => (
                                    <option key={target.id} value={target.id} disabled={target.hasChoice}>
                                      {target.label}{target.hasChoice ? " (OR filled)" : ""}
                                    </option>
                                  ))}
                              </select>
                              <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{question.source || "Manual"}</span>
                              <details className="rounded-md border border-slate-200 bg-white px-2 py-1">
                                <summary className="cursor-pointer list-none text-slate-500">Details</summary>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <select
                                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                    value={question.type}
                                    onChange={(event) => updateQuestion(section.id, question.id, { type: event.target.value })}
                                  >
                                    {["MCQ", "VSA", "SA", "LA", "Case Study"].map((type) => (
                                      <option key={type}>{type}</option>
                                    ))}
                                  </select>
                                  <select
                                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                    value={question.difficulty}
                                    onChange={(event) => updateQuestion(section.id, question.id, { difficulty: event.target.value })}
                                  >
                                    {["Low", "Medium", "High", "Easy", "Hard"].map((difficulty) => (
                                      <option key={difficulty}>{difficulty}</option>
                                    ))}
                                  </select>
                                  <input
                                    className="min-w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                    placeholder="Topic"
                                    value={question.topic ?? ""}
                                    onChange={(event) => updateQuestion(section.id, question.id, { topic: event.target.value })}
                                  />
                                </div>
                              </details>
                            </div>
                          )}

                          {isAnswerOpen && (
                            <RichTextEditor
                              label={`Question ${questionNumber} answer`}
                              minHeight="answer"
                              placeholder="Write answer / marking scheme..."
                              value={question.answer}
                              htmlValue={question.answerRichText}
                              toolbarMode="focus"
                              onFocus={() => focusQuestion(question.id)}
                              onChange={(answer) => updateQuestion(section.id, question.id, { answer })}
                              onHtmlChange={(answerRichText) => updateQuestion(section.id, question.id, { answerRichText })}
                            />
                          )}
                        </div>

                        {isActiveQuestion && (
                          <TextBlockActions
                            isReplacing={isReplacing}
                            hasChoice={!!question.optionalChoice}
                            onReplace={() =>
                              setReplacePrompt({
                                sectionId: section.id,
                                questionId: question.id,
                                questionNumber,
                                mode: "question",
                                text: "Replace this question with a different question from the same chapter, same marks, same difficulty.",
                              })
                            }
                            onDuplicate={() => duplicateQuestion(section.id, question.id)}
                            onAddChoice={!question.optionalChoice ? () => addInternalChoice(section.id, question.id) : undefined}
                            onRemoveChoice={question.optionalChoice ? () => removeInternalChoice(section.id, question.id) : undefined}
                            onAddSubpart={() => addSubpart(section.id, question.id)}
                            onAddDiagram={() => addDiagramPlaceholder(section.id, question.id)}
                            onAddImage={onUploadImage ? (file) => void attachQuestionImage(section.id, question.id, file) : undefined}
                            onAnswer={() => setExpandedAnswers((current) => ({ ...current, [question.id]: !isAnswerOpen }))}
                            onSave={() => onSaveQuestionToBank(question)}
                            onDelete={() => deleteQuestion(section.id, question.id)}
                          />
                        )}
                      </div>
                      {isReplacing && (
                        <div className="pointer-events-none absolute inset-0 rounded-lg border border-blue-300 bg-blue-50/55">
                          <div className="absolute right-3 top-3 rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-blue-700 shadow-sm">
                            Replacing with AI
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            {sectionIndex < paper.sections.length - 1 && (
              <div className="pointer-events-none my-4 h-px border-t border-dashed border-slate-200" />
            )}
            </Fragment>
          );
        })}
      </div>
      </div>

      {contextMenu && (
        <ContextMenuPanel
          {...contextMenu}
          onClose={() => setContextMenu(null)}
          onBold={() => (window as unknown as { activeRichTextEditor?: { chain: () => { focus: () => { toggleBold: () => { run: () => void } } } } }).activeRichTextEditor?.chain().focus().toggleBold().run()}
          onItalic={() => (window as unknown as { activeRichTextEditor?: { chain: () => { focus: () => { toggleItalic: () => { run: () => void } } } } }).activeRichTextEditor?.chain().focus().toggleItalic().run()}
          onUnderline={() => (window as unknown as { activeRichTextEditor?: { chain: () => { focus: () => { toggleUnderline: () => { run: () => void } } } } }).activeRichTextEditor?.chain().focus().toggleUnderline().run()}
          onMath={() => (window as unknown as { activeRichTextEditor?: { chain: () => { focus: () => { run: () => void } } } }).activeRichTextEditor?.chain().focus().run()}
          onAddOR={contextMenu.questionId ? (() => {
            const sec = paper.sections.find(s => s.questions.some(q => q.id === contextMenu.questionId));
            const q = sec?.questions.find(q => q.id === contextMenu.questionId);
            if (sec && q && !q.optionalChoice) addInternalChoice(sec.id, q.id);
          }) : undefined}
          onAddSubpart={contextMenu.questionId ? (() => {
            const sec = paper.sections.find(s => s.questions.some(q => q.id === contextMenu.questionId));
            if (sec && contextMenu.questionId) addSubpart(sec.id, contextMenu.questionId);
          }) : undefined}
          onAddDiagram={contextMenu.questionId ? (() => {
            const sec = paper.sections.find(s => s.questions.some(q => q.id === contextMenu.questionId));
            if (sec && contextMenu.questionId) addDiagramPlaceholder(sec.id, contextMenu.questionId);
          }) : undefined}
          onDuplicate={contextMenu.questionId ? (() => {
            const sec = paper.sections.find(s => s.questions.some(q => q.id === contextMenu.questionId));
            if (sec && contextMenu.questionId) duplicateQuestion(sec.id, contextMenu.questionId);
          }) : undefined}
          onDelete={contextMenu.questionId ? (() => {
            const sec = paper.sections.find(s => s.questions.some(q => q.id === contextMenu.questionId));
            if (sec && contextMenu.questionId) deleteQuestion(sec.id, contextMenu.questionId);
          }) : undefined}
        />
      )}

      {replacePrompt && (
        <ReplacePromptModal
          prompt={replacePrompt.text}
          title={replacePrompt.mode === "choice" ? "Replace OR choice with AI" : "Replace question with AI"}
          onChange={(text) => setReplacePrompt((current) => (current ? { ...current, text } : current))}
          onClose={() => setReplacePrompt(null)}
          onSubmit={() => {
            const nextPrompt = replacePrompt;
            setReplacePrompt(null);
            if (nextPrompt.mode === "choice") {
              void replaceInternalChoice(nextPrompt.sectionId, nextPrompt.questionId, nextPrompt.questionNumber, nextPrompt.text);
            } else {
              void replaceQuestion(nextPrompt.sectionId, nextPrompt.questionId, nextPrompt.questionNumber, nextPrompt.text);
            }
          }}
        />
      )}
    </div>
  );
}

interface TextBlockActionsProps {
  className?: string;
  isReplacing?: boolean;
  hasChoice?: boolean;
  onReplace?: () => void;
  onDuplicate?: () => void;
  onAddChoice?: () => void;
  onRemoveChoice?: () => void;
  onAddSubpart?: () => void;
  onAddDiagram?: () => void;
  onAddImage?: (file: File) => void;
  onAnswer?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
}

function TextBlockActions({
  className = "",
  isReplacing = false,
  hasChoice = false,
  onReplace,
  onDuplicate,
  onAddChoice,
  onRemoveChoice,
  onAddSubpart,
  onAddDiagram,
  onAddImage,
  onAnswer,
  onSave,
  onDelete,
}: TextBlockActionsProps) {
  return (
    <div className={`flex shrink-0 flex-col gap-1 transition ${className}`}>
      {onReplace && (
        <button className="editor-icon-button" disabled={isReplacing} title="Replace with AI" onClick={onReplace} type="button">
          <RefreshCcw className={isReplacing ? "animate-spin" : ""} size={15} />
        </button>
      )}
      {onDuplicate && (
        <button className="editor-icon-button" title="Duplicate" onClick={onDuplicate} type="button">
          <Copy size={15} />
        </button>
      )}
      {onAddChoice && !hasChoice && (
        <button className="editor-icon-button text-blue-600" title="Add OR choice" onClick={onAddChoice} type="button">
          <LogIn size={13} />
        </button>
      )}
      {onRemoveChoice && hasChoice && (
        <button className="editor-icon-button text-blue-600" title="Remove OR choice" onClick={onRemoveChoice} type="button">
          <LogOut size={13} />
        </button>
      )}
      {onAddSubpart && (
        <button className="editor-icon-button" title="Add subpart" onClick={onAddSubpart} type="button">
          (a)
        </button>
      )}
      {onAddDiagram && (
        <button className="editor-icon-button" title="Insert diagram placeholder" onClick={onAddDiagram} type="button">
          <Shapes size={15} />
        </button>
      )}
      {onAddImage && <ImageUploadButton onUpload={onAddImage} />}
      {onAnswer && (
        <button className="editor-icon-button" title="Show answer" onClick={onAnswer} type="button">
          A
        </button>
      )}
      {onSave && (
        <button className="editor-icon-button" title="Save to question bank" onClick={onSave} type="button">
          <Save size={15} />
        </button>
      )}
      {onDelete && (
        <button className="editor-icon-button text-red-600 hover:bg-red-50" title="Delete" onClick={onDelete} type="button">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function ImageUploadButton({ onUpload }: { onUpload: (file: File) => void }) {
  return (
    <label className="editor-icon-button cursor-pointer" title="Attach image">
      <ImageIcon size={15} />
      <input
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onUpload(file);
        }}
      />
    </label>
  );
}

function ImageAssetList({
  assets,
  compact = false,
  onDelete,
  readOnly = false,
}: {
  assets?: PaperImageAsset[];
  compact?: boolean;
  onDelete: (assetId: string) => void;
  readOnly?: boolean;
}) {
  if (!assets || assets.length === 0) return null;

  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
      {assets.map((asset) => (
        <figure key={asset.id} className="relative rounded-md border border-slate-200 bg-white p-2 shadow-sm">
          <img
            alt={asset.altText || asset.caption || asset.filename || "Question image"}
            className={`${compact ? "max-h-24" : "max-h-40"} w-full rounded object-contain`}
            src={asset.url}
          />
          <figcaption className="mt-1 truncate text-[10px] font-bold text-slate-500">{asset.caption || asset.filename || asset.name || "Attached image"}</figcaption>
          {!readOnly && (
            <button
              className="absolute right-1 top-1 rounded bg-white/90 p-1 text-red-600 shadow-sm hover:bg-red-50"
              onClick={() => onDelete(asset.id)}
              title="Remove image"
              type="button"
            >
              <Trash2 size={12} />
            </button>
          )}
        </figure>
      ))}
    </div>
  );
}

function ReplacePromptModal({
  onChange,
  onClose,
  onSubmit,
  prompt,
  title,
}: {
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  prompt: string;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.35)] px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="font-display text-2xl italic text-slate-950">{title}</div>
        <p className="mt-1 text-sm text-slate-500">Tell the AI exactly what should change before replacement starts.</p>
        <textarea
          className="mt-4 min-h-32 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          value={prompt}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button className="editor-mini-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="editor-mini-button bg-slate-950 text-white hover:bg-slate-800" onClick={onSubmit} type="button">
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceMixPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-amber-200 bg-white/70 px-2 py-2">
      <div className="font-mono text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">{label}</div>
      <div className="mt-1 font-display text-xl italic text-amber-950">{value}</div>
    </div>
  );
}

function MarksInput({
  value,
  onCommit,
  "aria-label": ariaLabel,
}: {
  value: number;
  onCommit: (value: number) => void;
  "aria-label"?: string;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <input
      aria-label={ariaLabel}
      className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
      inputMode="numeric"
      pattern="[0-9.]*"
      value={localValue}
      onChange={(e) => {
        const newVal = e.target.value;
        setLocalValue(newVal);
        const parsed = Number(newVal);
        if (!Number.isNaN(parsed) && parsed >= 0) onCommit(parsed);
      }}
      onBlur={() => {
        const parsed = Number(localValue);
        if (!Number.isNaN(parsed) && parsed >= 0) onCommit(parsed);
        else setLocalValue(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function ContextMenuPanel({
  x, y, questionId, sectionId, inMathField, latex,
  activeEditor,
  onClose,
  onAddOR, onAddSubpart, onAddDiagram, onDelete, onDuplicate, onReplace,
  onBold, onItalic, onUnderline, onMath,
}: {
  x: number; y: number;
  questionId?: string; sectionId?: string;
  inMathField?: boolean; latex?: string;
  activeEditor?: unknown;
  onClose: () => void;
  onAddOR?: () => void;
  onAddSubpart?: () => void;
  onAddDiagram?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onReplace?: () => void;
  onBold?: () => void;
  onItalic?: () => void;
  onUnderline?: () => void;
  onMath?: () => void;
}) {
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(y, window.innerHeight - 220),
    left: Math.min(x, window.innerWidth - 230),
    zIndex: 1000,
  };

  return (
    <div style={style} className="flex flex-col gap-1.5" onContextMenu={(e) => e.stopPropagation()}>
      {/* Panel 1: mini formatting toolbar */}
      <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-lg">
        {onBold && (
          <button className="editor-icon-button" title="Bold" onClick={() => { onBold(); onClose(); }} type="button">
            <Bold size={14} />
          </button>
        )}
        {onItalic && (
          <button className="editor-icon-button" title="Italic" onClick={() => { onItalic(); onClose(); }} type="button">
            <Italic size={14} />
          </button>
        )}
        {onUnderline && (
          <button className="editor-icon-button" title="Underline" onClick={() => { onUnderline(); onClose(); }} type="button">
            <UnderlineIcon size={14} />
          </button>
        )}
        {onMath && (
          <button className="editor-icon-button text-blue-600" title="Insert Math" onClick={() => { onMath(); onClose(); }} type="button">
            <Sigma size={14} />
          </button>
        )}
        {inMathField && latex !== undefined && (
          <span className="ml-1 rounded bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-700">
            {latex.slice(0, 20)}{latex.length > 20 ? "…" : ""}
          </span>
        )}
      </div>

      {/* Panel 2: question actions */}
      {questionId && (
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {onReplace && (
            <button className="flex items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { onReplace(); onClose(); }} type="button">
              <RefreshCcw size={12} /> Replace with AI
            </button>
          )}
          {onDuplicate && (
            <button className="flex items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { onDuplicate(); onClose(); }} type="button">
              <Copy size={12} /> Duplicate
            </button>
          )}
          {onAddOR && (
            <button className="flex items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-blue-600 hover:bg-blue-50" onClick={() => { onAddOR(); onClose(); }} type="button">
              <LogIn size={12} /> Add OR choice
            </button>
          )}
          {onAddSubpart && (
            <button className="flex items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { onAddSubpart(); onClose(); }} type="button">
              (a) Add subpart
            </button>
          )}
          {onAddDiagram && (
            <button className="flex items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { onAddDiagram(); onClose(); }} type="button">
              <Shapes size={12} /> Add diagram
            </button>
          )}
          {onDelete && (
            <>
              <div className="mx-3 my-1 h-px bg-slate-100" />
              <button className="flex items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-red-600 hover:bg-red-50" onClick={() => { onDelete(); onClose(); }} type="button">
                <Trash2 size={12} /> Delete question
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function optionsGridClass(options: PaperQuestionOption[]): string {
  const maxLen = options.reduce((max, o) => {
    const textLen = (o.text ?? "").length;
    const richLen = (o.richText ?? "").replace(/<[^>]*>/g, "").length;
    return Math.max(max, textLen, richLen);
  }, 0);
  const hasImages = options.some((o) => (o.imageAssets?.length ?? 0) > 0);
  return maxLen > 50 || hasImages ? "paper-option-grid paper-option-grid--vertical" : "paper-option-grid";
}

function formatOptionLabel(label: string | undefined, index: number) {
  const normalized = (label || String.fromCharCode(65 + index)).trim();
  if (/^\(?[A-Z]\)?\.?$/i.test(normalized)) return `(${normalized.replace(/[().]/g, "").toUpperCase()})`;
  if (/^\(?[ivx]+\)?\.?$/i.test(normalized)) return normalized.startsWith("(") ? normalized : `(${normalized})`;
  return normalized;
}

function richDisplayHtml(richText: string | undefined, text: string | undefined) {
  const source = text?.trim() ? textToDisplayHtml(text) : richText?.trim() ? stripMathSpansToText(richText) : "";
  return stripEditorOnlyMarkup(source)
    .replaceAll('data-type="inline-math"', 'data-type="inline-math"')
    .replace(/<p><\/p>/g, "")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/g, "");
}

function stripEditorOnlyMarkup(html: string) {
  // Only strip data-* editor attributes that are TipTap-internal — never touch class or style
  // (KaTeX depends on both for correct fraction/accent rendering).
  return html.replace(/\s(contenteditable|data-pm-slice|data-drag-handle)="[^"]*"/g, "");
}

function stripMathSpansToText(html: string) {
  return html.replace(/<span[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, (_match, latex: string) => renderLatexPreview(unescapeDisplayHtml(latex)));
}

function textToDisplayHtml(value: string) {
  // Apply plain-text transforms BEFORE KaTeX so later regexes don't corrupt already-rendered HTML
  return escapeDisplayHtml(value)
    .replace(/([A-Za-z])([23])(?=\b|[^A-Za-z0-9])/g, "$1<sup>$2</sup>")
    .replace(/\(([A-Za-z0-9\s+\-−–*/=.,]+)\)([23])(?=\b|[^A-Za-z0-9])/g, "($1)<sup>$2</sup>")
    .replace(/\b([A-Z][a-z]?)(\d+)(?=[A-Z]|$)/g, "$1<sub>$2</sub>")
    .replace(/\n/g, "<br>")
    .replace(/\$([^$\n]+)\$/g, (_match, latex: string) => renderLatexPreview(normalizeDisplayLatex(latex)))
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (match) => renderLatexPreview(match))
    .replace(/\\sqrt\{([^{}]+)\}/g, (match) => renderLatexPreview(match));
}

function normalizeDisplayLatex(value: string) {
  return value
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/π/g, "\\pi")
    .replace(/([A-Za-z0-9)\]}])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, base: string, digits: string) => `${base}^{${digits.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(digit).toString())}}`);
}

function escapeDisplayHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function unescapeDisplayHtml(value: string) {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

function renderLatexPreview(latex: string) {
  const normalized = normalizeDisplayLatex(latex);
  try {
    // output:"html" prevents KaTeX from emitting a <math> MathML element alongside the
    // visual HTML span. Without this, stripping classes causes both the MathML text node
    // and the visual span to render simultaneously, producing doubled characters.
    return katex.renderToString(normalized, { throwOnError: false, strict: false, displayMode: false, output: "html" });
  } catch {
    return `<span class="math-preview">${escapeDisplayHtml(normalized)}</span>`;
  }
}

function DiagramDropZone({
  children,
  emptyText,
  onDrop,
}: {
  children?: React.ReactNode;
  emptyText: string;
  onDrop: () => void;
}) {
  return (
    <div
      className="rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-2"
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
    >
      {children || <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">{emptyText}</div>}
    </div>
  );
}

function DiagramBlockList({
  diagrams,
  label,
  onDelete,
  onDragStart,
}: {
  diagrams: NonNullable<PaperQuestion["diagramBlocks"]>;
  label: string;
  onDelete: (diagramId: string) => void;
  onDragStart: (diagramId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {diagrams.map((diagram) => (
        <div
          key={diagram.id}
          className="flex cursor-grab items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-sm"
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            onDragStart(diagram.id);
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <GripVertical className="shrink-0 text-amber-700" size={15} />
            <div className="min-w-0">
              <div className="truncate font-black text-slate-800">{diagram.title}</div>
              <div className="truncate">{diagram.caption || label}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">Draggable</span>
            <button className="editor-icon-button text-red-600 hover:bg-red-50" onClick={() => onDelete(diagram.id)} type="button" title="Delete diagram">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function moveDiagram(paper: Paper, source: DraggedDiagram, target: { sectionId: string; questionId: string; subpartId?: string }): Paper {
  let movingDiagram: NonNullable<PaperQuestion["diagramBlocks"]>[number] | null = null;

  const sectionsWithoutDiagram = paper.sections.map((section) => ({
    ...section,
    questions: section.questions.map((question) => {
      if (section.id !== source.sectionId || question.id !== source.questionId) return question;

      if (source.subpartId) {
        return {
          ...question,
          subparts: question.subparts?.map((subpart) => {
            if (subpart.id !== source.subpartId) return subpart;
            movingDiagram = subpart.diagramBlocks?.find((diagram) => diagram.id === source.diagramId) ?? null;
            return {
              ...subpart,
              diagramBlocks: (subpart.diagramBlocks ?? []).filter((diagram) => diagram.id !== source.diagramId),
            };
          }),
        };
      }

      movingDiagram = question.diagramBlocks?.find((diagram) => diagram.id === source.diagramId) ?? null;
      return {
        ...question,
        diagramBlocks: (question.diagramBlocks ?? []).filter((diagram) => diagram.id !== source.diagramId),
      };
    }),
  }));

  if (!movingDiagram) return paper;

  return {
    ...paper,
    sections: sectionsWithoutDiagram.map((section) => ({
      ...section,
      questions: section.questions.map((question) => {
        if (section.id !== target.sectionId || question.id !== target.questionId) return question;

        if (target.subpartId) {
          return {
            ...question,
            subparts: question.subparts?.map((subpart) =>
              subpart.id === target.subpartId
                ? {
                    ...subpart,
                    diagramBlocks: [...(subpart.diagramBlocks ?? []), movingDiagram as NonNullable<PaperQuestion["diagramBlocks"]>[number]],
                  }
                : subpart,
            ),
          };
        }

        return {
          ...question,
          diagramBlocks: [...(question.diagramBlocks ?? []), movingDiagram as NonNullable<PaperQuestion["diagramBlocks"]>[number]],
        };
      }),
    })),
  };
}

function nextSubpartLabel(subparts: PaperSubpart[]) {
  const used = new Set(subparts.map((subpart) => subpart.label));
  for (let index = 0; index < 26; index += 1) {
    const label = String.fromCharCode(97 + index);
    if (!used.has(label)) return label;
  }
  return String.fromCharCode(97 + subparts.length);
}

function templateToneFor(templateName: string) {
  const normalized = templateName.toLowerCase();

  if (normalized.includes("unit")) {
    return {
      articleClass: "border-emerald-200",
      headerClass: "border-b-4 border-emerald-600",
      badgeClass: "bg-emerald-50 text-emerald-700",
      instructions: [
        "This unit test contains {questionCount} focused questions from the selected chapter/topic.",
        "Answer all questions. Keep workings neat and show steps for application questions.",
      ],
    };
  }

  if (normalized.includes("mid")) {
    return {
      articleClass: "border-blue-200",
      headerClass: "border-b-2 border-blue-700",
      badgeClass: "bg-blue-50 text-blue-700",
      instructions: [
        "This mid-term paper contains {questionCount} questions across {sectionCount} sections.",
        "All questions are compulsory unless an internal choice is provided. Marks are shown against each question.",
        "Use proper reasoning and write final answers clearly.",
      ],
    };
  }

  if (normalized.includes("full")) {
    return {
      articleClass: "border-amber-300",
      headerClass: "border-y-4 border-double border-amber-700 py-5",
      badgeClass: "bg-amber-50 text-amber-800",
      instructions: [
        "This question paper contains {questionCount} questions. All questions are compulsory.",
        "This question paper is divided into {sectionCount} sections. Internal choices, if any, are printed inside the relevant question.",
        "Use of calculator is not allowed. Draw neat diagrams wherever required.",
      ],
    };
  }

  return {
    articleClass: "border-slate-200",
    headerClass: "border-b border-slate-200",
    badgeClass: "bg-slate-100 text-slate-700",
    instructions: [
      "This question paper contains {questionCount} questions. All questions are compulsory unless an internal choice is provided.",
      "This question paper is divided into {sectionCount} sections. Use of calculator is not allowed unless specified by the teacher.",
    ],
  };
}

function blankQuestionChoice(question?: PaperQuestion): NonNullable<PaperQuestion["optionalChoice"]> {
  const type = question?.type ?? "SA";

  return {
    id: crypto.randomUUID(),
    text: "",
    richText: "",
    marks: question?.marks ?? 1,
    type,
    options:
      type === "MCQ"
        ? Array.from({ length: Math.max(question?.options?.length ?? 4, 4) }, (_item, index) => ({
            id: crypto.randomUUID(),
            label: String.fromCharCode(65 + index),
            text: "",
            richText: "",
            isCorrect: false,
          }))
        : undefined,
    difficulty: question?.difficulty ?? "Medium",
    source: "Manual OR",
    topic: question?.topic,
    answer: "",
    answerRichText: "",
  };
}

function questionToChoice(question: PaperQuestion): NonNullable<PaperQuestion["optionalChoice"]> {
  return {
    id: crypto.randomUUID(),
    text: question.text,
    richText: question.richText,
    options: question.options?.map((option) => ({ ...option, id: crypto.randomUUID() })),
    subparts: question.subparts?.map((subpart) => ({
      ...subpart,
      id: crypto.randomUUID(),
      optionalChoice: subpart.optionalChoice ? { ...subpart.optionalChoice, id: crypto.randomUUID() } : undefined,
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

function choiceHasContent(choice: PaperQuestion["optionalChoice"]) {
  if (!choice) return false;
  return Boolean(
    choice.text?.trim() ||
      choice.richText?.replace(/<[^>]*>/g, "").trim() ||
      (choice.options && choice.options.length > 0 && choice.options.some((option) => option.text?.trim() || option.richText?.replace(/<[^>]*>/g, "").trim())) ||
      (choice.subparts && choice.subparts.length > 0) ||
      (choice.imageAssets && choice.imageAssets.length > 0),
  );
}

function choiceToQuestion(question: PaperQuestion): PaperQuestion {
  const choice = question.optionalChoice;

  return {
    id: choice?.id || crypto.randomUUID(),
    text: choice?.text || "",
    richText: choice?.richText || "",
    marks: Number(choice?.marks ?? question.marks ?? 1),
    type: choice?.type || question.type || "SA",
    difficulty: choice?.difficulty || question.difficulty || "Medium",
    source: choice?.source || question.source || "Manual OR",
    topic: choice?.topic || question.topic,
    tags: choice?.tags || question.tags,
    options: choice?.options?.map((option) => ({ ...option, id: crypto.randomUUID() })),
    subparts: choice?.subparts?.map((subpart) => ({ ...subpart, id: crypto.randomUUID() })),
    imageAssets: choice?.imageAssets?.map((asset) => ({ ...asset })),
    answer: choice?.answer || "",
    answerRichText: choice?.answerRichText || "",
  };
}

function countedQuestionMarks(question: PaperQuestion) {
  const subpartTotal = (question.subparts ?? []).reduce((total, subpart) => total + Number(subpart.marks || 0), 0);
  return subpartTotal > 0 ? subpartTotal : Number(question.marks || 0);
}

function questionWithComputedMarks(question: PaperQuestion): PaperQuestion {
  const marks = countedQuestionMarks(question);
  return marks !== Number(question.marks || 0) ? { ...question, marks } : question;
}

function calculateStats(paper: Paper) {
  let questionNumber = 1;
  const questionNumberById: Record<string, number> = {};
  const topicMarks = new Map<string, number>();
  let totalMarks = 0;
  let questionCount = 0;

  paper.sections.forEach((section) => {
    section.questions.forEach((question) => {
      questionNumberById[question.id] = questionNumber;
      questionNumber += 1;
      questionCount += 1;
      const marks = countedQuestionMarks(question);
      const topic = question.topic || paper.metadata.topic || paper.metadata.chapter || section.title || "Unassigned";
      topicMarks.set(topic, (topicMarks.get(topic) || 0) + marks);
    });
    totalMarks += countedSectionMarks(section);
  });

  const topicWeights = Array.from(topicMarks.entries()).map(([topic, marks]) => ({
    topic,
    marks,
    percent: totalMarks > 0 ? Math.round((marks / totalMarks) * 100) : 0,
  }));

  return { questionNumberById, totalMarks, questionCount, topicWeights };
}

function calculateSourceMix(paper: Paper) {
  const counts = { ncert: 0, pyq: 0, questionBank: 0, aiGenerated: 0, uncited: 0, total: 0 };

  paper.sections.forEach((section) => {
    section.questions.forEach((question) => {
      counts.total += 1;
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
  };
}

function countedSectionMarks(section: PaperSection) {
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

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"} ${remainder} minutes` : `${minutes} minutes`;
}
