import { getRequestConfig } from "next-intl/server";

/**
 * next-intl request configuration (without locale routing).
 *
 * Currently hardcoded to "en". When locale routing is added (post-MVP),
 * this will read from cookies or the URL segment.
 *
 * See ADR-004 for the phased i18n strategy.
 */
export default getRequestConfig(async () => {
  const locale = "en";

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
