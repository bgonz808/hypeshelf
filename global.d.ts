import messages from "./messages/en.json";

/**
 * Type-safe next-intl message keys.
 *
 * All translation keys are derived from en.json (the canonical base).
 * Using a nonexistent key like t("nonexistent.key") will fail at compile time.
 *
 * See ADR-004 §4 for rationale.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}
