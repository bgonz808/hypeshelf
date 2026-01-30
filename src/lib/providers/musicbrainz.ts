import type { MediaProvider } from "./types";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

/**
 * MusicBrainz provider — no API key, requires User-Agent.
 * Rate limit: 1 req/s (strict).
 * Cover art from Cover Art Archive (separate call).
 */
export const musicBrainzProvider: MediaProvider = {
  id: "musicbrainz",
  name: "MusicBrainz",
  mediaTypes: ["music"],
  requiresKey: false,
  priority: { music: 0 },

  search: async (query: string, _mediaType: MediaType) => {
    const url = new URL("https://musicbrainz.org/ws/2/release");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("fmt", "json");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "HypeShelf/1.0 (recommendation-app)",
        Accept: "application/json",
      },
    });

    if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);

    const data = (await res.json()) as {
      releases: Array<{
        id: string;
        title: string;
        date?: string;
        "artist-credit"?: Array<{ name: string }>;
      }>;
    };

    return (data.releases ?? []).map((release): MediaSearchResult => {
      const artist = release["artist-credit"]?.[0]?.name;
      const displayTitle = artist
        ? `${release.title} — ${artist}`
        : release.title;
      const year = release.date ? release.date.substring(0, 4) : undefined;
      // Cover Art Archive URL (may 404 if no art exists)
      const coverUrl = `https://coverartarchive.org/release/${release.id}/front-250`;

      return {
        externalId: release.id,
        title: displayTitle,
        year,
        coverUrl,
        provider: "musicbrainz",
      };
    });
  },

  isConfigured: () => true,
};
