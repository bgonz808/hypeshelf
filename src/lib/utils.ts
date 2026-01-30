import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from "./temporal-constants";

/**
 * Combines clsx and tailwind-merge for conditional class names
 * with proper Tailwind CSS class deduplication.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validates that a string is a valid URL.
 * Accepts http and https protocols only.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Truncates a string to a maximum length, adding ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Formats a timestamp as a relative time string.
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const days = Math.floor(diff / MS_PER_DAY);
  if (days > 0) return `${days}d ago`;

  const hours = Math.floor(diff / MS_PER_HOUR);
  if (hours > 0) return `${hours}h ago`;

  const minutes = Math.floor(diff / MS_PER_MINUTE);
  if (minutes > 0) return `${minutes}m ago`;

  return "just now";
}
