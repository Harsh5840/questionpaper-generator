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
  questionTypes: ["MCQ", "Short", "Long"],
  markingScheme: "Standard board pattern",
  difficulty: "Medium",
  totalMarks: 80,
  durationMinutes: 180,
  variantCount: 3,
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
