"use client";

import { Fragment, type ReactNode } from "react";

import SymbolIcon from "@/components/SymbolIcon";

// Match any Deriv-shaped symbol code anywhere in plain text so we can
// substitute an inline icon. Order matters in the alternation only as
// a tiebreaker — these patterns are mutually disjoint by prefix.
const SYMBOL_RE = /\b(frx[A-Z]{6}|cry[A-Z]{6}|R_\d{2,3}|1HZ\d{2,3}V|OTC_[A-Z0-9]+)\b/g;

type Props = {
  children: string;
  iconSize?: number;
};

/** Renders a body of text with inline icons attached to any recognized
 *  symbol codes. Useful in meeting notes, narratives, and chat output
 *  where the LLM mentions "frxEURUSD" mid-sentence — the icon makes the
 *  reference scannable at a glance.
 *
 *  Plain text is preserved exactly (including newlines, when the parent
 *  CSS uses `whitespace-pre-line`). Unknown codes pass through as plain
 *  text — `SymbolIcon` already handles the fallback. */
export default function SymbolText({ children, iconSize = 13 }: Props) {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of children.matchAll(SYMBOL_RE)) {
    const code = m[1];
    const idx = m.index ?? 0;
    if (idx > last) parts.push(children.slice(last, idx));
    parts.push(
      <span
        key={`sym-${i++}`}
        className="inline-flex items-center gap-1 align-baseline"
      >
        <SymbolIcon code={code} size={iconSize} />
        <span className="num">{code}</span>
      </span>,
    );
    last = idx + code.length;
  }
  if (last < children.length) parts.push(children.slice(last));
  // Wrap so parents that style the body (whitespace-pre-line etc) still
  // apply uniformly across the mix of strings and JSX nodes.
  return (
    <>
      {parts.map((p, k) => (
        <Fragment key={k}>{p}</Fragment>
      ))}
    </>
  );
}
