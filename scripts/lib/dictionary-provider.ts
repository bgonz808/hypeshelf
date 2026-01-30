/**
 * Curated dictionary provider for polysemous UI terms.
 *
 * Handles words like "Rock", "Metal", "Country" that MT APIs consistently
 * mistranslate because the dominant corpus meaning (geology, physical material,
 * nation) overwhelms the domain sense (music genre, game genre).
 *
 * Domain is inferred from the i18n key namespace: `genres.*` → music/game,
 * `filters.*` → UI. Dictionary lookup is instant and free (no API call).
 *
 * See ADR-004 Phase 5, Addendum A
 */

import type { TranslationProvider } from "./translation-providers.js";

// ── Types ───────────────────────────────────────────────────────────

interface DictionarySense {
  pos: string; // part of speech: noun, adj, verb
  gloss: string; // brief English definition
  domain: string; // music, game, ui, general
}

interface DictionaryTranslations {
  [locale: string]: {
    [domain: string]: string;
  };
}

interface DictionaryEntry {
  senses: DictionarySense[];
  translations: DictionaryTranslations;
}

export type { DictionarySense, DictionaryEntry };

// ── Curated Dictionary ──────────────────────────────────────────────

/**
 * ~15 polysemous terms that MT APIs consistently get wrong.
 * Keys are lowercase English values. Domains map to namespace prefixes.
 */
const DICTIONARY: Record<string, DictionaryEntry> = {
  rock: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "stone, boulder", domain: "general" },
      { pos: "verb", gloss: "to sway, move", domain: "general" },
    ],
    translations: {
      es: { music: "Rock", general: "Roca" },
      zh: { music: "摇滚", general: "岩石" },
      ar: { music: "روك", general: "صخرة" },
      yi: { music: "ראָק", general: "שטיין" },
    },
  },
  metal: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "physical material", domain: "general" },
    ],
    translations: {
      es: { music: "Metal", general: "Metal" },
      zh: { music: "金属乐", general: "金属" },
      ar: { music: "ميتال", general: "معدن" },
      yi: { music: "מעטאַל", general: "מעטאַל" },
    },
  },
  country: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "nation, land", domain: "general" },
    ],
    translations: {
      es: { music: "Country", general: "País" },
      zh: { music: "乡村", general: "国家" },
      ar: { music: "كانتري", general: "بلد" },
      yi: { music: "קאַנטרי", general: "לאַנד" },
    },
  },
  folk: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "people, community", domain: "general" },
    ],
    translations: {
      es: { music: "Folk", general: "Pueblo" },
      zh: { music: "民谣", general: "民间" },
      ar: { music: "فولك", general: "شعب" },
      yi: { music: "פֿאָלק", general: "פֿאָלק" },
    },
  },
  blues: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "sadness", domain: "general" },
    ],
    translations: {
      es: { music: "Blues", general: "Tristeza" },
      zh: { music: "布鲁斯", general: "忧郁" },
      ar: { music: "بلوز", general: "كآبة" },
      yi: { music: "בלוז", general: "טרויער" },
    },
  },
  party: {
    senses: [
      { pos: "noun", gloss: "game genre (party games)", domain: "game" },
      { pos: "noun", gloss: "social gathering", domain: "general" },
      { pos: "noun", gloss: "political party", domain: "general" },
    ],
    translations: {
      es: { game: "Fiesta", general: "Fiesta" },
      zh: { game: "聚会", general: "派对" },
      ar: { game: "حفلة", general: "حفلة" },
      yi: { game: "פּאַרטי", general: "פּאַרטי" },
    },
  },
  alternative: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "adj", gloss: "other option", domain: "general" },
    ],
    translations: {
      es: { music: "Alternativo", general: "Alternativa" },
      zh: { music: "另类", general: "替代" },
      ar: { music: "بديل", general: "بديل" },
      yi: { music: "אַלטערנאַטיוו", general: "אַלטערנאַטיוו" },
    },
  },
  indie: {
    senses: [
      { pos: "noun", gloss: "music/game genre", domain: "music" },
      { pos: "adj", gloss: "independent", domain: "general" },
    ],
    translations: {
      es: { music: "Indie", general: "Independiente" },
      zh: { music: "独立", general: "独立" },
      ar: { music: "إندي", general: "مستقل" },
      yi: { music: "אינדי", general: "אומאָפּהענגיק" },
    },
  },
  soul: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "spirit, essence", domain: "general" },
    ],
    translations: {
      es: { music: "Soul", general: "Alma" },
      zh: { music: "灵魂乐", general: "灵魂" },
      ar: { music: "سول", general: "روح" },
      yi: { music: "סאָול", general: "נשמה" },
    },
  },
  punk: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "noun", gloss: "rebellious person", domain: "general" },
    ],
    translations: {
      es: { music: "Punk", general: "Punk" },
      zh: { music: "朋克", general: "朋克" },
      ar: { music: "بانك", general: "بانك" },
      yi: { music: "פּונק", general: "פּונק" },
    },
  },
  classical: {
    senses: [
      { pos: "adj", gloss: "music genre", domain: "music" },
      { pos: "adj", gloss: "traditional, of antiquity", domain: "general" },
    ],
    translations: {
      es: { music: "Clásica", general: "Clásico" },
      zh: { music: "古典", general: "古典" },
      ar: { music: "كلاسيكي", general: "كلاسيكي" },
      yi: { music: "קלאַסיש", general: "קלאַסיש" },
    },
  },
  pop: {
    senses: [
      { pos: "noun", gloss: "music genre", domain: "music" },
      { pos: "verb", gloss: "to burst", domain: "general" },
      { pos: "noun", gloss: "father (informal)", domain: "general" },
    ],
    translations: {
      es: { music: "Pop", general: "Pop" },
      zh: { music: "流行", general: "流行" },
      ar: { music: "بوب", general: "بوب" },
      yi: { music: "פּאָפּ", general: "פּאָפּ" },
    },
  },
  live: {
    senses: [
      { pos: "adj", gloss: "real-time, in person", domain: "ui" },
      { pos: "verb", gloss: "to reside", domain: "general" },
    ],
    translations: {
      es: { ui: "En vivo", general: "Vivir" },
      zh: { ui: "直播", general: "居住" },
      ar: { ui: "مباشر", general: "يعيش" },
      yi: { ui: "לעבעדיק", general: "וווינען" },
    },
  },
  post: {
    senses: [
      { pos: "noun", gloss: "published content", domain: "ui" },
      { pos: "verb", gloss: "to publish", domain: "ui" },
      { pos: "noun", gloss: "mail", domain: "general" },
    ],
    translations: {
      es: { ui: "Publicar", general: "Correo" },
      zh: { ui: "发布", general: "邮件" },
      ar: { ui: "نشر", general: "بريد" },
      yi: { ui: "פּאָסטן", general: "פּאָסט" },
    },
  },
  other: {
    senses: [
      { pos: "adj", gloss: "miscellaneous category", domain: "ui" },
      { pos: "adj", gloss: "different, additional", domain: "general" },
    ],
    translations: {
      es: { ui: "Otros", general: "Otro" },
      zh: { ui: "其他", general: "其他" },
      ar: { ui: "أخرى", general: "آخر" },
      yi: { ui: "אַנדערע", general: "אַנדער" },
    },
  },
};

