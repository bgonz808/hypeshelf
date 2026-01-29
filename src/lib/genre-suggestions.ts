/**
 * Curated genre suggestions per media type.
 * Predefined picks store the slug key (locale-independent).
 * Custom entries are stored as user-typed text (trimmed, lowercased).
 */

export type MediaType =
  | "movie"
  | "tv"
  | "book"
  | "music"
  | "podcast"
  | "game"
  | "board-game"
  | "other";

export interface GenreSuggestion {
  /** Slug stored in the database (locale-independent key) */
  value: string;
  /** i18n key under the "genres" namespace, e.g. "genres.rock" */
  labelKey: string;
}

const genre = (slug: string): GenreSuggestion => ({
  value: slug,
  labelKey: `genres.${slug}`,
});

export const GENRE_SUGGESTIONS: Record<MediaType, GenreSuggestion[]> = {
  movie: [
    "action",
    "adventure",
    "animation",
    "comedy",
    "documentary",
    "drama",
    "fantasy",
    "horror",
    "mystery",
    "romance",
    "sci-fi",
    "thriller",
    "biography",
    "history",
    "kids",
    "indie",
  ].map(genre),
  tv: [
    "action",
    "animation",
    "comedy",
    "documentary",
    "drama",
    "fantasy",
    "horror",
    "mystery",
    "romance",
    "sci-fi",
    "thriller",
    "true-crime",
    "biography",
    "history",
    "kids",
    "indie",
  ].map(genre),
  book: [
    "biography",
    "comedy",
    "drama",
    "fantasy",
    "history",
    "horror",
    "mystery",
    "romance",
    "sci-fi",
    "thriller",
    "true-crime",
    "kids",
    "indie",
  ].map(genre),
  music: [
    "rock",
    "pop",
    "hip-hop",
    "r-and-b",
    "jazz",
    "classical",
    "electronic",
    "country",
    "folk",
    "metal",
    "punk",
    "soul",
    "blues",
    "latin",
    "indie",
    "alternative",
  ].map(genre),
  podcast: [
    "comedy",
    "true-crime",
    "documentary",
    "history",
    "biography",
    "sci-fi",
    "horror",
    "kids",
  ].map(genre),
  game: [
    "action",
    "adventure",
    "rpg",
    "strategy",
    "simulation",
    "puzzle",
    "horror",
    "platformer",
    "fps",
    "mmo",
    "racing",
    "sports",
    "indie",
  ].map(genre),
  "board-game": [
    "strategy",
    "party",
    "cooperative",
    "deck-building",
    "worker-placement",
    "area-control",
    "roll-and-write",
    "family",
    "kids",
    "adventure",
  ].map(genre),
  other: [],
};

/**
 * Get genre suggestions for a given media type.
 * Returns an array of { value, labelKey } objects.
 */
export function getGenreSuggestionsForMediaType(
  mediaType: MediaType
): GenreSuggestion[] {
  return GENRE_SUGGESTIONS[mediaType] ?? [];
}
