import type { MediaProvider } from "./types";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

/**
 * Open Library provider — free, no API key required.
 * Covers available via covers.openlibrary.org using cover_i field.
 * Rate limit: informal, ~100 cover requests per 5 min.
 */
export const openLibraryProvider: MediaProvider = {
  id: "openlibrary",
  name: "Open Library",
  mediaTypes: ["book"],
  requiresKey: false,
  priority: { book: 0 },

  search: async (query: string, _mediaType: MediaType) => {
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set(
      "fields",
      "key,title,first_publish_year,cover_i,author_name"
    );

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "HypeShelf/1.0 (recommendation-app)" },
    });

    if (!res.ok) throw new Error(`Open Library ${res.status}`);

    const data = (await res.json()) as {
      docs: Array<{
        key: string;
        title: string;
        first_publish_year?: number;
        cover_i?: number;
        author_name?: string[];
      }>;
    };

    return data.docs.map((doc): MediaSearchResult => {
      const coverUrl = doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${String(doc.cover_i)}-M.jpg`
        : undefined;

      const authorSuffix =
        doc.author_name && doc.author_name.length > 0
          ? ` — ${doc.author_name[0]}`
          : "";

      return {
        externalId: doc.key,
        title: `${doc.title}${authorSuffix}`,
        year: doc.first_publish_year?.toString(),
        coverUrl,
        provider: "openlibrary",
      };
    });
  },

  isConfigured: () => true,
};
