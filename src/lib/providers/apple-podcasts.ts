import type { MediaProvider } from "./types";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

/**
 * iTunes Search API — no key required.
 * Covers podcast and music (fallback).
 * Rate limit: ~20 calls/min.
 */
export const applePodcastsProvider: MediaProvider = {
  id: "itunes",
  name: "iTunes Search",
  mediaTypes: ["podcast", "music"],
  requiresKey: false,
  priority: { podcast: 0, music: 10 },

  search: async (query: string, mediaType: MediaType) => {
    const entity = mediaType === "podcast" ? "podcast" : "album";
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", query);
    url.searchParams.set("entity", entity);
    url.searchParams.set("limit", "8");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`iTunes ${res.status}`);

    const data = (await res.json()) as {
      results: Array<{
        trackId?: number;
        collectionId?: number;
        trackName?: string;
        collectionName?: string;
        artistName?: string;
        releaseDate?: string;
        artworkUrl100?: string;
      }>;
    };

    return data.results.map((item): MediaSearchResult => {
      const title = item.collectionName ?? item.trackName ?? "Unknown";
      const artist = item.artistName;
      const displayTitle = artist ? `${title} — ${artist}` : title;
      const year = item.releaseDate
        ? item.releaseDate.substring(0, 4)
        : undefined;

      return {
        externalId: String(item.collectionId ?? item.trackId ?? ""),
        title: displayTitle,
        year,
        coverUrl: item.artworkUrl100,
        provider: "itunes",
      };
    });
  },

  isConfigured: () => true,
};
