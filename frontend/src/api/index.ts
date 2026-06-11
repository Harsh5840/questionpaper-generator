/**
 * Single-swap API layer.
 * All network calls flow through this file. To repoint at the host app's
 * GraphQL mutations, replace the delegating imports below with Apollo hooks
 * from src/graphql/paper-generator/*.graphql.
 */
export {
  fetchDashboardViaApi,
  generateViaApi,
  refineViaApi,
  saveVersionViaApi,
  getPaperViaApi,
  getStructuredPaperViaApi,
  fetchChaptersViaApi,
  fetchSubjectsViaApi,
  fetchRetrievalPreviewViaApi,
  fetchQuestionBankViaApi,
  saveQuestionToBankViaApi,
  importQuestionFromSourceViaApi,
  importQuestionFromImageViaApi,
  uploadImageAssetViaApi,
  fetchUsageViaApi,
} from "../lib/api";

// React hooks (Apollo-style { data, loading, error }) for each domain:
export { usePaperVersions, useStructuredPaper, useSavePaper, useRefine } from "./papers";
export { useGenerate, useGenerationUsage, useDashboard } from "./generation";
export { useCatalogSubjects, useCatalogChapters } from "./catalog";
export { useRetrievalPreview, useImportFromSource, useImportFromImage } from "./retrieval";
export { useQuestionBank, useSaveToBank } from "./question-bank";
export { useUploadImage } from "./assets";
