import type { MediaProvider } from "./types";
import type { MediaSearchResult, MediaType } from "@/lib/media-search";

/**
 * BoardGameGeek XML API2 — no key required.
 * Rate limit: ~2 req/s.
 * Returns XML, parsed server-side.
 */
export const boardGameGeekProvider: MediaProvider = {
  id: "bgg",
  name: "BoardGameGeek",
  mediaTypes: ["board-game"],
  requiresKey: false,
  priority: { "board-game": 0 },

  search: async (query: string, _mediaType: MediaType) => {
    const url = new URL("https://boardgamegeek.com/xmlapi2/search");
    url.searchParams.set("query", query);
    url.searchParams.set("type", "boardgame");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`BGG ${res.status}`);

    const xml = await res.text();
    return parseBggXml(xml);
  },

  isConfigured: () => true,
};

/**
 * Minimal XML parser for BGG search results.
 * BGG returns XML like:
 * <items><item type="boardgame" id="123">
 *   <name type="primary" value="Catan"/>
 *   <yearpublished value="1995"/>
 * </item></items>
 *
 * We extract with regex to avoid adding an XML dependency.
 */
async function parseBggXml(xml: string): Promise<MediaSearchResult[]> {
  const results: MediaSearchResult[] = [];
  const itemRegex = /<item\s[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/item>/g;
  const nameRegex = /<name\s[^>]*type="primary"[^>]*value="([^"]*)"[^>]*\/>/;
  const yearRegex = /<yearpublished\s[^>]*value="(\d+)"[^>]*\/>/;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && results.length < 8) {
    const id = match[1];
    const body = match[2];
    if (!id || !body) continue;

    const nameMatch = nameRegex.exec(body);
    if (!nameMatch?.[1]) continue;

    const yearMatch = yearRegex.exec(body);

    results.push({
      externalId: id,
      title: nameMatch[1],
      year: yearMatch?.[1],
      // BGG thumbnail via their CDN — consistent URL pattern
      coverUrl: `https://cf.geekdo-images.com/thumb/img/${id}`,
      provider: "bgg",
    });
  }

  // BGG thumbnails via the thing endpoint need a second call.
  // Use a simpler approach: link to the item page image.
  // Actually, the search API doesn't return thumbnails. We'll fetch
  // details for the top results to get actual thumbnails.
  return enrichBggResults(results);
}

/**
 * Fetch thumbnails for BGG results via the /thing endpoint.
 * One batch call for up to 8 IDs.
 */
async function enrichBggResults(
  results: MediaSearchResult[]
): Promise<MediaSearchResult[]> {
  if (results.length === 0) return results;

  const ids = results.map((r) => r.externalId).join(",");
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${ids}&type=boardgame`;

  try {
    const res = await fetch(url);
    if (!res.ok) return results; // Return without thumbnails on failure

    const xml = await res.text();
    const thumbRegex =
      /<item\s[^>]*id="(\d+)"[^>]*>[\s\S]*?<thumbnail>([\s\S]*?)<\/thumbnail>/g;
    const thumbMap = new Map<string, string>();

    let match: RegExpExecArray | null;
    while ((match = thumbRegex.exec(xml)) !== null) {
      if (match[1] && match[2]) {
        thumbMap.set(match[1], match[2].trim());
      }
    }

    return results.map((r) => ({
      ...r,
      coverUrl: thumbMap.get(r.externalId) ?? undefined,
    }));
  } catch {
    return results; // Graceful degradation
  }
}
