export type PaperRequest = {
  board: "CBSE" | "ICSE";
  classLevel: "9" | "10" | "11" | "12";
  subject: "Maths" | "Physics" | "Chemistry" | "Biology";
  chapter: string;
  chapterScope: "single" | "multiple" | "full_syllabus";
  chapters: string[];
  topic: string;
  source: "NCERT" | "PYQ" | "NCERT + PYQ";
  questionTypes: string[];
  markingScheme: string;
  difficulty: "Easy" | "Medium" | "Hard";
  totalMarks: number;
  durationMinutes: number;
  variantCount: number;
  freePrompt?: string;
  template?: PaperTemplate | null;
};

export type PaperTemplate = {
  name: string;
  description?: string;
  instructions?: string;
  sections?: string[];
  inferredParams?: Partial<PaperRequest>;
  formatting?: Partial<DocumentStyle>;
  layoutNotes?: string;
  imageNotes?: string;
  markingSchemePosition?: "start" | "end";
  answerKeyPosition?: "inline" | "end" | "separate";
};

export type DocumentStyle = {
  margin: number;
  lineHeight: number;
  fontSize: number;
  textColor: string;
  accentColor: string;
  pageColor: string;
};

export type PaperQuestion = {
  id: string;
  text: string;
  richText?: string;
  marks: number;
  type: string;
  difficulty: string;
  source: string;
  topic?: string;
  tags?: string[];
  sourceCitations?: string[];
  optionalChoice?: {
    text: string;
    richText?: string;
    answer?: string;
    answerRichText?: string;
  };
  imageAssets?: {
    id: string;
    name?: string;
    url?: string;
    mimeType?: string;
  }[];
  answer: string;
  answerRichText?: string;
};

export type PaperSection = {
  id: string;
  title: string;
  instructions: string;
  difficulty?: string;
  targetMarks?: number;
  questions: PaperQuestion[];
};

export type Paper = {
  id: string;
  paperId?: string;
  title: string;
  metadata: {
    board: string;
    classLevel: string;
    subject: string;
    chapter: string;
    topic: string;
    durationMinutes: number;
    source: string;
    format?: string;
    qpCode?: string;
  };
  summary: {
    totalMarks: number;
    questionCount: number;
    difficulty: string;
    sourceCoverage: string;
  };
  sections: PaperSection[];
  sets?: Paper[];
  topicWeightage?: Record<string, number>;
  sourceCitations?: string[];
  retrievalTrace?: RetrievalPreview | null;
  documentStyle?: Partial<DocumentStyle>;
  warnings: string[];
};

export type PaperVersion = {
  id: string;
  versionNumber: number;
  changeSource: string;
  payload: Record<string, unknown>;
  marksTotal?: number;
  insertedAt?: string;
};

export type PaperPatch = {
  op: "replace" | "add";
  path: string;
  value: string | number;
};

export type Refinement = {
  message: string;
  patchOps: PaperPatch[];
  preview: Paper;
};

export type GenerationStatus = {
  runId?: string;
  status: "idle" | "queued" | "running" | "completed" | "failed";
  step: string;
  message: string;
  progress: number;
};

export type RetrievalResult = {
  id: string;
  sourceType: string;
  title: string;
  excerpt: string;
  citation?: string;
  marks?: number;
  difficulty?: string;
  questionType?: string;
  chapter?: string;
  topic?: string;
  sectionLabel?: string;
  sectionType?: string;
};

export type RetrievalSection = {
  name: string;
  sectionType?: string;
  ncert: RetrievalResult[];
  pyq: RetrievalResult[];
};

export type RetrievalChapter = {
  name: string;
  position?: number;
  sections: RetrievalSection[];
};

export type RetrievalPreview = {
  catalog: Record<string, unknown>;
  ncert: RetrievalResult[];
  pyq: RetrievalResult[];
  questionBank: RetrievalResult[];
  sectionSources?: {
    chapters: RetrievalChapter[];
    ncertCount: number;
    pyqCount: number;
  };
  markingScheme: Record<string, unknown>;
  warnings: string[];
};

export type QuestionBankItem = {
  id: string;
  text: string;
  richText?: string;
  answer?: string;
  answerRichText?: string;
  board?: string;
  classLevel?: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  questionType?: string;
  marks?: number;
  difficulty?: string;
  source?: string;
  tags?: string[];
  payload?: Record<string, unknown>;
};

export type AiUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  events: {
    id: string;
    model: string;
    operation: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    insertedAt?: string;
  }[];
};
