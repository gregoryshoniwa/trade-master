"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { api, type SymbolDef } from "@/lib/api";
import { friendlySymbol } from "@/lib/symbols";

type Props = {
  value: string;
  onChange: (code: string) => void;
};

const CLASS_LABEL: Record<SymbolDef["asset_class"], string> = {
  forex: "Forex",
  synthetic: "Synthetic Indices",
  commodity: "Commodities",
  crypto: "Crypto",
  stock_index: "Stock Indices",
};

const CLASS_ORDER: SymbolDef["asset_class"][] = [
  "forex",
  "synthetic",
  "commodity",
  "crypto",
  "stock_index",
];

export default function AssetPicker({ value, onChange }: Props) {
  const [symbols, setSymbols] = useState<SymbolDef[] | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.listSymbols().then((r) => setSymbols(r.symbols));
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const current = symbols?.find((s) => s.code === value) ?? null;

  const grouped = useMemo(() => {
    const map = new Map<SymbolDef["asset_class"], SymbolDef[]>();
    for (const s of symbols ?? []) {
      const list = map.get(s.asset_class) ?? [];
      list.push(s);
      map.set(s.asset_class, list);
    }
    return CLASS_ORDER.filter((c) => map.has(c)).map(
      (c) => [c, map.get(c) ?? []] as const,
    );
  }, [symbols]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[18rem] items-center gap-2 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:border-accent/40"
      >
        <span className="truncate font-medium" title={current?.display ?? value}>
          {current?.display ?? friendlySymbol(value)}
        </span>
        <span className="num hidden text-text-mute sm:inline">· {value.split(",")[0]}</span>
        <span className="text-text-mute">▾</span>
      </button>

      {open && symbols && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border border-border bg-bg-card p-1 shadow-xl">
          {grouped.map(([cls, list]) => (
            <div key={cls} className="py-1">
              <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-text-mute">
                {CLASS_LABEL[cls]}
              </div>
              {list.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => {
                    onChange(s.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-bg-elev-2 ${
                    s.code === value ? "bg-bg-elev-2" : ""
                  }`}
                >
                  <span>
                    <span className="font-medium">{s.display}</span>
                    <span className="num ml-2 text-xs text-text-mute">{s.code}</span>
                  </span>
                  <span className="text-[10px] text-text-mute">T{s.tier}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
