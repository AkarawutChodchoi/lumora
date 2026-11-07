// Product catalog. Prices live on the server only; the browser only ever sends a product id.
// Prices are placeholders until the owner sets real ones.
// Entitlements are separate from plan names so plans can be re-packaged freely.

export interface Entitlements {
  plan: "free" | "premium";
  modelTier: "standard" | "premium";
  /** coins granted when a paid Lumora Plus period starts */
  monthlyCreditAllowance: number;
  /** total characters of active memory per character */
  memoryCharLimit: number;
  features: string[];
  /** when the current Plus period ends (null = free plan) */
  until: Date | null;
}

export const PLANS = {
  free: {
    name: "Free",
    modelTier: "standard",
    monthlyCreditAllowance: 0,
    memoryCharLimit: 20_000,
    features: [] as string[],
  },
  premium: {
    name: "Lumora Plus",
    modelTier: "premium",
    monthlyCreditAllowance: 1500,
    memoryCharLimit: 50_000,
    features: ["premium_model", "extended_memory"],
  },
} as const;

/** One-off QR payments that add a Lumora Plus period (stacks after the current one). */
export const MEMBERSHIP_PLANS = [
  { id: "plus_30", plan: "premium" as const, name: "Lumora Plus 30 วัน", days: 30, price: 199 },
  { id: "plus_90", plan: "premium" as const, name: "Lumora Plus 90 วัน", days: 90, price: 549, tag: "คุ้มกว่า" },
] as const;

/** price in THB; coins = paid coins, bonus = promotional coins on top */
export const COIN_PACKS = [
  { id: "c35", price: 35, coins: 100, bonus: 0 },
  { id: "c59", price: 59, coins: 180, bonus: 0 },
  { id: "c99", price: 99, coins: 300, bonus: 20 },
  { id: "c199", price: 199, coins: 600, bonus: 60 },
  { id: "c499", price: 499, coins: 1500, bonus: 200, tag: "ขายดี" },
  { id: "c999", price: 999, coins: 3000, bonus: 500, tag: "คุ้มสุด" },
] as const;

export type CoinPack = (typeof COIN_PACKS)[number];
export type MembershipPlan = (typeof MEMBERSHIP_PLANS)[number];

export const SIGNUP_BONUS = 50;
export const DAILY_BONUS = 10;

/** Payment methods shown on the coins page. Only PromptPay is wired to a gateway today. */
export const PAY_METHODS = [
  { id: "promptpay", label: "PromptPay QR", ready: true },
  { id: "truemoney", label: "TrueMoney Wallet", ready: false },
  { id: "card", label: "บัตรเครดิต / เดบิต", ready: false },
] as const;
