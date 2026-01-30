import type { MediaProvider } from "./types";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

/**
 * TMDB (The Movie Database) provider — free API key required.
 * Rate limit: ~40 req/s per IP.
 */
export const tmdbProvider: MediaProvider = {
  id: "tmdb",
  name: "TMDB",
  mediaTypes: ["movie", "tv"],
  requiresKey: true,
  keyEnvVar: "TMDB_API_KEY",
  priority: { movie: 0, tv: 0 },

  search: async (query: string, mediaType: MediaType) => {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) throw new Error("TMDB_API_KEY not configured");

    const endpoint = mediaType === "tv" ? "search/tv" : "search/movie";
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("page", "1");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`TMDB ${res.status}`);

    const data = (await res.json()) as {
      results: Array<{
        id: number;
        title?: string;
        name?: string;
        release_date?: string;
        first_air_date?: string;
        poster_path?: string | null;
      }>;
    };

    return data.results.slice(0, 8).map((item): MediaSearchResult => {
      const title = item.title ?? item.name ?? "Unknown";
      const dateStr = item.release_date ?? item.first_air_date;
      const year = dateStr ? dateStr.substring(0, 4) : undefined;
      const coverUrl = item.poster_path
        ? `https://image.tmdb.org/t/p/w185${item.poster_path}`
        : undefined;

      return {
        externalId: String(item.id),
        title,
        year,
        coverUrl,
        provider: "tmdb",
      };
    });
  },

  isConfigured: () => !!process.env.TMDB_API_KEY,
};
