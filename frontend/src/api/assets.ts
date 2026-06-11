/**
 * Asset upload hook.
 * Repoint: replace with useMutation(UPLOAD_IMAGE)
 * from src/graphql/paper-generator/assets.graphql.
 */
import { useState, useCallback } from "react";
import { uploadImageAssetViaApi } from "../lib/api";
import type { PaperImageAsset } from "../lib/types";

export function useUploadImage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upload = useCallback(async (file: File): Promise<PaperImageAsset> => {
    setLoading(true);
    setError(null);
    try {
      return await uploadImageAssetViaApi(file);
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Upload failed");
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return [upload, { loading, error }] as const;
}
