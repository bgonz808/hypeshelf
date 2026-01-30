import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { rankByScore, getAlgorithmConfig } from "./scoring";
import { redactRecommendationForPublic } from "./lib/redaction";
import { MS_PER_DAY } from "../src/lib/temporal-constants";

/**
 * Toggle like on a recommendation
 * If already liked, unlikes. If not liked, likes.
 */
export const toggle = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject;

    // Check if already liked
    const existing = await ctx.db
      .query("likes")
      .withIndex("by_user_and_rec", (q) =>
        q.eq("userId", userId).eq("recommendationId", args.recommendationId)
      )
      .unique();

    const recommendation = await ctx.db.get(args.recommendationId);
    if (!recommendation) {
      throw new Error("Recommendation not found");
    }

    if (existing) {
      // Unlike: remove like and decrement count
      await ctx.db.delete(existing._id);
      await ctx.db.patch(args.recommendationId, {
        likeCount: Math.max(0, recommendation.likeCount - 1),
        updatedAt: Date.now(),
      });
      return { liked: false };
    } else {
      // Like: add like and increment count
      await ctx.db.insert("likes", {
        userId,
        recommendationId: args.recommendationId,
        createdAt: Date.now(),
      });
      await ctx.db.patch(args.recommendationId, {
        likeCount: recommendation.likeCount + 1,
        updatedAt: Date.now(),
      });
      return { liked: true };
    }
  },
});

/**
 * Check if current user has liked a recommendation
 */
export const hasLiked = query({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return false;
    }

    const existing = await ctx.db
      .query("likes")
      .withIndex("by_user_and_rec", (q) =>
        q
          .eq("userId", identity.subject)
          .eq("recommendationId", args.recommendationId)
      )
      .unique();

    return !!existing;
  },
});

/**
 * Get all recommendation IDs that current user has liked
 * Useful for batch checking on feed pages
 */
export const myLikedIds = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const likes = await ctx.db
      .query("likes")
      .withIndex("by_user_and_rec", (q) => q.eq("userId", identity.subject))
      .collect();

    return likes.map((like) => like.recommendationId);
  },
});

/**
 * Get "hot" recommendations using configurable scoring algorithm
 *
 * SECURITY: PII redacted for unauthenticated users
 */
export const getHot = query({
  args: {
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
    algorithm: v.optional(v.string()), // Algorithm name override for testing
  },
  handler: async (ctx, args) => {
    const days = args.days ?? 7;
    const limit = args.limit ?? 10;
    const cutoff = Date.now() - days * MS_PER_DAY;

    // Get algorithm config (supports A/B testing via user identity)
    const identity = await ctx.auth.getUserIdentity();
    const isAuthenticated = !!identity;
    const config = args.algorithm
      ? { name: args.algorithm as any, params: {} }
      : getAlgorithmConfig(identity?.subject);

    // Get recent likes for "recentLikes" scoring data
    const recentLikes = await ctx.db
      .query("likes")
      .withIndex("by_creation", (q) => q.gte("createdAt", cutoff))
      .collect();

    // Count recent likes per recommendation
    const recentLikeCounts = new Map<string, number>();
    for (const like of recentLikes) {
      const id = like.recommendationId as string;
      recentLikeCounts.set(id, (recentLikeCounts.get(id) ?? 0) + 1);
    }

    // Get all recommendations with recent activity
    const recIds = [...new Set(recentLikes.map((l) => l.recommendationId))];
    const recommendations = await Promise.all(
      recIds.map((id) => ctx.db.get(id))
    );

    // Build scored items
    const scoredItems = recommendations.filter(Boolean).map((rec) => ({
      id: rec!._id as string,
      likeCount: rec!.likeCount,
      createdAt: rec!.createdAt,
      recentLikes: recentLikeCounts.get(rec!._id as string) ?? 0,
      score: 0,
      _rec: rec,
    }));

    // Rank using configured algorithm
    const ranked = rankByScore(scoredItems, config);

    // Return top N with full recommendation data
    // SECURITY: Redact PII for unauthenticated users
    const topItems = ranked.slice(0, limit).map((item) => (item as any)._rec);

    if (!isAuthenticated) {
      return topItems.map(redactRecommendationForPublic);
    }

    return topItems;
  },
});
