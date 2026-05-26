"use client";

import Link from "next/link";

import TickChart from "@/components/TickChart";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
  const symbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? "R_75";
  const { loading, me, companies, activeCompanyId } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
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
              "Phase 0 · Live R_75 from Deriv demo"
            )}
          </p>
        </div>

        {!loading && me && companies.length === 0 && (
          <Link
            href="/companies/new"
            className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            + Create your first company
          </Link>
        )}
      </header>

      <TickChart symbol={symbol} wsUrl={`${wsUrl}/ws/ticks`} />

      <footer className="mt-6 text-center text-xs text-text-mute">
        Streaming from Deriv demo · app_id 1089 · see <code>PLAN.md</code> §29
      </footer>
    </main>
  );
}
