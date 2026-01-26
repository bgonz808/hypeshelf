"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Section } from "./Section";
import { RecommendationCard } from "./RecommendationCard";
import { CardSkeleton } from "./CardSkeleton";

export function StaffPicksSection() {
  const staffPicks = useQuery(api.recommendations.getStaffPicks, { limit: 6 });

  return (
    <Section
      title="Staff Picks"
      description="Hand-picked recommendations from our curators"
    >
      {staffPicks === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : staffPicks.length === 0 ? (
        <p className="border-default text-muted rounded-lg border border-dashed p-8 text-center">
          No staff picks yet. Check back soon!
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {staffPicks.map((rec) => (
            <RecommendationCard
              key={rec._id}
              recommendation={rec}
              showStaffBadge={false}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
