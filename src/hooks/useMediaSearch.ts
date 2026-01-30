"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

interface UseMediaSearchOptions {
  debounceMs?: number;
}

interface UseMediaSearchReturn {
  results: MediaSearchResult[];
  isLoading: boolean;
}

/**
 * Client hook for debounced media search autocomplete.
 * Skips if query < 2 chars or type is "other".
 * Uses AbortController to cancel in-flight requests.
 */
export function useMediaSearch(
  query: string,
  mediaType: MediaType,
  options: UseMediaSearchOptions = {}
): UseMediaSearchReturn {
  const { debounceMs = 300 } = options;
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [fetchCount, setFetchCount] = useState(0);
  const [resolveCount, setResolveCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const shouldSearch = trimmed.length >= 2 && mediaType !== "other";

  useEffect(() => {
    if (!shouldSearch) {
      return;
    }

    const timeout = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setFetchCount((c) => c + 1);

      const params = new URLSearchParams({ q: trimmed, type: mediaType });

      fetch(`/api/media-search?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
          return res.json() as Promise<MediaSearchResult[]>;
        })
        .then((data) => {
          if (!controller.signal.aborted) {
            setResults(data);
            setResolveCount((c) => c + 1);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setResults([]);
            setResolveCount((c) => c + 1);
          }
        });
    }, debounceMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [trimmed, mediaType, debounceMs, shouldSearch]);

  const isLoading = useMemo(
    () => shouldSearch && fetchCount > resolveCount,
    [shouldSearch, fetchCount, resolveCount]
  );

  const effectiveResults = shouldSearch ? results : [];

  return { results: effectiveResults, isLoading };
}