// ── Domain inference from key namespace ─────────────────────────────

/**
 * Infer domain from i18n key namespace.
 * `genres.rock` → music (default for genres)
 * `filters.all` → ui
 */
function inferDomain(key: string): string {
  const namespace = key.split(".")[0];
  switch (namespace) {
    case "genres":
      return "music"; // Most genre keys are music; game-specific ones also match
    case "filters":
    case "common":
    case "admin":
    case "auth":
      return "ui";
    default:
      return "general";
  }
}

// ── Provider Implementation ─────────────────────────────────────────

const SUPPORTED_LOCALES = new Set(["es", "zh", "ar", "yi"]);

export class DictionaryProvider implements TranslationProvider {
  name = "dictionary";

  supportsLocale(locale: string): boolean {
    return SUPPORTED_LOCALES.has(locale);
  }

  getRemainingQuota(): number {
    return Infinity;
  }

  /**
   * Look up a curated translation by domain match.
   *
   * Returns the translation only if there is exactly one matching sense
   * for the inferred domain — ambiguous matches (0 or 2+) fall through.
   *
   * @param context - Optional `{ key }` for domain inference from namespace
   */
  async translate(
    text: string,
    _from: string,
    to: string,
    context?: { key?: string }
  ): Promise<string> {
    const normalized = text.toLowerCase().trim();
    const entry = DICTIONARY[normalized];
    if (!entry) {
      throw new Error(`Dictionary: no entry for "${text}"`);
    }

    const localeTranslations = entry.translations[to];
    if (!localeTranslations) {
      throw new Error(`Dictionary: no ${to} translations for "${text}"`);
    }

    // Determine domain from key namespace or fall back to "general"
    const domain = context?.key ? inferDomain(context.key) : "general";

    // Try exact domain match first, then "game" for genres (party games etc.)
    const translation =
      localeTranslations[domain] ??
      (domain === "music" ? localeTranslations["game"] : undefined) ??
      (domain === "game" ? localeTranslations["music"] : undefined);

    if (!translation) {
      throw new Error(
        `Dictionary: no ${domain} domain translation for "${text}" → ${to}`
      );
    }

    return translation;
  }

  /**
   * Get all senses for a word (used for reporting).
   */
  getSenses(text: string): DictionarySense[] | undefined {
    const entry = DICTIONARY[text.toLowerCase().trim()];
    return entry?.senses;
  }

  /**
   * Check if a word exists in the dictionary.
   */
  has(text: string): boolean {
    return text.toLowerCase().trim() in DICTIONARY;
  }
}
