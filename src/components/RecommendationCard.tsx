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
  | "other";
type Genre =
  | "drama"
  | "comedy"
  | "romance"
  | "thriller"
  | "horror"
  | "action"
  | "adventure"
  | "sci-fi"
  | "fantasy"
  | "mystery"
  | "documentary"
  | "biography"
  | "history"
  | "true-crime"
  | "animation"
  | "kids"
  | "indie"
  | "other";

interface Recommendation {
  _id: Id<"recommendations">;
  title: string;
  mediaType: MediaType;
  genre?: Genre;
  link: string;
  blurb: string;
  userName: string;
  likeCount: number;
  isStaffPick: boolean;
  createdAt: number;
}

interface RecommendationCardProps {
  recommendation: Recommendation;
  showStaffBadge?: boolean;
}

const MEDIA_TYPE_CONFIG: Record<
  MediaType,
  { label: string; emoji: string; color: string }
> = {
  movie: { label: "Movie", emoji: "🎬", color: "bg-red-100 text-red-800" },
  tv: { label: "TV", emoji: "📺", color: "bg-purple-100 text-purple-800" },
  book: { label: "Book", emoji: "📚", color: "bg-amber-100 text-amber-800" },
  music: { label: "Music", emoji: "🎵", color: "bg-green-100 text-green-800" },
  podcast: {
    label: "Podcast",
    emoji: "🎙️",
    color: "bg-blue-100 text-blue-800",
  },
  game: { label: "Game", emoji: "🎮", color: "bg-indigo-100 text-indigo-800" },
  other: { label: "Other", emoji: "✨", color: "bg-gray-100 text-gray-800" },
};

const GENRE_CONFIG: Record<Genre, { label: string }> = {
  drama: { label: "Drama" },
  comedy: { label: "Comedy" },
  romance: { label: "Romance" },
  thriller: { label: "Thriller" },
  horror: { label: "Horror" },
  action: { label: "Action" },
  adventure: { label: "Adventure" },
  "sci-fi": { label: "Sci-Fi" },
  fantasy: { label: "Fantasy" },
  mystery: { label: "Mystery" },
  documentary: { label: "Documentary" },
  biography: { label: "Biography" },
  history: { label: "History" },
  "true-crime": { label: "True Crime" },
  animation: { label: "Animation" },
  kids: { label: "Kids" },
  indie: { label: "Indie" },
  other: { label: "Other" },
};

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
  const genre = recommendation.genre
    ? GENRE_CONFIG[recommendation.genre]
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
    <article className="rounded-lg border border-brand-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-brand-800 dark:bg-dark-bg">
      {/* Header: Media type badge, genre badge, staff pick, time */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${mediaType.color}`}
          >
            <span aria-hidden="true">{mediaType.emoji}</span>
            {mediaType.label}
          </span>
          {genre && (
            <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-200">
              {genre.label}
            </span>
          )}
          {showStaffBadge && recommendation.isStaffPick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
              <span aria-hidden="true">⭐</span>
              Staff Pick
            </span>
          )}
        </div>
        <time
          dateTime={new Date(recommendation.createdAt).toISOString()}
          className="text-xs text-brand-500 dark:text-brand-300"
        >
          {formatTimeAgo(recommendation.createdAt)}
        </time>
      </div>

      {/* Title as link */}
      <h3 className="mb-2 text-lg font-semibold text-brand-900 dark:text-brand-100">
        <a
          href={recommendation.link}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-brand-600 hover:underline dark:hover:text-brand-300"
        >
          {recommendation.title}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </h3>

      {/* Blurb */}
      <p className="mb-4 line-clamp-3 text-sm text-brand-700 dark:text-brand-200">
        {recommendation.blurb}
      </p>

      {/* Footer: User, likes */}
      <div className="flex items-center justify-between border-t border-brand-100 pt-3 dark:border-brand-800">
        <span className="text-sm text-brand-500 dark:text-brand-300">
          by{" "}
          <span className="font-medium text-brand-700 dark:text-brand-100">
            {recommendation.userName}
          </span>
        </span>

        <button
          onClick={handleLike}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            hasLiked
              ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
              : "bg-brand-100 text-brand-600 hover:bg-brand-200 dark:bg-brand-900 dark:text-brand-200 dark:hover:bg-brand-800"
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
