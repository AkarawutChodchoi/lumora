// Conservative token estimate used only for context budgeting. Real usage
// numbers for billing/metrics always come from the provider's response.
// Thai and other non-Latin scripts tokenise much less efficiently than
// English, so they are weighted more heavily.
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3.5 + other / 1.2) + 4;
}

/** Truncate text to roughly `maxTokens`, cutting at a word boundary when possible. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  const cut = text.slice(0, lo);
  const space = cut.lastIndexOf(" ");
  return (space > lo * 0.8 ? cut.slice(0, space) : cut) + "…";
}
