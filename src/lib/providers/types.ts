import type { MediaType, MediaSearchResult } from "@/lib/media-search";

/**
 * Interface all media search providers must implement.
 * Adding a new provider: create a file, implement this interface, register in registry.ts.
 */
export interface MediaProvider {
  /** Unique identifier (e.g. "tmdb", "openlibrary") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which media types this provider can search */
  mediaTypes: MediaType[];
  /** Whether this provider needs an API key */
  requiresKey: boolean;
  /** Env var name that holds the API key (if requiresKey) */
  keyEnvVar?: string;
  /** Priority per media type — lower number = tried first. Default 0. */
  priority?: Partial<Record<MediaType, number>>;
  /** Search for media by query string */
  search(query: string, mediaType: MediaType): Promise<MediaSearchResult[]>;
  /** Returns true if the provider has the config it needs to operate */
  isConfigured(): boolean;
}
