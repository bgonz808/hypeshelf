/**
 * Schema Migrations
 *
 * Convex doesn't have automatic migrations like SQL ORMs.
 * When you need to change the schema in a breaking way:
 *
 * 1. Write a migration function here
 * 2. Deploy (schema change still optional at this point)
 * 3. Run migration via dashboard or CLI: npx convex run migrations:yourMigration
 * 4. Verify data is transformed
 * 5. Now safe to make the field required / change type / etc.
 *
 * Common patterns:
 * - Backfill: Add data to a new field for existing documents
 * - Transform: Change field format (e.g., string dates → timestamps)
 * - Rename: Copy field to new name, then remove old (two deploys)
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Example: Backfill a new optional field with a default value
 * Run with: npx convex run migrations:backfillExample
 */
export const backfillExample = mutation({
  args: {},
  handler: async (_ctx) => {
    // Example: If you added a new 'rating' field and want to default existing to 0
    // const recs = await ctx.db.query("recommendations").collect();
    // let updated = 0;
    // for (const rec of recs) {
    //   if (rec.rating === undefined) {
    //     await ctx.db.patch(rec._id, { rating: 0 });
    //     updated++;
    //   }
    // }
    // return { updated, total: recs.length };

    return { message: "This is a template - uncomment and modify as needed" };
  },
});

/**
 * Batch migration for large datasets
 * Processes in chunks to avoid timeout (Convex functions have 60s limit)
 *
 * Usage:
 * 1. Call repeatedly until it returns { done: true }
 * 2. Or use a scheduled function to auto-continue
 */
export const batchMigrationExample = mutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (_ctx, _args) => {
    // const batchSize = args.batchSize ?? 100;

    // Example: paginated migration
    // const results = await ctx.db
    //   .query("recommendations")
    //   .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    //
    // for (const rec of results.page) {
    //   // Transform each document
    //   await ctx.db.patch(rec._id, { /* changes */ });
    // }
    //
    // return {
    //   processed: results.page.length,
    //   done: results.isDone,
    //   cursor: results.continueCursor,
    // };

    return { message: "Template for batch migrations" };
  },
});

/**
 * Verify migration completed successfully
 * Run after migration to confirm no documents were missed
 */
export const verifyMigration = mutation({
  args: {},
  handler: async (_ctx) => {
    // Example: Check all recommendations have the new field
    // const recs = await ctx.db.query("recommendations").collect();
    // const missing = recs.filter(r => r.newField === undefined);
    // return {
    //   total: recs.length,
    //   migrated: recs.length - missing.length,
    //   missing: missing.length,
    //   missingIds: missing.slice(0, 10).map(r => r._id), // Sample of missing
    // };

    return { message: "Template for verification" };
  },
});
