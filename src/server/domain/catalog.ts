// Product catalog. Prices are defined server-side only; the client never sends prices.
// Entitlements are separate from plan names so plans can be re-packaged freely.

export interface Entitlements {
  plan: "free" | "premium";
  modelTier: "standard" | "premium";
  monthlyCreditAllowance: number;
  /** Total characters of active memory per character. */
  memoryCharLimit: number;
  features: string[];
}

export const PLANS: Record<"free" | "premium", Omit<Entitlements, "plan"> & { name: string; priceMinor: number; currency: string; perks: string[] }> = {
  free: {
    name: "Free",
    priceMinor: 0,
    currency: "THB",
    modelTier: "standard",
    monthlyCreditAllowance: 0,
    memoryCharLimit: 20_000,
    features: [],
    perks: ["Chat with any public character", "Create your own characters", "20,000 characters of memory per character", "Daily coin bonus"],
  },
  premium: {
    name: "Lumora Plus",
    priceMinor: 19900,
    currency: "THB",
    modelTier: "premium",
    monthlyCreditAllowance: 1500,
    memoryCharLimit: 50_000,
    features: ["premium_model", "extended_memory"],
    perks: ["1,500 coins every month", "Premium AI model routing", "50,000 characters of memory per character", "Support new features early"],
  },
};

export const COIN_PACKAGES = [
  { id: "coins_300", coins: 300, priceMinor: 9900, currency: "THB" },
  { id: "coins_1000", coins: 1000, priceMinor: 29900, currency: "THB" },
  { id: "coins_3500", coins: 3500, priceMinor: 89900, currency: "THB" },
] as const;

export const SIGNUP_BONUS = 50;
export const DAILY_BONUS = 10;
