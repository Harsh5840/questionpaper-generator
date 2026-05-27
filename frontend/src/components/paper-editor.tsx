"use client";

import { useMemo, useState } from "react";
import {
  Copy,
  GripVertical,
  ImagePlus,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
} from "lucide-react";
import { DocumentStyle, Paper, PaperQuestion, PaperSection, PaperSubpart } from "@/lib/types";
import { RichTextEditor } from "./rich-text-editor";

interface PaperEditorProps {
  paper: Paper | null;
  documentStyle: DocumentStyle;
  isGenerating?: boolean;
  onPaperChange: (paper: Paper) => void;
  onReplaceQuestion: (sectionId: string, questionId: string, questionNumber: number) => Promise<void> | void;
  onReplaceOptionalChoice: (sectionId: string, questionId: string, questionNumber: number) => Promise<void> | void;
  onSaveQuestionToBank: (question: PaperQuestion) => void;
  onImportImage: (sectionId: string) => void;
}

interface DraggedQuestion {
  sectionId: string;
  questionId: string;
}

export function PaperEditor({
  paper,
  documentStyle,
  isGenerating = false,
  onPaperChange,
  onReplaceQuestion,
  onReplaceOptionalChoice,
  onSaveQuestionToBank,
  onImportImage,
}: PaperEditorProps) {
  const [draggedQuestion, setDraggedQuestion] = useState<DraggedQuestion | null>(null);
  const [expandedAnswers, setExpandedAnswers] = useState<Record<string, boolean>>({});
  const [replacingQuestions, setReplacingQuestions] = useState<Record<string, boolean>>({});
  const [replacingChoices, setReplacingChoices] = useState<Record<string, boolean>>({});

  const stats = useMemo(() => (paper ? calculateStats(paper) : null), [paper]);

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
    onPaperChange(recalculatePaper(updater(paper)));
  };

  const updateSection = (sectionId: string, patch: Partial<PaperSection>) => {
    updatePaper((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    }));
  };

  const updateQuestion = (sectionId: string, questionId: string, patch: Partial<PaperQuestion>) => {
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

  const addInternalChoice = (sectionId: string, questionId: string) => {
    const section = paper.sections.find((item) => item.id === sectionId);
    const question = section?.questions.find((item) => item.id === questionId);

    updateQuestion(sectionId, questionId, {
      optionalChoice: questionToChoice(question),
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
          label: String.fromCharCode(97 + subparts.length),
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

  const deleteSubpart = (sectionId: string, questionId: string, subpartId: string) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    if (!question?.subparts) return;

    updateQuestion(sectionId, questionId, {
      subparts: question.subparts
        .filter((subpart) => subpart.id !== subpartId)
        .map((subpart, index) => ({ ...subpart, label: String.fromCharCode(97 + index) })),
    });
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

  const updateSubpartChoice = (sectionId: string, questionId: string, subpartId: string, patch: Partial<NonNullable<PaperSubpart["optionalChoice"]>>) => {
    const question = paper.sections.find((section) => section.id === sectionId)?.questions.find((item) => item.id === questionId);
    const subpart = question?.subparts?.find((item) => item.id === subpartId);
    if (!subpart?.optionalChoice) return;

    updateSubpart(sectionId, questionId, subpartId, {
      optionalChoice: { ...subpart.optionalChoice, ...patch },
    });
  };

  const removeSubpartChoice = (sectionId: string, questionId: string, subpartId: string) => {
    updateSubpart(sectionId, questionId, subpartId, { optionalChoice: undefined });
  };

  const moveQuestionToInternalChoice = (sourceSectionId: string, sourceQuestionId: string, targetQuestionId: string) => {
    if (sourceQuestionId === targetQuestionId) return;

    updatePaper((current) => {
      let movingQuestion: PaperQuestion | null = null;

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

  const replaceQuestion = async (sectionId: string, questionId: string, questionNumber: number) => {
    setReplacingQuestions((current) => ({ ...current, [questionId]: true }));

    try {
      await onReplaceQuestion(sectionId, questionId, questionNumber);
    } finally {
      setReplacingQuestions((current) => ({ ...current, [questionId]: false }));
    }
  };

  const replaceInternalChoice = async (sectionId: string, questionId: string, questionNumber: number) => {
    setReplacingChoices((current) => ({ ...current, [questionId]: true }));

    try {
      await onReplaceOptionalChoice(sectionId, questionId, questionNumber);
    } finally {
      setReplacingChoices((current) => ({ ...current, [questionId]: false }));
    }
  };

  const templateName = paper.metadata.format || (paper.metadata.source?.toLowerCase().includes("pyq") ? "Full Syllabus" : "Default");
  const templateTone = templateToneFor(templateName);
  const questionTargets =
    stats &&
    paper.sections.flatMap((section) =>
      section.questions.map((question) => ({
        id: question.id,
        label: `Q${stats.questionNumberById[question.id] ?? "?"}`,
      })),
    );

  return (
    <article
      className={`mx-auto min-h-[1120px] w-full max-w-[900px] border bg-white shadow-sm ${templateTone.articleClass}`}
      style={{
        backgroundColor: documentStyle.pageColor,
        color: documentStyle.textColor,
        fontSize: documentStyle.fontSize,
        lineHeight: documentStyle.lineHeight,
        padding: documentStyle.margin,
      }}
    >
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

      <div className="space-y-8">
        {paper.sections.map((section) => {
          const sectionMarks = section.questions.reduce((total, question) => total + Number(question.marks || 0), 0);

          return (
            <section
              key={section.id}
              className="rounded-lg border border-transparent"
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
                  <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
                    Target
                    <input
                      className="w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      type="number"
                      value={section.targetMarks ?? sectionMarks}
                      onChange={(event) => updateSection(section.id, { targetMarks: Number(event.target.value) })}
                    />
                  </label>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{sectionMarks} marks</span>
                  <button className="editor-mini-button" onClick={() => addBlankQuestion(section.id)} type="button">
                    <Plus size={14} />
                    Add
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

              <div className="space-y-4">
                {section.questions.map((question) => {
                  const questionNumber = stats?.questionNumberById[question.id] ?? 0;
                  const isAnswerOpen = expandedAnswers[question.id] ?? false;
                  const isReplacing = replacingQuestions[question.id] ?? false;
                  const isChoiceReplacing = replacingChoices[question.id] ?? false;

                  return (
                    <div
                      key={question.id}
                      className={`question-row group relative rounded-lg border border-transparent bg-white/70 p-3 transition hover:border-slate-200 hover:bg-slate-50 ${isReplacing ? "ai-replacing border-blue-300 bg-blue-50/70" : ""}`}
                      draggable
                      onDragStart={() => setDraggedQuestion({ sectionId: section.id, questionId: question.id })}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.stopPropagation();
                        moveDraggedQuestion(section.id, question.id);
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col items-center gap-2 pt-2">
                          <GripVertical className="cursor-grab text-slate-400" size={18} />
                          <span className="font-display text-lg font-bold text-slate-950">{questionNumber}.</span>
                        </div>

                        <div className="min-w-0 flex-1 space-y-3">
                          <RichTextEditor
                            label={`Question ${questionNumber}`}
                            minHeight="normal"
                            placeholder="Write the question..."
                            value={question.text}
                            htmlValue={question.richText}
                            onChange={(text) => updateQuestion(section.id, question.id, { text })}
                            onHtmlChange={(richText) => updateQuestion(section.id, question.id, { richText })}
                          />

                          {question.subparts && question.subparts.length > 0 && (
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                              {question.subparts.map((subpart) => (
                                <div key={subpart.id} className="rounded-md border border-slate-200 bg-white p-2">
                                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                                    <span className="rounded bg-slate-100 px-2 py-1 font-black text-slate-800">({subpart.label})</span>
                                    <input
                                      aria-label={`Question ${questionNumber} subpart ${subpart.label} marks`}
                                      className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                                      min={0}
                                      type="number"
                                      value={subpart.marks ?? 0}
                                      onChange={(event) => updateSubpart(section.id, question.id, subpart.id, { marks: Number(event.target.value) })}
                                    />
                                    <span>Marks</span>
                                    <button className="editor-mini-button" onClick={() => addSubpartChoice(section.id, question.id, subpart.id)} type="button">
                                      OR in part
                                    </button>
                                    <button className="editor-mini-button text-red-600" onClick={() => deleteSubpart(section.id, question.id, subpart.id)} type="button">
                                      Delete part
                                    </button>
                                  </div>
                                  <RichTextEditor
                                    label={`Question ${questionNumber} subpart ${subpart.label}`}
                                    minHeight="compact"
                                    placeholder="Write this subpart..."
                                    value={subpart.text}
                                    htmlValue={subpart.richText}
                                    onChange={(text) => updateSubpart(section.id, question.id, subpart.id, { text })}
                                    onHtmlChange={(richText) => updateSubpart(section.id, question.id, subpart.id, { richText })}
                                  />
                                  {subpart.optionalChoice && (
                                    <div className="mt-2 rounded-md border border-dashed border-blue-200 bg-blue-50/60 p-2">
                                      <div className="mb-2 flex items-center justify-between text-xs font-black text-blue-700">
                                        <span>OR for part ({subpart.label})</span>
                                        <button className="editor-mini-button text-red-600" onClick={() => removeSubpartChoice(section.id, question.id, subpart.id)} type="button">
                                          Remove OR
                                        </button>
                                      </div>
                                      <RichTextEditor
                                        label={`Question ${questionNumber} subpart ${subpart.label} OR`}
                                        minHeight="compact"
                                        placeholder="Write the OR alternative for this subpart..."
                                        value={subpart.optionalChoice.text}
                                        htmlValue={subpart.optionalChoice.richText}
                                        onChange={(text) => updateSubpartChoice(section.id, question.id, subpart.id, { text })}
                                        onHtmlChange={(richText) => updateSubpartChoice(section.id, question.id, subpart.id, { richText })}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {question.optionalChoice && (
                            <div className={`choice-row group/choice relative rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-3 ${isChoiceReplacing ? "ai-replacing border-blue-300 bg-blue-100/70" : ""}`}>
                              <div className="mb-2 text-center text-xs font-black text-blue-700">OR</div>
                              <div className="flex items-start gap-3">
                                <div className="pt-2 font-display text-sm font-black text-blue-700">Alt</div>
                                <div className="min-w-0 flex-1 space-y-3">
                                  <RichTextEditor
                                    label={`Question ${questionNumber} internal choice`}
                                    minHeight="compact"
                                    placeholder="Write the internal choice..."
                                    value={question.optionalChoice.text}
                                    htmlValue={question.optionalChoice.richText}
                                    onChange={(text) => updateInternalChoice(section.id, question.id, { text })}
                                    onHtmlChange={(richText) => updateInternalChoice(section.id, question.id, { richText })}
                                  />
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
                                      onChange={(event) => updateInternalChoice(section.id, question.id, { type: event.target.value })}
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
                                      onChange={(answer) => updateInternalChoice(section.id, question.id, { answer })}
                                      onHtmlChange={(answerRichText) => updateInternalChoice(section.id, question.id, { answerRichText })}
                                    />
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-col gap-1 opacity-100 lg:opacity-0 lg:transition lg:group-hover/choice:opacity-100">
                                  <button className="editor-icon-button" disabled={isChoiceReplacing} title="Replace OR with AI" onClick={() => void replaceInternalChoice(section.id, question.id, questionNumber)} type="button">
                                    <RefreshCcw className={isChoiceReplacing ? "animate-spin" : ""} size={15} />
                                  </button>
                                  <button className="editor-icon-button" title="Duplicate OR into a normal question" onClick={() => duplicateOptionalChoiceAsQuestion(section.id, question.id)} type="button">
                                    <Copy size={15} />
                                  </button>
                                  <button className="editor-icon-button" title="Show OR answer" onClick={() => setExpandedAnswers((current) => ({ ...current, [`${question.id}:choice`]: !(current[`${question.id}:choice`] ?? false) }))} type="button">
                                    A
                                  </button>
                                  <button className="editor-icon-button" title="Save OR to question bank" onClick={() => onSaveQuestionToBank(choiceToQuestion(question))} type="button">
                                    <Save size={15} />
                                  </button>
                                  <button className="editor-icon-button text-red-600 hover:bg-red-50" title="Remove OR" onClick={() => removeInternalChoice(section.id, question.id)} type="button">
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                            <input
                              aria-label={`Question ${questionNumber} marks`}
                              className="w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                              min={0}
                              type="number"
                              value={question.marks}
                              onChange={(event) => updateQuestion(section.id, question.id, { marks: Number(event.target.value) })}
                            />
                            <span>Marks</span>
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
                            <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{question.source || "Manual"}</span>
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
                                  <option key={target.id} value={target.id}>
                                    {target.label}
                                  </option>
                                ))}
                            </select>
                          </div>

                          {isAnswerOpen && (
                            <RichTextEditor
                              label={`Question ${questionNumber} answer`}
                              minHeight="answer"
                              placeholder="Write answer / marking scheme..."
                              value={question.answer}
                              htmlValue={question.answerRichText}
                              onChange={(answer) => updateQuestion(section.id, question.id, { answer })}
                              onHtmlChange={(answerRichText) => updateQuestion(section.id, question.id, { answerRichText })}
                            />
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col gap-1 opacity-100 lg:opacity-0 lg:transition lg:group-hover:opacity-100">
                          <button className="editor-icon-button" disabled={isReplacing} title="Replace with AI" onClick={() => void replaceQuestion(section.id, question.id, questionNumber)} type="button">
                            <RefreshCcw className={isReplacing ? "animate-spin" : ""} size={15} />
                          </button>
                          <button className="editor-icon-button" title="Duplicate" onClick={() => duplicateQuestion(section.id, question.id)} type="button">
                            <Copy size={15} />
                          </button>
                          <button className="editor-icon-button" title="Add internal choice" onClick={() => addInternalChoice(section.id, question.id)} type="button">
                            OR
                          </button>
                          <button className="editor-icon-button" title="Add subpart" onClick={() => addSubpart(section.id, question.id)} type="button">
                            (a)
                          </button>
                          <button className="editor-icon-button" title="Show answer" onClick={() => setExpandedAnswers((current) => ({ ...current, [question.id]: !isAnswerOpen }))} type="button">
                            A
                          </button>
                          <button className="editor-icon-button" title="Save to question bank" onClick={() => onSaveQuestionToBank(question)} type="button">
                            <Save size={15} />
                          </button>
                          <button className="editor-icon-button text-red-600 hover:bg-red-50" title="Delete" onClick={() => deleteQuestion(section.id, question.id)} type="button">
                            <Trash2 size={15} />
                          </button>
                        </div>
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
          );
        })}
      </div>
    </article>
  );
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

function questionToChoice(question?: PaperQuestion): NonNullable<PaperQuestion["optionalChoice"]> {
  return {
    id: crypto.randomUUID(),
    text: "",
    richText: "",
    marks: question?.marks ?? 1,
    type: question?.type ?? "SA",
    difficulty: question?.difficulty ?? "Medium",
    source: "Manual OR",
    topic: question?.topic,
    answer: "",
    answerRichText: "",
  };
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
    answer: choice?.answer || "",
    answerRichText: choice?.answerRichText || "",
  };
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
      totalMarks += Number(question.marks || 0);
      const topic = question.topic || paper.metadata.topic || paper.metadata.chapter || section.title || "Unassigned";
      topicMarks.set(topic, (topicMarks.get(topic) || 0) + Number(question.marks || 0));
    });
  });

  const topicWeights = Array.from(topicMarks.entries()).map(([topic, marks]) => ({
    topic,
    marks,
    percent: totalMarks > 0 ? Math.round((marks / totalMarks) * 100) : 0,
  }));

  return { questionNumberById, totalMarks, questionCount, topicWeights };
}

function recalculatePaper(paper: Paper): Paper {
  const totalMarks = paper.sections.reduce(
    (paperTotal, section) => paperTotal + section.questions.reduce((sectionTotal, question) => sectionTotal + Number(question.marks || 0), 0),
    0,
  );
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

function formatDuration(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"} ${remainder} minutes` : `${minutes} minutes`;
}
