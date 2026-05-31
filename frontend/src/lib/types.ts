export type PaperRequest = {
  board: "CBSE" | "ICSE";
  classLevel: "6" | "7" | "8" | "9" | "10" | "11" | "12";
  subject: string;
  chapter: string;
  chapterScope: "single" | "multiple" | "full_syllabus";
  chapters: string[];
  topic: string;
  source: "NCERT" | "PYQ" | "NCERT + PYQ";
  questionTypes: string[];
  sectionBlueprint?: SectionBlueprint[];
  markingScheme: string;
  difficulty: "Easy" | "Medium" | "Hard" | "Mixed";
  difficultyMix?: DifficultyMix;
  totalMarks: number;
  durationMinutes: number;
  variantCount: number;
  freePrompt?: string;
  template?: PaperTemplate | null;
  sourceBooks?: string[];
  sourceCategories?: string[];
  directSourceMix?: DirectSourceMix;
  sourceWeights?: DirectSourceMix;
  sourceWeightsNormalized?: boolean;
  provider?: "gemini" | "groq";
};

export type CatalogSubject = {
  value: string;
  label: string;
  chapterCount: number;
  bookCount: number;
  disabled?: boolean;
};

export type DifficultyMix = {
  easy: number;
  medium: number;
  hard: number;
};

export type DirectSourceMix = {
  ncertDirect: number;
  pyqDirect: number;
  questionBank: number;
  aiGenerated: number;
  dumpDirect?: number;
  aiFromDump?: number;
};

export type SectionBlueprint = {
  id: string;
  title: string;
  questionTypes: string[];
  questionCount: number;
  marksEach: number;
  difficulty: "Easy" | "Medium" | "Hard" | "Mixed";
  instructions?: string;
  attemptRule?: AttemptRule;
};

export type AttemptRule = {
  required: number;
  offered: number;
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
  watermark?: {
    text: string;
    opacity: number;
    position: "center" | "diagonal";
  };
};

export type PaperQuestion = {
  id: string;
  text: string;
  richText?: string;
  options?: PaperQuestionOption[];
  marks: number;
  type: string;
  difficulty: string;
  source: string;
  topic?: string;
  tags?: string[];
  sourceCitations?: string[];
  generationMode?: "direct_ncert" | "direct_pyq" | "question_bank" | "ai_generated";
  diagramBlocks?: {
    id: string;
    title: string;
    caption?: string;
    status: "placeholder";
  }[];
  subparts?: PaperSubpart[];
  optionalChoice?: {
    id?: string;
    text: string;
    richText?: string;
    options?: PaperQuestionOption[];
    subparts?: PaperSubpart[];
    imageAssets?: PaperImageAsset[];
    marks?: number;
    type?: string;
    difficulty?: string;
    source?: string;
    topic?: string;
    tags?: string[];
    answer?: string;
    answerRichText?: string;
  };
  imageAssets?: PaperImageAsset[];
  answer: string;
  answerRichText?: string;
};

export type PaperImageAsset = {
  id: string;
  filename?: string;
  name?: string;
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  altText?: string;
  caption?: string;
};

export type PaperQuestionOption = {
  id?: string;
  label?: string;
  text: string;
  richText?: string;
  imageAssets?: PaperImageAsset[];
  isCorrect?: boolean;
};

export type PaperSubpart = {
  id: string;
  label?: string;
  text: string;
  richText?: string;
  options?: PaperQuestionOption[];
  diagramBlocks?: {
    id: string;
    title: string;
    caption?: string;
    status: "placeholder";
  }[];
  imageAssets?: PaperImageAsset[];
  marks?: number;
  answer?: string;
  answerRichText?: string;
  optionalChoice?: {
    id?: string;
    text: string;
    richText?: string;
    options?: PaperQuestionOption[];
    imageAssets?: PaperImageAsset[];
    marks?: number;
    type?: string;
    difficulty?: string;
    source?: string;
    topic?: string;
    tags?: string[];
    answer?: string;
    answerRichText?: string;
  };
};

export type PaperSection = {
  id: string;
  title: string;
  instructions: string;
  difficulty?: string;
  targetMarks?: number;
  attemptRule?: AttemptRule;
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
  sourceMix?: {
    ncert: number;
    pyq: number;
    questionBank: number;
    aiGenerated: number;
    uncited: number;
  };
  pageCount?: number;
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
  citations?: string[];
  marks?: number;
  difficulty?: string;
  questionType?: string;
  chapter?: string;
  topic?: string;
  sectionLabel?: string;
  sectionType?: string;
  bookId?: string;
  bookTitle?: string;
  publisher?: string;
  bookType?: string;
  chapterId?: string;
  sectionTitle?: string;
  page?: number;
  questionId?: string;
  category?: string;
  sourceLabel?: string;
  orderIndex?: number;
  skills?: string[];
  formulas?: string[];
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
  availability?: SourceAvailability;
  sectionSources?: {
    chapters: RetrievalChapter[];
    ncertCount: number;
    pyqCount: number;
  };
  markingScheme: Record<string, unknown>;
  warnings: string[];
};

export type SourceAvailability = {
  books: {
    id: string;
    title: string;
    publisher?: string;
    bookType?: string;
    subject?: string;
    grade?: string;
    questionCount: number;
    chunkCount: number;
    pyqCount: number;
    sourceGroup: string;
  }[];
  categories: {
    category: string;
    count: number;
  }[];
  totals: {
    ncert: number;
    pyq: number;
    questionBank: number;
    questions: number;
    chunks: number;
  };
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
  totalLatencyMs?: number;
  events: {
    id: string;
    provider?: string;
    model: string;
    operation: string;
    latencyMs?: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    insertedAt?: string;
  }[];
};

export type DashboardSummary = {
  counts: {
    papers: number;
    templates: number;
    generationRuns: number;
    completedRuns: number;
    ncertQuestions: number;
    pyqQuestions: number;
    questionBankItems: number;
    chapters: number;
    textbooks: number;
    chunks: number;
    skills: number;
    formulas: number;
  };
  recentPapers: {
    id: string;
    title: string;
    board: string;
    classLevel: string;
    subject: string;
    status: string;
    versionCount: number;
    marksTotal: number;
    updatedAt?: string;
  }[];
  recentRuns: {
    id: string;
    status: string;
    request: Record<string, unknown>;
    insertedAt?: string;
  }[];
  templates: {
    id: string;
    name: string;
    description?: string;
    payload: Record<string, unknown>;
    formatting: Record<string, unknown>;
    inferredParams: Record<string, unknown>;
    updatedAt?: string;
  }[];
  chapterCoverage: {
    id: string;
    name: string;
    position?: number;
    ncertCount: number;
    pyqCount: number;
    bankCount: number;
    totalSources: number;
    coverageScore: number;
  }[];
  difficultyDistribution: {
    difficulty: string;
    count: number;
  }[];
  sourceMix: {
    source: string;
    count: number;
  }[];
};
