import type { ReportCategory, Severity } from "../domain/enums";

// First-line automated content checks. These are deliberately conservative
// pattern rules: they catch clear-cut violations cheaply and deterministically.
// They are NOT the only safeguard — the system policy in the prompt, provider
// safety systems, user reports and the human review queue all apply as well.
// See docs/CONTENT_POLICY.md.

export type ModerationContext = "user_message" | "ai_output" | "character";

export interface ModerationResult {
  action: "allow" | "flag" | "block";
  category?: ReportCategory | "prompt_injection" | "personal_data";
  severity?: Severity;
  /** Message safe to show to the user when blocked or flagged. */
  userMessage?: string;
}

const MINOR =
  /\b(child|children|kid|kids|minor|minors|underage|preteen|toddler|loli|shota|(1[0-7]|[1-9])\s*(yo|y\/o|years?\s*old))\b|เด็ก|ผู้เยาว์|อายุ\s*(1[0-7]|[1-9])\s*(ปี|ขวบ)/i;
const SEXUAL =
  /\b(sex|sexual|nude|naked|porn|erotic|explicit|intercourse|molest|fondl\w*|orgasm)\b|เซ็กส์|มีเพศสัมพันธ์|ทางเพศ|เปลือย|โป๊/i;
const SELF_HARM =
  /\b(kill myself|end my life|suicide|want to die|self[-\s]?harm|cut myself)\b|ฆ่าตัวตาย|อยากตาย|ทำร้ายตัวเอง/i;
const INJECTION =
  /(ignore (all )?(previous|prior|above) (instructions|rules)|reveal (your|the) (system )?prompt|you are now (in )?developer mode|disregard (the )?system)|ลืมคำสั่งก่อนหน้า|เปิดเผย\s*system\s*prompt/i;
const CARD = /\b(?:\d[ -]?){13,19}\b/;
const THAI_ID = /\b\d[- ]?\d{4}[- ]?\d{5}[- ]?\d{2}[- ]?\d\b/;
const SECRETISH = /\b(password|passcode|pin code|รหัสผ่าน)\s*[:=]?\s*\S+/i;

export const SELF_HARM_RESOURCES =
  "If you are thinking about harming yourself, please reach out for support. In Thailand you can call the Department of Mental Health hotline 1323 (24 hours). Elsewhere, contact local emergency services or a crisis line.";

export function moderateText(text: string, context: ModerationContext): ModerationResult {
  if (MINOR.test(text) && SEXUAL.test(text)) {
    return {
      action: "block",
      category: "sexual_minors",
      severity: "critical",
      userMessage: "This content is not allowed. Sexual content involving minors is strictly prohibited.",
    };
  }
  if (context !== "character" && SELF_HARM.test(text)) {
    // Never block a user reaching out; flag it so the reply path can surface resources.
    return { action: "flag", category: "self_harm", severity: "high", userMessage: SELF_HARM_RESOURCES };
  }
  if (context === "ai_output" && SEXUAL.test(text) && /\b(explicit|porn)\b/i.test(text)) {
    return { action: "block", category: "sexual_content", severity: "high", userMessage: "The reply was withheld by the content policy." };
  }
  if (INJECTION.test(text)) {
    // The prompt structure already neutralises this; flag for metrics only.
    return { action: "flag", category: "prompt_injection", severity: "low" };
  }
  return { action: "allow" };
}

/** True when text looks like it contains personal data that must never be stored as memory. */
export function containsSensitiveData(text: string): boolean {
  return CARD.test(text) || THAI_ID.test(text) || SECRETISH.test(text);
}

export function severityForCategory(category: ReportCategory): Severity {
  switch (category) {
    case "sexual_minors":
      return "critical";
    case "self_harm":
    case "illegal":
    case "violence":
      return "high";
    case "sexual_content":
    case "hate":
    case "harassment":
    case "privacy":
    case "impersonation":
      return "medium";
    default:
      return "low";
  }
}
