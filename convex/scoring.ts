/**
 * Scoring Algorithms for "Hot" Feed
 *
 * Extensible system for ranking recommendations.
 * Add new algorithms here, toggle via SCORING_ALGORITHM env var or A/B test.
 */

import { MS_PER_HOUR } from "../src/lib/temporal-constants";

// Types for scoring
export interface ScoredItem {
  id: string;
  score: number;
  likeCount: number;
  createdAt: number;
  recentLikes?: number;
}

export type AlgorithmName =
  | "hacker_news"
  | "exponential_decay"
  | "time_windows"
  | "wilson_score"
  | "simple_recent";

export interface AlgorithmConfig {
  name: AlgorithmName;
  params: Record<string, number>;
}

// Default configuration - can be overridden via env var
export const DEFAULT_ALGORITHM: AlgorithmConfig = {
  name: "hacker_news",
  params: {
    gravity: 1.5,
  },
};

/**
 * Algorithm implementations
 * Each takes item data and config params, returns a score
 */
const algorithms: Record<
  AlgorithmName,
  (item: ScoredItem, params: Record<string, number>) => number
> = {
  /**
   * Hacker News style
   * score = likes / (hours_old + 2)^gravity
   *
   * Pros: Simple, proven at scale, predictable decay
   * Cons: Doesn't account for like velocity
   *
   * Params:
   *   gravity (default 1.5) - higher = faster decay
   */
  hacker_news: (item, params) => {
    const gravity = params.gravity ?? 1.5;
    const hoursOld = (Date.now() - item.createdAt) / MS_PER_HOUR;
    return item.likeCount / Math.pow(hoursOld + 2, gravity);
  },

  /**
   * Exponential decay per like
   * score = Σ e^(-λ * hours_since_like)
   *
   * Pros: Each like decays independently, rewards sustained engagement
   * Cons: Requires per-like timestamps (more complex query)
   *
   * Params:
   *   lambda (default 0.1) - decay rate, higher = faster decay
   *   Note: Uses recentLikes approximation when per-like data unavailable
   */
  exponential_decay: (item, params) => {
    const lambda = params.lambda ?? 0.1;
    // Approximation: assume recent likes are evenly distributed over last 24h
    const recentLikes = item.recentLikes ?? item.likeCount;
    const avgHoursAgo = 12; // midpoint of 24h window
    return recentLikes * Math.exp(-lambda * avgHoursAgo);
  },

  /**
   * Time-windowed weights
   * score = (likes_24h * w1) + (likes_3d * w2) + (likes_7d * w3)
   *
   * Pros: Simple, tunable buckets, easy to understand
   * Cons: Requires bucketed like counts
   *
   * Params:
   *   weight_24h (default 3)
   *   weight_3d (default 2)
   *   weight_7d (default 1)
   *   Note: Uses approximations when bucket data unavailable
   */
  time_windows: (item, params) => {
    const w24h = params.weight_24h ?? 3;
    const w3d = params.weight_3d ?? 2;
    const w7d = params.weight_7d ?? 1;

    // Approximation based on total likes and recency
    const hoursOld = (Date.now() - item.createdAt) / MS_PER_HOUR;

    if (hoursOld <= 24) {
      return item.likeCount * w24h;
    } else if (hoursOld <= 72) {
      return item.likeCount * w3d;
    } else {
      return item.likeCount * w7d;
    }
  },

  /**
   * Wilson Score (lower bound of confidence interval)
   * Good for "best" ranking, accounts for sample size
   *
   * Pros: 5/5 doesn't beat 500/600, statistically sound
   * Cons: Needs positive/negative ratio (we only have likes)
   *
   * Params:
   *   z (default 1.96) - confidence level (1.96 = 95%)
   *   assumed_views (default 10x likes) - estimate views from likes
   */
  wilson_score: (item, params) => {
    const z = params.z ?? 1.96;
    const viewMultiplier = params.assumed_views ?? 10;

    const n = item.likeCount * viewMultiplier; // estimated views
    const p = n > 0 ? item.likeCount / n : 0; // like ratio

    if (n === 0) return 0;

    // Wilson score lower bound formula
    const denominator = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);

    return (center - spread) / denominator;
  },

  /**
   * Simple recent count
   * Just count likes in time window, no weighting
   *
   * Pros: Dead simple, easy to debug
   * Cons: No decay, can be gamed
   *
   * Params:
   *   window_hours (default 168 = 7 days)
   */
  simple_recent: (item, params) => {
    const windowHours = params.window_hours ?? 168;
    const hoursOld = (Date.now() - item.createdAt) / MS_PER_HOUR;

    // If created within window, use like count
    // Otherwise, would need per-like timestamps for accuracy
    if (hoursOld <= windowHours) {
      return item.likeCount;
    }
    return item.recentLikes ?? 0;
  },
};

/**
 * Calculate score using specified algorithm
 */
export function calculateScore(
  item: ScoredItem,
  config: AlgorithmConfig = DEFAULT_ALGORITHM
): number {
  const algorithm = algorithms[config.name];
  if (!algorithm) {
    console.warn(
      `Unknown algorithm: ${config.name}, falling back to hacker_news`
    );
    return algorithms.hacker_news(item, config.params);
  }
  return algorithm(item, config.params);
}

/**
 * Sort items by score (descending)
 */
export function rankByScore(
  items: ScoredItem[],
  config: AlgorithmConfig = DEFAULT_ALGORITHM
): ScoredItem[] {
  return items
    .map((item) => ({
      ...item,
      score: calculateScore(item, config),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get algorithm config from environment or default
 * Supports A/B testing via user bucket
 */
export function getAlgorithmConfig(
  _userId?: string, // Prefixed with _ to indicate intentionally unused (A/B test ready)
  envOverride?: string
): AlgorithmConfig {
  // Check for env override (for testing)
  if (envOverride) {
    try {
      return JSON.parse(envOverride) as AlgorithmConfig;
    } catch {
      // Fall through to default
    }
  }

  // A/B test example: 50% get hacker_news, 50% get time_windows
  // Uncomment to enable:
  /*
  if (userId) {
    const bucket = hashString(userId) % 100
    if (bucket < 50) {
      return { name: 'hacker_news', params: { gravity: 1.5 } }
    } else {
      return { name: 'time_windows', params: {} }
    }
  }
  */

  return DEFAULT_ALGORITHM;
}

/**
 * Simple string hash for A/B bucketing
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Algorithm metadata for admin UI / debugging
 */
export const ALGORITHM_INFO: Record<
  AlgorithmName,
  { name: string; description: string; defaultParams: Record<string, number> }
> = {
  hacker_news: {
    name: "Hacker News",
    description: "Classic formula: likes / (hours + 2)^gravity",
    defaultParams: { gravity: 1.5 },
  },
  exponential_decay: {
    name: "Exponential Decay",
    description: "Each like decays over time: Σ e^(-λ * hours)",
    defaultParams: { lambda: 0.1 },
  },
  time_windows: {
    name: "Time Windows",
    description: "Weighted buckets: 24h×3 + 3d×2 + 7d×1",
    defaultParams: { weight_24h: 3, weight_3d: 2, weight_7d: 1 },
  },
  wilson_score: {
    name: "Wilson Score",
    description: "Statistical confidence interval, accounts for sample size",
    defaultParams: { z: 1.96, assumed_views: 10 },
  },
  simple_recent: {
    name: "Simple Recent",
    description: "Just count likes in time window",
    defaultParams: { window_hours: 168 },
  },
};
