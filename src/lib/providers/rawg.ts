import type { MediaProvider } from "./types";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

/**
 * RAWG Video Games Database — free API key required.
 * Rate limit: 20k/month, 1k/hour.
 */
export const rawgProvider: MediaProvider = {
  id: "rawg",
  name: "RAWG",
  mediaTypes: ["game"],
  requiresKey: true,
  keyEnvVar: "RAWG_API_KEY",
  priority: { game: 0 },

  search: async (query: string, _mediaType: MediaType) => {
    const apiKey = process.env.RAWG_API_KEY;
    if (!apiKey) throw new Error("RAWG_API_KEY not configured");

    const url = new URL("https://api.rawg.io/api/games");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("search", query);
    url.searchParams.set("page_size", "8");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`RAWG ${res.status}`);

    const data = (await res.json()) as {
      results: Array<{
        id: number;
        name: string;
        released?: string;
        background_image?: string | null;
      }>;
    };

    return (data.results ?? []).map(
      (game): MediaSearchResult => ({
        externalId: String(game.id),
        title: game.name,
        year: game.released ? game.released.substring(0, 4) : undefined,
        coverUrl: game.background_image ?? undefined,
        provider: "rawg",
      })
    );
  },

  isConfigured: () => !!process.env.RAWG_API_KEY,
};
