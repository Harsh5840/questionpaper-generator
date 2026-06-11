/**
 * Retrieval + question import hooks.
 * Repoint: replace with useMutation(IMPORT_QUESTION_FROM_SOURCE / IMPORT_FROM_IMAGE)
 * from src/graphql/paper-generator/retrieval.graphql.
 */
import { useState, useCallback } from "react";
import {
  fetchRetrievalPreviewViaApi,
  importQuestionFromSourceViaApi,
  importQuestionFromImageViaApi,
} from "../lib/api";
import type { PaperRequest, PaperQuestion, RetrievalPreview } from "../lib/types";

export function useRetrievalPreview() {
  const [data, setData] = useState<RetrievalPreview | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (request: PaperRequest) => {
    setLoading(true);
    try {
      const result = await fetchRetrievalPreviewViaApi(request);
      setData(result);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, fetch };
}

export function useImportFromSource() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const importQuestion = useCallback(async (attrs: {
    sourceType: string;
    id: string;
    request: PaperRequest;
  }): Promise<PaperQuestion> => {
    setLoading(true);
    setError(null);
    try {
      return await importQuestionFromSourceViaApi(attrs);
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Source import failed");
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return [importQuestion, { loading, error }] as const;
}

export function useImportFromImage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const importQuestion = useCallback(async (attrs: {
    fileName: string;
    mimeType: string;
    base64: string;
    request: PaperRequest;
  }): Promise<PaperQuestion> => {
    setLoading(true);
    setError(null);
    try {
      return await importQuestionFromImageViaApi(attrs);
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Image import failed");
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return [importQuestion, { loading, error }] as const;
}
