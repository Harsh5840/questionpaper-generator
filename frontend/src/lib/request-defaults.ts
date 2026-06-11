import { PaperRequest } from "./types";

export const defaultRequest: PaperRequest = {
  board: "CBSE",
  classLevel: "10",
  subject: "Maths",
  chapter: "Algebra",
  chapterScope: "single",
  chapters: ["Algebra"],
  topic: "Quadratic Equations",
  source: "NCERT + PYQ",
  questionTypes: ["MCQ", "Short Answer", "Long Answer"],
  sectionBlueprint: [],
  markingScheme: "Standard board pattern",
  difficulty: "Medium",
  difficultyMix: { easy: 20, medium: 60, hard: 20 },
  directSourceMix: { ncertDirect: 40, pyqDirect: 30, questionBank: 0, aiGenerated: 30 },
  sourceWeights: { ncertDirect: 40, pyqDirect: 30, questionBank: 0, aiGenerated: 30 },
  sourceWeightsNormalized: false,
  provider: "gemini",
  totalMarks: 80,
  durationMinutes: 180,
  variantCount: 1,
};

export function requestFromPrompt(prompt: string): PaperRequest {
  return {
    ...defaultRequest,
    chapter: "",
    chapterScope: "single",
    chapters: [],
    topic: "",
    freePrompt: prompt,
  };
}
