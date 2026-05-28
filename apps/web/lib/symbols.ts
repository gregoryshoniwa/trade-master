/** User-facing names for Deriv symbol codes.
 *
 *  Keep in sync with services/api/app/symbols.py CATALOG. We avoid forcing
 *  an api round-trip every time we render a position row, so a small static
 *  map covers every symbol we expose. Unknown codes fall back to the raw
 *  code rather than blowing up.
 */

export const FRIENDLY_SYMBOL: Record<string, string> = {
  // Forex majors
  frxEURUSD: "EUR/USD",
  frxGBPUSD: "GBP/USD",
  frxUSDJPY: "USD/JPY",
  frxAUDUSD: "AUD/USD",
  frxUSDCAD: "USD/CAD",
  frxUSDCHF: "USD/CHF",
  frxNZDUSD: "NZD/USD",
  // Forex minors / crosses
  frxEURGBP: "EUR/GBP",
  frxEURJPY: "EUR/JPY",
  frxGBPJPY: "GBP/JPY",
  frxAUDJPY: "AUD/JPY",
  frxEURAUD: "EUR/AUD",
  frxEURCAD: "EUR/CAD",
  frxEURCHF: "EUR/CHF",
  // Commodities
  frxXAUUSD: "Gold",
  frxXAGUSD: "Silver",
  frxXPDUSD: "Palladium",
  frxXPTUSD: "Platinum",
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
  // Stock indices
  OTC_SPC: "US 500",
  OTC_NDX: "US Tech 100",
  OTC_DJI: "Wall Street 30",
  OTC_FTSE: "UK 100",
  OTC_GDAXI: "Germany 40",
  OTC_N225: "Japan 225",
  OTC_HSI: "Hong Kong 50",
  OTC_AS51: "Australia 200",
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
