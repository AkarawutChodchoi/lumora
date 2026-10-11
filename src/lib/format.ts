/** Short coin count for tight spaces: 9,999 stays exact, larger values become 12.3K / 1.2M. */
export function shortNumber(n: number): string {
  if (Math.abs(n) < 10_000) return n.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
