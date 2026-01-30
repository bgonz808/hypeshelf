/**
 * Shared types for media search / autocomplete
 */

export const MEDIA_TYPES = [
  "movie",
  "tv",
  "book",
  "music",
  "podcast",
  "game",
  "board-game",
  "other",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export interface MediaSearchResult {
  /** Provider-specific external ID */
  externalId: string;
  /** Display title */
  title: string;
  /** Release year (if available) */
  year?: string;
  /** Cover/poster image URL */
  coverUrl?: string;
  /** Which provider returned this result */
  provider: string;
}
