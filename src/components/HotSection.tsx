"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Section } from "./Section";
import { RecommendationCard } from "./RecommendationCard";
import { CardSkeleton } from "./CardSkeleton";

export function HotSection() {
  const hotRecs = useQuery(api.likes.getHot, { days: 7, limit: 6 });

  return (
    <Section
      title="Hot Right Now"
      description="Trending recommendations based on recent engagement"
    >
      {hotRecs === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : hotRecs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          Nothing trending yet. Be the first to like something!
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hotRecs.map((rec) => (
            <RecommendationCard key={rec._id} recommendation={rec} />
          ))}
        </div>
      )}
    </Section>
  );
}
