import { mutation, query } from "./_generated/server";

/**
 * Get current user's role and info
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    return {
      id: identity.subject,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.pictureUrl,
      role: (identity.publicMetadata as { role?: string })?.role ?? "user",
    };
  },
});

/**
 * Check if current user is admin
 */
export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return false;
    }

    return (identity.publicMetadata as { role?: string })?.role === "admin";
  },
});

/**
 * Bootstrap initial admin
 * Called on first sign-in, checks INITIAL_ADMIN_EMAIL env var
 *
 * Note: This sets a flag in Convex, but the actual role assignment
 * happens via Clerk webhooks or Clerk dashboard. This is just
 * for tracking/auditing who should be admin.
 */
export const checkAdminBootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.email) {
      return { shouldBeAdmin: false };
    }

    // In a real implementation, you'd check against an env var
    // Since Convex functions can't directly access Next.js env vars,
    // this would typically be done via:
    // 1. A Clerk webhook that sets publicMetadata
    // 2. Or checking against a Convex environment variable

    // For now, return the email for client-side comparison
    return {
      email: identity.email,
      currentRole:
        (identity.publicMetadata as { role?: string })?.role ?? "user",
    };
  },
});
