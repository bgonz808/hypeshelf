import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { mediaTypes } from "./schema";
import type { Doc } from "./_generated/dataModel";
import { redactRecommendationForPublic } from "./lib/redaction";

/**
 * Get the latest recommendations (public, no auth required)
 * Used on the homepage feed
 *
 * SECURITY: PII (userId, userName) is redacted for unauthenticated users.
 * Sign in to see who recommended what.
 */
export const list = query({
  args: {
    mediaType: v.optional(mediaTypes),
    genre: v.optional(v.string()),
    limit: v.optional(v.number()),
    staffPicksOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const isAuthenticated = !!identity;
    const limit = args.limit ?? 20;

    let recommendations: Doc<"recommendations">[];

    // Apply filters (priority: staffPicks > genre > mediaType > creation)
    if (args.staffPicksOnly) {
      recommendations = await ctx.db
        .query("recommendations")
        .withIndex("by_staff_pick", (q) => q.eq("isStaffPick", true))
        .order("desc")
        .take(limit);
    } else if (args.genre) {
      const genre = args.genre;
      recommendations = await ctx.db
        .query("recommendations")
        .withIndex("by_genre", (q) => q.eq("genre", genre))
        .order("desc")
        .take(limit);
    } else if (args.mediaType) {
      const mediaType = args.mediaType;
      recommendations = await ctx.db
        .query("recommendations")
        .withIndex("by_media_type", (q) => q.eq("mediaType", mediaType))
        .order("desc")
        .take(limit);
    } else {
      recommendations = await ctx.db
        .query("recommendations")
        .withIndex("by_creation")
        .order("desc")
        .take(limit);
    }

    // Redact PII for unauthenticated users
    if (!isAuthenticated) {
      return recommendations.map(redactRecommendationForPublic);
    }

    return recommendations;
  },
});

/**
 * Get a single recommendation by ID (public)
 *
 * SECURITY: PII redacted for unauthenticated users
 */
export const get = query({
  args: { id: v.id("recommendations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const rec = await ctx.db.get(args.id);

    if (!rec) return null;

    // Redact for unauthenticated users
    if (!identity) {
      return redactRecommendationForPublic(rec);
    }

    return rec;
  },
});

/**
 * Get staff picks (curated, premium section)
 *
 * SECURITY: PII redacted for unauthenticated users
 */
export const getStaffPicks = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const limit = args.limit ?? 6;

    const picks = await ctx.db
      .query("recommendations")
      .withIndex("by_staff_pick", (q) => q.eq("isStaffPick", true))
      .order("desc")
      .take(limit);

    // Redact for unauthenticated users
    if (!identity) {
      return picks.map(redactRecommendationForPublic);
    }

    return picks;
  },
});

/**
 * Get popular recommendations (most liked overall)
 *
 * SECURITY: PII redacted for unauthenticated users
 */
export const getPopular = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const limit = args.limit ?? 10;

    const popular = await ctx.db
      .query("recommendations")
      .withIndex("by_likes")
      .order("desc")
      .take(limit);

    // Redact for unauthenticated users
    if (!identity) {
      return popular.map(redactRecommendationForPublic);
    }

    return popular;
  },
});

/**
 * Get recommendations by the current user (authenticated)
 */
export const listMine = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const limit = args.limit ?? 50;

    const recommendations = await ctx.db
      .query("recommendations")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(limit);

    return recommendations;
  },
});

/**
 * Create a new recommendation (authenticated)
 */
export const create = mutation({
  args: {
    title: v.string(),
    mediaType: mediaTypes,
    genre: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    link: v.string(),
    blurb: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Validate URL format (basic check, more validation on client)
    try {
      new URL(args.link);
    } catch {
      throw new Error("Invalid URL format");
    }

    // Validate blurb length
    if (args.blurb.length > 500) {
      throw new Error("Blurb must be 500 characters or less");
    }

    // Validate title length
    if (args.title.length > 200) {
      throw new Error("Title must be 200 characters or less");
    }

    // Validate genre length
    if (args.genre && args.genre.trim().length > 50) {
      throw new Error("Genre must be 50 characters or less");
    }

    // Validate cover URL if provided
    if (args.coverUrl) {
      try {
        const coverParsed = new URL(args.coverUrl);
        if (!["http:", "https:"].includes(coverParsed.protocol)) {
          throw new Error("Cover URL must use HTTP or HTTPS");
        }
      } catch {
        throw new Error("Invalid cover URL format");
      }
    }

    const now = Date.now();

    const id = await ctx.db.insert("recommendations", {
      title: args.title.trim(),
      mediaType: args.mediaType,
      genre: args.genre ? args.genre.trim().toLowerCase() : undefined,
      coverUrl: args.coverUrl,
      link: args.link.trim(),
      blurb: args.blurb.trim(),
      userId: identity.subject,
      userName: identity.name ?? identity.email ?? "Anonymous",
      likeCount: 0,
      isStaffPick: false,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Delete a recommendation
 * Users can delete their own; admins can delete any
 */
export const remove = mutation({
  args: { id: v.id("recommendations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const recommendation = await ctx.db.get(args.id);
    if (!recommendation) {
      throw new Error("Recommendation not found");
    }

    // Check authorization: own recommendation OR admin role
    const isOwner = recommendation.userId === identity.subject;
    const isAdmin =
      (identity.publicMetadata as { role?: string })?.role === "admin";

    if (!isOwner && !isAdmin) {
      throw new Error("Not authorized to delete this recommendation");
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/**
 * Toggle staff pick status (admin only)
 */
export const toggleStaffPick = mutation({
  args: { id: v.id("recommendations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Check admin role
    const isAdmin =
      (identity.publicMetadata as { role?: string })?.role === "admin";
    if (!isAdmin) {
      throw new Error("Admin access required");
    }

    const recommendation = await ctx.db.get(args.id);
    if (!recommendation) {
      throw new Error("Recommendation not found");
    }

    await ctx.db.patch(args.id, {
      isStaffPick: !recommendation.isStaffPick,
      updatedAt: Date.now(),
    });

    return { success: true, isStaffPick: !recommendation.isStaffPick };
  },
});
