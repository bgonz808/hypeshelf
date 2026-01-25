import type { Doc } from "../_generated/dataModel";

/**
 * Redact PII from recommendation for unauthenticated users.
 *
 * SECURITY: This is the single source of truth for what data is
 * safe to expose publicly. Never send user info to unauthenticated clients.
 *
 * Redacted fields:
 * - userId: set to null (Clerk user ID is PII)
 * - userName: replaced with "????" placeholder
 */
export function redactRecommendationForPublic(rec: Doc<"recommendations">) {
  return {
    _id: rec._id,
    _creationTime: rec._creationTime,
    title: rec.title,
    mediaType: rec.mediaType,
    genre: rec.genre,
    link: rec.link,
    blurb: rec.blurb,
    likeCount: rec.likeCount,
    isStaffPick: rec.isStaffPick,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    // Redacted fields - placeholder for unauthenticated users
    userId: null as string | null,
    userName: "????",
  };
}

/**
 * Type for a redacted recommendation (userId can be null)
 */
export type PublicRecommendation = ReturnType<
  typeof redactRecommendationForPublic
>;
