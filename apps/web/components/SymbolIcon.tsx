"use client";

import type { CSSProperties } from "react";

// Visual identity for a Deriv symbol. Pure Unicode — no asset
// downloads, renders crisp at any DPR, ships zero extra bytes.
//
//   Forex pairs (frx + BASE + QUOTE): paired country flag emoji
//   Metals (XAU/XAG/XPD/XPT): chemistry-style 2-letter pill
//   Crypto (cry + SYM + USD): currency glyph
//   Synthetic indices (R_N or 1HZNV): mini volatility bar with the number
//   Stock indices (OTC_*): country flag emoji
//
// Falls back to a neutral chart glyph for unknown codes rather than
// blowing up — this is a UI helper, not a validator.

const CURRENCY_FLAG: Record<string, string> = {
  EUR: "🇪🇺",
  USD: "🇺🇸",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  AUD: "🇦🇺",
  CAD: "🇨🇦",
  CHF: "🇨🇭",
  NZD: "🇳🇿",
  CNY: "🇨🇳",
  HKD: "🇭🇰",
  SGD: "🇸🇬",
};

const METAL_LABEL: Record<string, string> = {
  XAU: "Au",
  XAG: "Ag",
  XPD: "Pd",
  XPT: "Pt",
};

const CRYPTO_GLYPH: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  LTC: "Ł",
  XRP: "✕",
};

const INDEX_FLAG: Record<string, string> = {
  OTC_SPC: "🇺🇸",
  OTC_NDX: "🇺🇸",
  OTC_DJI: "🇺🇸",
  OTC_FTSE: "🇬🇧",
  OTC_GDAXI: "🇩🇪",
  OTC_N225: "🇯🇵",
  OTC_HSI: "🇭🇰",
  OTC_AS51: "🇦🇺",
};

type Props = {
  code: string;
  size?: number;        // height in px (default 18)
  className?: string;
};

export default function SymbolIcon({ code, size = 18, className = "" }: Props) {
  const c = (code || "").trim();
  const style: CSSProperties = {
    fontSize: `${size}px`,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
  };

  // Forex pair: frxBASEQUOTE (6 letters after "frx")
  if (c.startsWith("frx") && c.length === 9) {
    const base = c.slice(3, 6);
    const quote = c.slice(6, 9);
    // Metals: BASE is XAU/XAG/XPD/XPT, quote is USD.
    if (METAL_LABEL[base]) {
      return (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-amber-400/15 px-1.5 font-mono font-semibold text-amber-400 ${className}`}
          style={{ fontSize: `${size * 0.55}px`, height: size, minWidth: size }}
          aria-label={c}
        >
          {METAL_LABEL[base]}
        </span>
      );
    }
    const bf = CURRENCY_FLAG[base];
    const qf = CURRENCY_FLAG[quote];
    if (bf && qf) {
      return (
        <span className={`inline-flex ${className}`} style={style} aria-label={c}>
          <span>{bf}</span>
          <span>{qf}</span>
        </span>
      );
    }
    // Mixed pair where we don't have one side: just render whatever we have.
    return (
      <span className={`inline-flex ${className}`} style={style} aria-label={c}>
        {bf ?? "🏳️"}
        {qf ?? "🏳️"}
      </span>
    );
  }

  // Crypto: cryBTCUSD
  if (c.startsWith("cry") && c.length >= 6) {
    const sym = c.slice(3, 6);
    const glyph = CRYPTO_GLYPH[sym];
    if (glyph) {
      return (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-accent/15 font-semibold text-accent ${className}`}
          style={{ fontSize: `${size * 0.7}px`, height: size, minWidth: size, paddingInline: size * 0.25 }}
          aria-label={c}
        >
          {glyph}
        </span>
      );
    }
  }

  // Stock indices: OTC_SPC etc.
  if (c.startsWith("OTC_") && INDEX_FLAG[c]) {
    return (
      <span className={`inline-flex ${className}`} style={style} aria-label={c}>
        {INDEX_FLAG[c]}
      </span>
    );
  }

  // Synthetic indices: R_10, R_25, ..., 1HZ10V, 1HZ100V
  if (c.startsWith("R_") || c.startsWith("1HZ")) {
    // Pull a "magnitude" so the visual badge scales with the volatility,
    // and a small "1s" tail for 1HZ variants — the tick frequency is the
    // headline difference between R_* and 1HZ*.
    const isOneSec = c.startsWith("1HZ");
    const digits = c.replace(/[^0-9]/g, "");
    const mag = parseInt(digits || "10", 10);
    // Pick a tint that scales with volatility — eye-catching for 100,
    // muted for 10. Cheap heuristic, no need to be exact.
    const tint =
      mag >= 100 ? "bg-bear/20 text-bear" :
      mag >= 75  ? "bg-amber-400/20 text-amber-400" :
      mag >= 50  ? "bg-warning/20 text-warning" :
      mag >= 25  ? "bg-accent/20 text-accent" :
                   "bg-bull/20 text-bull";
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md font-semibold ${tint} ${className}`}
        style={{
          fontSize: `${size * 0.55}px`,
          height: size,
          minWidth: size * 1.5,
          paddingInline: size * 0.25,
          gap: "1px",
        }}
        aria-label={c}
      >
        <span>V{mag}</span>
        {isOneSec && <span style={{ fontSize: `${size * 0.42}px`, opacity: 0.7 }}>·1s</span>}
      </span>
    );
  }

  // Fallback: a neutral chart glyph so unknown codes still get something.
  return (
    <span
      className={`inline-flex items-center justify-center text-text-mute ${className}`}
      style={{ fontSize: `${size * 0.8}px`, height: size, minWidth: size }}
      aria-label={c}
    >
      📊
    </span>
  );
}
