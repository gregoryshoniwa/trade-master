"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AssetMultiPicker from "@/components/AssetMultiPicker";
import ForecastingModelPicker from "@/components/ForecastingModelPicker";
import ModelPicker from "@/components/ModelPicker";
import PersonalityPicker from "@/components/PersonalityPicker";
import { api, ApiError, type Agent, type Personality, type TradeMode } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PERSONALITY_ICON, ROLE_LABEL, STRATEGY_LABEL } from "@/lib/personality";

const FMT_USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { activeCompanyId } = useAuth();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // editable fields
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState<Personality>("balanced");
  const [tradeMode, setTradeMode] = useState<TradeMode>("approve_each");
  const [allocation, setAllocation] = useState(0);
  const [maxPos, setMaxPos] = useState(25);
  const [llmProvider, setLlmProvider] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [forecastingModel, setForecastingModel] = useState("ttm-granite-r2");
  const [allowedAssets, setAllowedAssets] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!activeCompanyId || !params.id) return;
    api
      .getAgent(activeCompanyId, params.id)
      .then((a) => {
        setAgent(a);
        setName(a.name);
        setPersonality(a.personality);
        setTradeMode(a.trade_mode);
        setAllocation(a.allocated_balance_usd);
        setMaxPos(a.max_position_size_usd);
        setLlmProvider(a.llm_provider);
        setLlmModel(a.llm_model);
        setForecastingModel(a.forecasting_model);
        setAllowedAssets(a.allowed_assets ?? []);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "load failed"));
  }, [activeCompanyId, params.id]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function save() {
    if (!agent || !activeCompanyId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateAgent(activeCompanyId, agent.id, {
        name,
        personality,
        trade_mode: tradeMode,
        allocated_balance_usd: allocation,
        max_position_size_usd: maxPos,
        llm_provider: llmProvider,
        llm_model: llmModel,
        forecasting_model: forecastingModel,
        allowed_assets: allowedAssets,
      });
      setAgent(updated);
      setDirty(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!agent || !activeCompanyId) return;
    setBusy(true);
    try {
      const a = await api.activateAgent(activeCompanyId, agent.id);
      setAgent(a);
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!agent || !activeCompanyId) return;
    const reason = window.prompt("Why are you pausing this agent?") ?? undefined;
    setBusy(true);
    try {
      const a = await api.pauseAgent(activeCompanyId, agent.id, reason);
      setAgent(a);
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!agent || !activeCompanyId) return;
    if (!window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`))
      return;
    setBusy(true);
    try {
      await api.deleteAgent(activeCompanyId, agent.id);
      router.replace("/agents");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "delete failed");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-bear">{error}</p>
        <Link href="/agents" className="text-sm text-bull hover:opacity-80">
          ← Back to agents
        </Link>
      </main>
    );
  }
  if (!agent) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  }

  const statusColor = agent.is_paused
    ? "text-warning"
    : agent.is_active
      ? "text-bull"
      : "text-text-mute";
  const statusLabel = agent.is_paused
    ? `paused${agent.pause_reason ? ` — ${agent.pause_reason}` : ""}`
    : agent.is_active
      ? "active"
      : "idle";

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4">
        <Link href="/agents" className="text-xs text-text-mute hover:text-text">
          ← All agents
        </Link>
      </div>

      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {PERSONALITY_ICON[agent.personality]} {agent.name}
          </h1>
          <p className="text-sm text-text-mute">
            {ROLE_LABEL[agent.role]} · {agent.llm_model} ·{" "}
            <span className={statusColor}>● {statusLabel}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {agent.is_paused || !agent.is_active ? (
            <button
              type="button"
              onClick={activate}
              disabled={busy}
              className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              {agent.is_paused ? "Resume" : "Activate"}
            </button>
          ) : (
            <button
              type="button"
              onClick={pause}
              disabled={busy}
              className="rounded-md border border-warning/40 px-3 py-1.5 text-sm text-warning hover:bg-bg-elev-2 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          <button
            type="button"
            onClick={destroy}
            disabled={busy}
            className="rounded-md border border-bear/40 px-3 py-1.5 text-sm text-bear hover:bg-bg-elev-2 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </header>

      <div className="mb-4 flex gap-2">
        <Link
          href={`/agents/${agent.id}/chat`}
          className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
        >
          💬 Chat with {agent.name}
        </Link>
      </div>

      <div className="space-y-6">
        <Section title="Identity">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => markDirty(setName)(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            />
          </Field>
        </Section>

        <Section title="Brain (LLM)">
          <ModelPicker
            provider={llmProvider}
            model={llmModel}
            onChange={(p, m) => {
              markDirty(setLlmProvider)(p);
              setLlmModel(m);
            }}
          />
        </Section>

        <Section title="Forecast model">
          <ForecastingModelPicker
            value={forecastingModel}
            onChange={(k) => markDirty(setForecastingModel)(k)}
          />
        </Section>

        <Section title="Allowed assets">
          <AssetMultiPicker
            value={allowedAssets}
            onChange={(next) => markDirty(setAllowedAssets)(next)}
          />
          <p className="mt-2 text-[10px] text-text-mute">
            Empty = the agent can trade any symbol the gateway streams. Tick
            specific assets to restrict it. The gateway must already be
            subscribed to the symbol (see DERIV_DEFAULT_SYMBOL in .env) for
            ticks to flow.
          </p>
        </Section>

        <Section title="Personality">
          <PersonalityPicker
            value={personality}
            onChange={(p) => {
              markDirty(setPersonality)(p);
            }}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Readonly label="Kelly" value={agent.kelly_fraction.toFixed(2)} />
            <Readonly label="Min conf" value={agent.min_confidence_threshold.toFixed(2)} />
            <Readonly label="Min payoff" value={`${agent.min_payoff_ratio.toFixed(1)}×`} />
            <Readonly label="Trades/day" value={String(agent.max_trades_per_day)} />
          </div>
        </Section>

        <Section title="Behavior">
          <Field label="Trade mode">
            <div className="grid grid-cols-3 gap-2">
              {([
                ["autonomous", "Autonomous"],
                ["approve_each", "Approve each"],
                ["approve_above_threshold", "Approve > $X"],
              ] as [TradeMode, string][]).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => markDirty(setTradeMode)(k)}
                  className={`rounded-md border px-3 py-2 text-sm transition ${
                    tradeMode === k
                      ? "border-bull bg-bull-soft text-bull"
                      : "border-border bg-bg-elev-1 hover:border-bull/40"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        <Section title="Capital">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Allocation (USD)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={allocation}
                onChange={(e) => markDirty(setAllocation)(Number(e.target.value))}
                className="num w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
              />
            </Field>
            <Field label="Max position size (USD)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={maxPos}
                onChange={(e) => markDirty(setMaxPos)(Number(e.target.value))}
                className="num w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
              />
            </Field>
            <Readonly
              label="Current allocation"
              value={FMT_USD.format(agent.allocated_balance_usd)}
            />
            <Readonly
              label="Daily DD cap"
              value={`${agent.max_daily_drawdown_pct}%`}
            />
          </div>
        </Section>

        {agent.strategies.length > 0 && (
          <Section title="Strategies">
            <div className="flex flex-wrap gap-2">
              {agent.strategies.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-bg-elev-2 px-3 py-1 text-xs"
                >
                  {STRATEGY_LABEL[s] ?? s}
                </span>
              ))}
            </div>
          </Section>
        )}

        {dirty && (
          <div className="sticky bottom-4 flex items-center justify-between rounded-2xl border border-bull/40 bg-bull-soft p-3">
            <span className="text-sm">Unsaved changes</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm text-text-mute hover:text-text"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-text-mute">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
        {label}
      </span>
      {children}
    </label>
  );
}

function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elev-1 p-2">
      <div className="text-xs text-text-mute">{label}</div>
      <div className="num text-sm">{value}</div>
    </div>
  );
}
