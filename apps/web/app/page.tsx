"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AssetPicker from "@/components/AssetPicker";
import TickChart from "@/components/TickChart";
import { api, type SymbolDef } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FALLBACK_SYMBOL = "R_75";

function activeSymbolKey(companyId: string | null): string {
  return `tm.activeSymbol.${companyId ?? "_anon"}`;
}

export default function Home() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
  const envSymbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? FALLBACK_SYMBOL;

  const { loading, me, companies, activeCompanyId } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [symbol, setSymbol] = useState<string>(envSymbol);
  const [symbolMeta, setSymbolMeta] = useState<SymbolDef | null>(null);

  // Restore choice from localStorage when the active company changes.
  useEffect(() => {
    const stored = localStorage.getItem(activeSymbolKey(activeCompanyId));
    if (stored) setSymbol(stored);
  }, [activeCompanyId]);

  // Lookup display metadata for the current symbol.
  useEffect(() => {
    api.listSymbols().then((r) => {
      const found = r.symbols.find((s) => s.code === symbol) ?? null;
      setSymbolMeta(found);
    });
  }, [symbol]);

  function chooseSymbol(code: string) {
    setSymbol(code);
    localStorage.setItem(activeSymbolKey(activeCompanyId), code);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {active ? `${active.name} — Discover` : "Hello, trader"}
          </h1>
          <p className="text-xs text-text-mute">
            {active ? (
              <>
                Tier {active.current_asset_tier} ·{" "}
                {active.unlocked_contract_types.join(", ")} ·{" "}
                <span className="text-bull">paper mode</span>
              </>
            ) : (
              "Phase 0 · Live from Deriv demo"
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <AssetPicker value={symbol} onChange={chooseSymbol} />
          {!loading && me && companies.length === 0 && (
            <Link
              href="/companies/new"
              className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
            >
              + Create your first company
            </Link>
          )}
        </div>
      </header>

      <TickChart
        symbol={symbol}
        wsUrl={`${wsUrl}/ws/ticks`}
        decimals={symbolMeta?.decimals ?? 4}
        displayName={symbolMeta?.display}
      />

      <footer className="mt-6 text-center text-xs text-text-mute">
        Streaming from Deriv demo · app_id 1089 · see <code>PLAN.md</code> §29
      </footer>
    </main>
  );
}
