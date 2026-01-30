import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * List all provider configurations (admin only)
 */
export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const isAdmin =
      (identity.publicMetadata as { role?: string })?.role === "admin";
    if (!isAdmin) return [];

    return await ctx.db
      .query("providerConfigs")
      .withIndex("by_provider")
      .collect();
  },
});

/**
 * Get a single provider config by providerId (admin only)
 */
export const getByProvider = query({
  args: { providerId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const isAdmin =
      (identity.publicMetadata as { role?: string })?.role === "admin";
    if (!isAdmin) return null;

    return await ctx.db
      .query("providerConfigs")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .first();
  },
});

/**
 * Upsert provider config (admin only)
 */
export const upsert = mutation({
  args: {
    providerId: v.string(),
    enabled: v.boolean(),
    encryptedKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const isAdmin =
      (identity.publicMetadata as { role?: string })?.role === "admin";
    if (!isAdmin) throw new Error("Admin access required");

    const existing = await ctx.db
      .query("providerConfigs")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        encryptedKey: args.encryptedKey,
        updatedAt: now,
        updatedBy: identity.subject,
      });
    } else {
      await ctx.db.insert("providerConfigs", {
        providerId: args.providerId,
        enabled: args.enabled,
        encryptedKey: args.encryptedKey,
        updatedAt: now,
        updatedBy: identity.subject,
      });
    }

    return { success: true };
  },
});

/**
 * Get list of disabled provider IDs (public, for route handler)
 */
export const getDisabledProviders = query({
  handler: async (ctx) => {
    const configs = await ctx.db
      .query("providerConfigs")
      .withIndex("by_provider")
      .collect();

    return configs.filter((c) => !c.enabled).map((c) => c.providerId);
  },
});
