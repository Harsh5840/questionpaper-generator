/**
 * Catalog hooks (subjects + chapters).
 * Repoint: replace with useQuery(GET_CATALOG_SUBJECTS/CHAPTERS)
 * from src/graphql/paper-generator/catalog.graphql.
 */
import { useState, useCallback } from "react";
import { fetchSubjectsViaApi, fetchChaptersViaApi } from "../lib/api";
import type { CatalogSubject, PaperRequest } from "../lib/types";

export function useCatalogSubjects() {
  const [data, setData] = useState<CatalogSubject[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (request: Pick<PaperRequest, "board" | "classLevel">) => {
    setLoading(true);
    try {
      const result = await fetchSubjectsViaApi(request);
      setData(result);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, fetch };
}

export function useCatalogChapters() {
  const [data, setData] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (request: Pick<PaperRequest, "board" | "classLevel" | "subject">) => {
    setLoading(true);
    try {
      const result = await fetchChaptersViaApi(request);
      setData(result);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, fetch };
}
