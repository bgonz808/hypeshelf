"use client";

import { useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type MediaType =
  | "movie"
  | "tv"
  | "book"
  | "music"
  | "podcast"
  | "game"
  | "board-game"
  | "other";

interface Recommendation {
  _id: Id<"recommendations">;
  title: string;
  mediaType: MediaType;
  genre?: string;
  coverUrl?: string;
  link: string;
  blurb: string;
  userName: string; // "????" for unauthenticated users
  userId: string | null; // null for unauthenticated users (PII redacted)
  likeCount: number;
  isStaffPick: boolean;
  createdAt: number;
}

interface RecommendationCardProps {
  recommendation: Recommendation;
  showStaffBadge?: boolean;
}

// Media types grouped by content category (semantic meaning)
const MEDIA_TYPE_CONFIG: Record<
  MediaType,
  { label: string; emoji: string; color: string }
> = {
  // Entertainment: energetic, exciting content
  movie: {
    label: "Movie",
    emoji: "🎬",
    color: "bg-cat-entertainment text-cat-entertainment",
  },
  tv: {
    label: "TV",
    emoji: "📺",
    color: "bg-cat-entertainment text-cat-entertainment",
  },
  game: {
    label: "Video Game",
    emoji: "🎮",
    color: "bg-cat-entertainment text-cat-entertainment",
  },
  "board-game": {
    label: "Board Game",
    emoji: "🎲",
    color: "bg-cat-entertainment text-cat-entertainment",
  },
  // Knowledge: calm, trustworthy content
  book: {
    label: "Book",
    emoji: "📚",
    color: "bg-cat-knowledge text-cat-knowledge",
  },
  podcast: {
    label: "Podcast",
    emoji: "🎙️",
    color: "bg-cat-knowledge text-cat-knowledge",
  },
  // Creative: expressive, artistic content
  music: {
    label: "Music",
    emoji: "🎵",
    color: "bg-cat-creative text-cat-creative",
  },
  // Neutral: uncategorized
  other: {
    label: "Other",
    emoji: "✨",
    color: "bg-cat-neutral text-cat-neutral",
  },
};

/** Capitalize a genre slug for display (e.g. "sci-fi" → "Sci-Fi", "rock" → "Rock") */
function formatGenreLabel(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function RecommendationCard({
  recommendation,
  showStaffBadge = true,
}: RecommendationCardProps) {
  const toggleLike = useMutation(api.likes.toggle);
  const hasLiked = useQuery(api.likes.hasLiked, {
    recommendationId: recommendation._id,
  });

  const mediaType = MEDIA_TYPE_CONFIG[recommendation.mediaType];
  const genreLabel = recommendation.genre
    ? formatGenreLabel(recommendation.genre)
    : null;

  const handleLike = useCallback(async () => {
    try {
      await toggleLike({ recommendationId: recommendation._id });
    } catch (error) {
      // User not authenticated - could show sign-in prompt
      console.error("Like failed:", error);
    }
  }, [toggleLike, recommendation._id]);

  return (
    <article className="bg-surface border-muted rounded-lg border p-4 shadow-xs transition-shadow hover:shadow-md">
      {/* Header: Media type badge, genre badge, staff pick, time */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${mediaType.color}`}
          >
            <span aria-hidden="true">{mediaType.emoji}</span>
            {mediaType.label}
          </span>
          {genreLabel && (
            <span className="bg-accent-light text-accent inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
              {genreLabel}
            </span>
          )}
          {showStaffBadge && recommendation.isStaffPick && (
            <span className="bg-highlight text-highlight inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
              <span aria-hidden="true">⭐</span>
              Staff Pick
            </span>
          )}
        </div>
        <time
          dateTime={new Date(recommendation.createdAt).toISOString()}
          className="text-muted text-xs"
        >
          {formatTimeAgo(recommendation.createdAt)}
        </time>
      </div>

      {/* Title as link */}
      <h3 className="text-primary mb-2 text-lg font-semibold">
        <a
          href={recommendation.link}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-accent hover:underline"
        >
          {recommendation.title}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </h3>

      {/* Blurb */}
      <p className="text-secondary mb-4 line-clamp-3 text-sm">
        {recommendation.blurb}
      </p>

      {/* Footer: User attribution, likes */}
      <div className="border-muted flex items-center justify-between border-t pt-3">
        <span className="text-muted text-sm">
          by{" "}
          {recommendation.userId === null ? (
            // PII redacted for unauthenticated users - show mystery placeholder
            <span
              className="text-muted cursor-help font-medium"
              title="Sign in to see who recommended this"
            >
              {recommendation.userName}
            </span>
          ) : (
            <span className="text-primary font-medium">
              {recommendation.userName}
            </span>
          )}
        </span>

        <button
          onClick={handleLike}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            hasLiked
              ? "bg-error text-error hover:bg-error"
              : "bg-accent-light text-accent hover:bg-accent-light"
          }`}
          aria-pressed={hasLiked ?? false}
          aria-label={`${hasLiked ? "Unlike" : "Like"} ${recommendation.title}. ${recommendation.likeCount} likes.`}
        >
          <span aria-hidden="true">{hasLiked ? "❤️" : "🤍"}</span>
          <span>{recommendation.likeCount}</span>
        </button>
      </div>
    </article>
  );
}
