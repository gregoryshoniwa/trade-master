"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import PersonalityPicker from "@/components/PersonalityPicker";
import { api, ApiError, type AgentRole, type Personality } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ALL_STRATEGIES, DEFAULT_LLM_BY_ROLE, STRATEGY_LABEL } from "@/lib/personality";

export default function NewAgentPage() {
  const router = useRouter();
  const { activeCompanyId } = useAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("employee");
  const [personality, setPersonality] = useState<Personality>("balanced");
  const [strategies, setStrategies] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaults = DEFAULT_LLM_BY_ROLE[role];

  function toggleStrategy(s: string) {
    setStrategies((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSubmitting(true);
    setError(null);
    try {
      const agent = await api.createAgent(activeCompanyId, {
        name: name.trim(),
        role,
        llm_provider: defaults.provider,
        llm_model: defaults.model,
        personality,
        strategies: role === "employee" ? strategies : [],
      });
      router.replace(`/agents/${agent.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "create failed");
      setSubmitting(false);
    }
  }

  if (!activeCompanyId) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">
        Select a company first.
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-semibold">New agent</h1>
      <p className="mb-6 text-sm text-text-mute">
        Define a new AI employee for your trading firm.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        <Section title="Identity">
          <Label>Name</Label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tendai"
            className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            autoFocus
          />
        </Section>

        <Section title="Role">
          <div className="grid grid-cols-3 gap-2">
            {(["manager", "employee", "research"] as AgentRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-md border px-3 py-2 text-sm capitalize transition ${
                  role === r
                    ? "border-bull bg-bull-soft text-bull"
                    : "border-border bg-bg-elev-1 hover:border-bull/40"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-mute">
            {role === "manager"
              ? "Coordinates employees; reports to nobody."
              : role === "employee"
                ? "Runs one or more strategies; reports to a Manager."
                : "Shared brief: news, calendar, Polymarket/Kalshi sentiment."}
          </p>
        </Section>

        <Section title="Brain">
          <p className="text-xs text-text-mute">
            Defaults to{" "}
            <span className="text-text">
              {defaults.provider} · {defaults.model}
            </span>{" "}
            for this role. Edit later from the agent detail page.
          </p>
        </Section>

        <Section title="Personality">
          <PersonalityPicker value={personality} onChange={setPersonality} />
        </Section>

        {role === "employee" && (
          <Section title="Strategies">
            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_STRATEGIES.map((s) => (
                <label
                  key={s}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    strategies.includes(s)
                      ? "border-bull bg-bull-soft"
                      : "border-border bg-bg-elev-1 hover:border-bull/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={strategies.includes(s)}
                    onChange={() => toggleStrategy(s)}
                    className="h-4 w-4 accent-bull"
                  />
                  <span>{STRATEGY_LABEL[s]}</span>
                </label>
              ))}
            </div>
          </Section>
        )}

        {error && (
          <div className="rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-border px-3 py-2 text-sm hover:border-bull/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-md bg-bull px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create agent"}
          </button>
        </div>
      </form>
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
      {children}
    </span>
  );
}
