/**
 * Generation hooks + Phoenix WebSocket wrapper.
 * To repoint at the host's GQL: replace generateViaApi with useMutation(START_GENERATION)
 * from src/graphql/paper-generator/generation.graphql.
 * The Phoenix socket stays as-is (it's a real-time channel, not a REST endpoint).
 */
import { useState, useCallback } from "react";
import {
  generateViaApi,
  fetchUsageViaApi,
  fetchDashboardViaApi,
} from "../lib/api";
import type { Paper, GenerationStatus, AiUsageSummary, DashboardSummary, PaperRequest } from "../lib/types";

type GenerationCallbacks = {
  onStatus?: (status: GenerationStatus) => void;
};

export function useGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const generate = useCallback(async (
    request: PaperRequest,
    callbacks: GenerationCallbacks = {}
  ): Promise<Paper[]> => {
    setLoading(true);
    setError(null);
    try {
      return await generateViaApi(request, callbacks);
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Generation failed");
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return [generate, { loading, error }] as const;
}

export function useGenerationUsage(runId: string | undefined) {
  const [data, setData] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const result = await fetchUsageViaApi(runId);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  return { data, loading, refetch: fetch };
}

export function useDashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchDashboardViaApi();
      setData(result);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, refetch: fetch };
}
