/** User-facing names for Deriv symbol codes.
 *
 *  Keep in sync with the asset catalog the api exposes via /symbols. We avoid
 *  forcing an api round-trip every time we render a position row, so a small
 *  static map covers the symbols we actually trade. Unknown codes fall back
 *  to the raw code rather than blowing up.
 */

export const FRIENDLY_SYMBOL: Record<string, string> = {
  // Forex majors
  frxEURUSD: "EUR/USD",
  frxGBPUSD: "GBP/USD",
  frxUSDJPY: "USD/JPY",
  frxUSDCHF: "USD/CHF",
  frxAUDUSD: "AUD/USD",
  frxNZDUSD: "NZD/USD",
  frxUSDCAD: "USD/CAD",
  // Commodities
  frxXAUUSD: "Gold",
  frxXAGUSD: "Silver",
  // Crypto
  cryBTCUSD: "BTC/USD",
  cryETHUSD: "ETH/USD",
  // Synthetic indices
  R_10: "Vol 10",
  R_25: "Vol 25",
  R_50: "Vol 50",
  R_75: "Vol 75",
  R_100: "Vol 100",
  "1HZ10V": "Vol 10 (1s)",
  "1HZ25V": "Vol 25 (1s)",
  "1HZ50V": "Vol 50 (1s)",
  "1HZ75V": "Vol 75 (1s)",
  "1HZ100V": "Vol 100 (1s)",
};

export function friendlySymbol(code: string | null | undefined): string {
  if (!code) return "—";
  // If we accidentally received a comma-list (e.g. someone misconfigured an
  // env var with the gateway's subscription list), use the first entry.
  const first = code.split(",")[0].trim();
  return FRIENDLY_SYMBOL[first] ?? first;
}

/** Normalize an external symbol value (possibly a comma-list) to a single
 *  code we can ask the chart to render. */
export function firstSymbol(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  const first = code.split(",")[0].trim();
  return first || fallback;
}
