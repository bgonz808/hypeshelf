import { NextRequest, NextResponse } from "next/server";
import { getProvidersForMediaType } from "@/lib/providers/registry";
import type { MediaType } from "@/lib/media-search";
import { MEDIA_TYPES } from "@/lib/media-search";

/**
 * In-memory cache: key → { data, timestamp }
 * TTL: 60 seconds. Cleared on server restart.
 */
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 60_000;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim();
  const type = searchParams.get("type") as MediaType | null;

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  if (!type || !MEDIA_TYPES.includes(type) || type === "other") {
    return NextResponse.json([]);
  }

  const cacheKey = `${type}:${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const providers = getProvidersForMediaType(type);

  for (const provider of providers) {
    try {
      const results = await provider.search(q, type);
      if (results.length > 0) {
        const sliced = results.slice(0, 8);
        cache.set(cacheKey, { data: sliced, timestamp: Date.now() });
        return NextResponse.json(sliced);
      }
    } catch (err) {
      console.warn(`Provider ${provider.id} failed:`, err);
    }
  }

  return NextResponse.json([]);
}
