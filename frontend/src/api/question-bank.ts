/**
 * Question bank hooks.
 * Repoint: replace with useQuery(GET_QUESTION_BANK) + useMutation(SAVE_TO_QUESTION_BANK)
 * from src/graphql/paper-generator/question-bank.graphql.
 */
import { useState, useCallback } from "react";
import { fetchQuestionBankViaApi, saveQuestionToBankViaApi } from "../lib/api";
import type { PaperRequest, PaperQuestion, QuestionBankItem } from "../lib/types";

export function useQuestionBank() {
  const [data, setData] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (request: Partial<PaperRequest> = {}) => {
    setLoading(true);
    try {
      const result = await fetchQuestionBankViaApi(request);
      setData(result);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, fetch };
}

export function useSaveToBank() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const save = useCallback(async (
    question: PaperQuestion,
    request: PaperRequest
  ): Promise<QuestionBankItem | null> => {
    setLoading(true);
    setError(null);
    try {
      return await saveQuestionToBankViaApi(question, request);
    } catch (e) {
      setError(e as Error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return [save, { loading, error }] as const;
}
