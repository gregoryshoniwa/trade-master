"use client";

/**
 * Renders LLM-authored markdown — meeting notes, postmortems, chat —
 * with proper GFM tables, lists, headings, and inline code; plus the
 * symbol-icon enrichment from SymbolText so Deriv codes mid-paragraph
 * get a tiny chart icon.
 *
 * Tailwind utility classes do the typography (we don't pull
 * @tailwindcss/typography). Each element gets a small set of classes
 * tuned to dark trading UIs.
 */

import type { ReactNode } from "react";
import { Fragment } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import SymbolIcon from "@/components/SymbolIcon";

const SYMBOL_RE = /\b(frx[A-Z]{6}|cry[A-Z]{6}|R_\d{2,3}|1HZ\d{2,3}V|OTC_[A-Z0-9]+)\b/g;

/** Run a plain text node through SYMBOL_RE and emit a mix of strings +
 *  <SymbolIcon> spans. */
function enrichText(text: string, iconSize = 13): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(SYMBOL_RE)) {
    const code = m[1];
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <span
        key={`sym-${i++}-${idx}`}
        className="inline-flex items-center gap-1 align-baseline"
      >
        <SymbolIcon code={code} size={iconSize} />
        <span className="num">{code}</span>
      </span>,
    );
    last = idx + code.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Walk react-markdown children, wrapping plain strings through
 *  enrichText. Non-string children (already JSX) pass through. */
function enrichChildren(children: ReactNode, iconSize: number): ReactNode {
  if (typeof children === "string") {
    return <>{enrichText(children, iconSize).map((p, k) => <Fragment key={k}>{p}</Fragment>)}</>;
  }
  if (Array.isArray(children)) {
    return children.map((c, idx) => {
      if (typeof c === "string") {
        return (
          <Fragment key={idx}>
            {enrichText(c, iconSize).map((p, k) => <Fragment key={k}>{p}</Fragment>)}
          </Fragment>
        );
      }
      return <Fragment key={idx}>{c}</Fragment>;
    });
  }
  return children;
}

type Props = {
  children: string;
  iconSize?: number;
  /** Additional class on the root wrapper — caller can scope font-size etc. */
  className?: string;
};

export default function MarkdownText({ children, iconSize = 13, className }: Props) {
  // Build component overrides once per render. We keep them tight — no
  // images, no raw HTML, headings + tables + lists + inline code only.
  const components: Components = {
    h1: ({ children }) => (
      <h1 className="mt-4 text-lg font-semibold tracking-tight">
        {enrichChildren(children, iconSize)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-5 text-base font-semibold tracking-tight">
        {enrichChildren(children, iconSize)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-4 text-sm font-semibold uppercase tracking-widest text-text-mute">
        {enrichChildren(children, iconSize)}
      </h3>
    ),
    p: ({ children }) => (
      <p className="my-2 leading-relaxed">
        {enrichChildren(children, iconSize)}
      </p>
    ),
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed">{enrichChildren(children, iconSize)}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-text">{enrichChildren(children, iconSize)}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-text-dim">{enrichChildren(children, iconSize)}</em>
    ),
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline-offset-2 hover:underline"
      >
        {enrichChildren(children, iconSize)}
      </a>
    ),
    code: ({ children, ...props }) => {
      const inline = !(props as { node?: { tagName?: string } }).node;
      if (inline) {
        return (
          <code className="num rounded bg-bg-elev-2 px-1 py-0.5 text-[0.9em]">
            {children}
          </code>
        );
      }
      return (
        <code className="num block">{children}</code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-md border border-border bg-bg-elev-1 p-3 text-xs">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-accent/40 pl-3 text-text-dim">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    // Tables — the whole reason this component exists. GFM gives us
    // proper table tokens via remark-gfm.
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-border bg-bg-elev-1">{children}</thead>
    ),
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-border/60 last:border-b-0">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-text-mute">
        {enrichChildren(children, iconSize)}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 align-top text-text-dim">
        {enrichChildren(children, iconSize)}
      </td>
    ),
  };

  return (
    <div className={`text-sm text-text ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
