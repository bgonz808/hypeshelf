import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Media type enum for recommendations
 * The type of media being recommended
 */
export const mediaTypes = v.union(
  v.literal("movie"),
  v.literal("tv"),
  v.literal("book"),
  v.literal("music"),
  v.literal("podcast"),
  v.literal("game"),
  v.literal("other")
);

/**
 * Genre enum for recommendations
 * The content genre/category (optional, varies by media type)
 */
export const genres = v.union(
  // Drama/Narrative
  v.literal("drama"),
  v.literal("comedy"),
  v.literal("romance"),
  v.literal("thriller"),
  v.literal("horror"),
  v.literal("action"),
  v.literal("adventure"),
  // Speculative
  v.literal("sci-fi"),
  v.literal("fantasy"),
  v.literal("mystery"),
  // Non-fiction
  v.literal("documentary"),
  v.literal("biography"),
  v.literal("history"),
  v.literal("true-crime"),
  // Other
  v.literal("animation"),
  v.literal("kids"),
  v.literal("indie"),
  v.literal("other")
);

export default defineSchema({
  /**
   * Recommendations table
   * Stores all user recommendations with denormalized user info
   */
  recommendations: defineTable({
    // Content fields
    title: v.string(),
    mediaType: mediaTypes,
    genre: v.optional(genres), // Optional content genre (horror, comedy, etc.)
    link: v.string(), // URL to the content
    blurb: v.string(), // User's recommendation text

    // User fields (denormalized from Clerk for display)
    userId: v.string(), // Clerk user ID
    userName: v.string(), // Display name at time of creation

    // Engagement
    likeCount: v.number(), // Denormalized for fast sorting

    // Admin fields
    isStaffPick: v.boolean(),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Index for listing by creation date (public feed)
    .index("by_creation", ["createdAt"])
    // Index for filtering by media type
    .index("by_media_type", ["mediaType", "createdAt"])
    // Index for filtering by genre
    .index("by_genre", ["genre", "createdAt"])
    // Index for user's own recommendations
    .index("by_user", ["userId", "createdAt"])
    // Index for staff picks
    .index("by_staff_pick", ["isStaffPick", "createdAt"])
    // Index for popular (most liked)
    .index("by_likes", ["likeCount", "createdAt"]),

  /**
   * Likes table
   * Tracks user likes for recommendations (enables unlike, prevents duplicates)
   */
  likes: defineTable({
    userId: v.string(), // Clerk user ID
    recommendationId: v.id("recommendations"),
    createdAt: v.number(),
  })
    // Unique constraint: one like per user per recommendation
    .index("by_user_and_rec", ["userId", "recommendationId"])
    // For counting likes on a recommendation
    .index("by_recommendation", ["recommendationId"])
    // For "hot" queries (recent likes)
    .index("by_creation", ["createdAt"]),
});
