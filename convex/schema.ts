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
  v.literal("board-game"),
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
    genre: v.optional(v.string()), // Free-form genre slug or custom text
    coverUrl: v.optional(v.string()), // Cover art/poster URL from provider
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

  /**
   * Provider configurations table
   * Stores admin-managed settings for media search providers
   */
  providerConfigs: defineTable({
    providerId: v.string(),
    enabled: v.boolean(),
    encryptedKey: v.optional(v.string()), // AES-256-GCM encrypted API key
    updatedAt: v.number(),
    updatedBy: v.string(), // Clerk user ID of admin who updated
  }).index("by_provider", ["providerId"]),
});
