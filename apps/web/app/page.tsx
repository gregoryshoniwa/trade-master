import TickChart from "@/components/TickChart";

export default function Home() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
  const symbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? "R_75";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-bull shadow-glow" />
          <div className="text-lg font-semibold tracking-tight">TradeMaster</div>
          <div className="rounded-full border border-paper-mode/40 px-2 py-0.5 text-xs text-paper-mode">
            paper · dev
          </div>
        </div>
        <div className="text-xs text-text-mute">Phase 0 · Hello, trader</div>
      </header>

      <TickChart symbol={symbol} wsUrl={`${wsUrl}/ws/ticks`} />

      <footer className="mt-6 text-center text-xs text-text-mute">
        Streaming from Deriv demo · app_id 1089 · see <code>PLAN.md</code> §29 for
        next milestones
      </footer>
    </main>
  );
}
