/**
 * Named constants for time arithmetic.
 *
 * Rule: no month/year constants — those durations are irregular
 * (28–31 days, 365–366 days). The ESLint rule `no-fragile-date-ops`
 * (Pattern D) enforces this.
 */

// Milliseconds
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_WEEK = 604_800_000;

// Seconds
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3_600;
export const SECONDS_PER_DAY = 86_400;

// Rates
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
