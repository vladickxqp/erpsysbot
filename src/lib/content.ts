/** Creator Studio's fixed lists, shared by the forms and the server. */
export const CONTENT_STATUSES = ["IDEA", "DRAFT", "REVIEW", "SCHEDULED", "PUBLISHED"] as const;
export const PLATFORMS = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "FACEBOOK", "X", "TELEGRAM", "BLOG", "NEWSLETTER", "OTHER"] as const;
export const CONTENT_TYPES = ["POST", "REEL", "SHORT", "VIDEO", "STORY", "ARTICLE", "AD", "NEWSLETTER"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];

/** What the generator writes, and its settings. */
export const GENERATION_KINDS = [
  "ideas",
  "titles",
  "script",
  "description",
  "hashtags",
  "plan",
  "variants",
  "youtubeDescription",
  "tiktokCaption",
  "instagramCaption",
  "linkedinPost",
  "adCopy",
  "repurpose",
] as const;
export const TONES = ["friendly", "professional", "inspiring", "humorous", "bold", "educational"] as const;
export const LENGTHS = ["short", "medium", "long"] as const;
export const CREATIVITY = ["low", "balanced", "high"] as const;
export const OUTPUT_LANGUAGES = ["de", "en", "ru", "uk", "kk", "es", "fr", "it", "pl", "tr"] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];
/** Each output language in its own words (the same on server and browser). */
export const LANGUAGE_ENDONYMS: Record<(typeof OUTPUT_LANGUAGES)[number], string> = {
  de: "Deutsch",
  en: "English",
  ru: "Русский",
  uk: "Українська",
  kk: "Қазақша",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pl: "Polski",
  tr: "Türkçe",
};

/** A sponsoring deal from the first contact to the money. */
export const SPONSOR_STATUSES = ["LEAD", "NEGOTIATION", "CONFIRMED", "DELIVERED", "PAID", "CANCELLED"] as const;
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];
