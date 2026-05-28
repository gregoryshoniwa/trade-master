"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type SymbolDef } from "@/lib/api";

const CLASS_LABEL: Record<SymbolDef["asset_class"], string> = {
  forex: "Forex",
  synthetic: "Synthetic Indices",
  commodity: "Commodities",
  crypto: "Crypto",
  stock_index: "Stock Indices",
};

const CLASS_ORDER: SymbolDef["asset_class"][] = [
  "forex",
  "commodity",
  "crypto",
  "stock_index",
  "synthetic",
];

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
};

/** Grouped multi-select for a per-agent `allowed_assets` list.
 *  Empty selection = "no restriction" (the decision loop interprets an
 *  empty list as "allow any symbol the agent's tier permits"), so we make
 *  that explicit in the UI footer. */
export default function AssetMultiPicker({ value, onChange }: Props) {
  const [symbols, setSymbols] = useState<SymbolDef[] | null>(null);

  useEffect(() => {
    api.listSymbols().then((r) => setSymbols(r.symbols)).catch(() => setSymbols([]));
  }, []);

  const selected = useMemo(() => new Set(value), [value]);

  const grouped = useMemo(() => {
    const m = new Map<SymbolDef["asset_class"], SymbolDef[]>();
    for (const s of symbols ?? []) {
      const list = m.get(s.asset_class) ?? [];
      list.push(s);
      m.set(s.asset_class, list);
    }
    return CLASS_ORDER.filter((c) => m.has(c)).map((c) => [c, m.get(c) ?? []] as const);
  }, [symbols]);

  if (symbols == null) {
    return <p className="text-xs text-text-mute">Loading symbols…</p>;
  }
  if (symbols.length === 0) {
    return <p className="text-xs text-text-mute">No symbols configured.</p>;
  }

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next]);
  }
  function toggleGroup(group: SymbolDef[], on: boolean) {
    const next = new Set(selected);
    for (const s of group) {
      if (on) next.add(s.code);
      else next.delete(s.code);
    }
    onChange([...next]);
  }
  function clearAll() {
    onChange([]);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-text-mute">
          {selected.size === 0
            ? "Allow any symbol (default — no restriction)"
            : `${selected.size} selected`}
        </span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-text-mute hover:text-text"
          >
            Allow all (clear)
          </button>
        )}
      </div>
      <div className="space-y-3">
        {grouped.map(([cls, list]) => {
          const onCount = list.filter((s) => selected.has(s.code)).length;
          const allOn = onCount === list.length;
          return (
            <div key={cls} className="rounded-md border border-border bg-bg-elev-1 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-text-mute">
                  {CLASS_LABEL[cls]} <span className="num">({onCount}/{list.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleGroup(list, !allOn)}
                  className="text-[10px] text-text-mute hover:text-text"
                >
                  {allOn ? "Uncheck" : "Check all"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {list.map((s) => {
                  const on = selected.has(s.code);
                  return (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => toggle(s.code)}
                      title={s.description}
                      className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs transition ${
                        on
                          ? "bg-accent-soft text-accent"
                          : "text-text-dim hover:bg-bg-elev-2 hover:text-text"
                      }`}
                    >
                      <span className="truncate">{s.display}</span>
                      <span className="num ml-1 text-[10px] text-text-mute">T{s.tier}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
