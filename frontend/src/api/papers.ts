/**
 * Paper CRUD hooks.
 * To repoint at the host app's GraphQL schema, replace the api.ts calls here
 * with useMutation(SAVE_PAPER_VERSION) / useQuery(GET_PAPER_STRUCTURED) etc.
 * from src/graphql/paper-generator/papers.graphql.
 */
import { useState, useCallback } from "react";
import {
  getPaperViaApi,
  getStructuredPaperViaApi,
  saveVersionViaApi,
  refineViaApi,
} from "../lib/api";
import type { Paper, PaperVersion, Refinement } from "../lib/types";

export function usePaperVersions(paperId: string | undefined) {
  const [data, setData] = useState<{ versions: PaperVersion[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!paperId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getPaperViaApi(paperId);
      setData(result);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  return { data, loading, error, refetch: fetch };
}

export function useStructuredPaper(paperId: string | undefined) {
  const [data, setData] = useState<{ version?: PaperVersion; paper?: Paper } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!paperId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getStructuredPaperViaApi(paperId);
      setData(result);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  return { data, loading, error, refetch: fetch };
}

export function useSavePaper() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const save = useCallback(async (paper: Paper, changeSource: string) => {
    setLoading(true);
    setError(null);
    try {
      return await saveVersionViaApi(paper, changeSource);
    } catch (e) {
      setError(e as Error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return [save, { loading, error }] as const;
}

export function useRefine() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refine = useCallback(async (paper: Paper, instruction: string): Promise<Refinement | null> => {
    setLoading(true);
    setError(null);
    try {
      return await refineViaApi(paper, instruction);
    } catch (e) {
      setError(e as Error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return [refine, { loading, error }] as const;
}
