// Enum-like values stored as strings (SQLite has no enums). Validate with these.
export const ROLES = ["user", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["active", "restricted", "suspended", "deletion_requested"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const PUBLICATION_STATUSES = ["draft", "published", "hidden", "suspended"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const CONTENT_RATINGS = ["general", "teen", "mature"] as const;
export type ContentRating = (typeof CONTENT_RATINGS)[number];

export { CATEGORY_KEYS as CATEGORIES } from "./taxonomy";
export type Category = string;

export const MAX_CATEGORIES = 10;
export const MAX_TAGS = 8;

export const MESSAGE_STATUSES = ["pending", "streaming", "completed", "failed", "cancelled"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MEMORY_TYPES = ["preference", "relationship", "episodic", "world"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SOURCES = ["user_stated", "ai_inferred", "user_edited"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const REPORT_TARGETS = ["character", "message", "user"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_CATEGORIES = [
  "sexual_minors",
  "sexual_content",
  "violence",
  "self_harm",
  "hate",
  "harassment",
  "illegal",
  "impersonation",
  "spam",
  "privacy",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ENFORCEMENT_ACTIONS = ["warning", "restriction", "suspension", "reinstatement"] as const;
export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number];
