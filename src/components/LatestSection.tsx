"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Section } from "./Section";
import { RecommendationCard } from "./RecommendationCard";
import { CardSkeleton } from "./CardSkeleton";

type MediaType =
  | "movie"
  | "tv"
  | "book"
  | "music"
  | "podcast"
  | "game"
  | "other";

const MEDIA_TYPES: { value: MediaType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
  { value: "book", label: "Books" },
  { value: "music", label: "Music" },
  { value: "podcast", label: "Podcasts" },
  { value: "game", label: "Games" },
  { value: "other", label: "Other" },
];

export function LatestSection() {
  const [selectedMediaType, setSelectedMediaType] = useState<MediaType | "all">(
    "all"
  );

  const latestRecs = useQuery(api.recommendations.list, {
    mediaType: selectedMediaType === "all" ? undefined : selectedMediaType,
    limit: 12,
  });

  return (
    <Section
      title="Latest"
      description="Fresh recommendations from the community"
    >
      {/* Media type filter tabs */}
      <div
        className="mb-6 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Filter by media type"
      >
        {MEDIA_TYPES.map((type) => (
          <button
            key={type.value}
            onClick={() => setSelectedMediaType(type.value)}
            role="tab"
            aria-selected={selectedMediaType === type.value}
            aria-controls="latest-recommendations"
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              selectedMediaType === type.value
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div id="latest-recommendations" role="tabpanel">
        {latestRecs === undefined ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : latestRecs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
            No recommendations in this category yet. Be the first to add one!
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {latestRecs.map((rec) => (
              <RecommendationCard key={rec._id} recommendation={rec} />
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
