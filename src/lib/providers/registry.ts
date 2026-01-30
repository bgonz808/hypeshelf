import type { MediaType } from "@/lib/media-search";
import type { MediaProvider } from "./types";
import { openLibraryProvider } from "./openlibrary";
import { musicBrainzProvider } from "./musicbrainz";
import { applePodcastsProvider } from "./apple-podcasts";
import { tmdbProvider } from "./tmdb";
import { rawgProvider } from "./rawg";
import { boardGameGeekProvider } from "./boardgamegeek";

/**
 * All registered providers. Add new providers here.
 */
const ALL_PROVIDERS: MediaProvider[] = [
  tmdbProvider,
  openLibraryProvider,
  musicBrainzProvider,
  applePodcastsProvider,
  rawgProvider,
  boardGameGeekProvider,
];

/**
 * Set of provider IDs that have been disabled by admin.
 * Populated from Convex at startup / on admin change.
 */
const disabledProviders = new Set<string>();

export function setDisabledProviders(ids: string[]): void {
  disabledProviders.clear();
  for (const id of ids) {
    disabledProviders.add(id);
  }
}

/**
 * Get providers for a media type, sorted by priority (ascending).
 * Filters out unconfigured and admin-disabled providers.
 */
export function getProvidersForMediaType(type: MediaType): MediaProvider[] {
  if (type === "other") return [];

  return ALL_PROVIDERS.filter(
    (p) =>
      p.mediaTypes.includes(type) &&
      p.isConfigured() &&
      !disabledProviders.has(p.id)
  ).sort((a, b) => {
    const aPriority = a.priority?.[type] ?? 0;
    const bPriority = b.priority?.[type] ?? 0;
    return aPriority - bPriority;
  });
}

/**
 * Get all providers (for admin UI).
 */
export function getAllProviders(): MediaProvider[] {
  return [...ALL_PROVIDERS];
}
