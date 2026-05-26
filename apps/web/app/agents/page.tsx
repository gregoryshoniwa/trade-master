"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AgentCard from "@/components/AgentCard";
import { api, ApiError, type Agent } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AgentsPage() {
  const { activeCompanyId, companies, loading: authLoading, me } = useAuth();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  useEffect(() => {
    if (!activeCompanyId) {
      setAgents(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .listAgents(activeCompanyId)
      .then((r) => setAgents(r.agents))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "load failed"),
      )
      .finally(() => setLoading(false));
  }, [activeCompanyId]);

  if (authLoading) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">
          Sign in to manage your AI agents.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg"
        >
          Sign in
        </Link>
      </main>
    );
  }

  if (!active) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">
          Create a company first to start building your AI trading firm.
        </p>
        <Link
          href="/companies/new"
          className="inline-block rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg"
        >
          + Create a company
        </Link>
      </main>
    );
  }

  // Group agents by role for a clean visual hierarchy
  const managers = (agents ?? []).filter((a) => a.role === "manager");
  const employees = (agents ?? []).filter((a) => a.role === "employee");
  const research = (agents ?? []).filter((a) => a.role === "research");

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {active.name} — Agents
          </h1>
          <p className="text-xs text-text-mute">
            {agents?.length ?? 0} agent{(agents?.length ?? 0) === 1 ? "" : "s"} ·
            Tier {active.current_asset_tier}
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
        >
          + New agent
        </Link>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
          {error}
        </div>
      )}

      {loading && !agents ? (
        <p className="text-sm text-text-mute">Loading agents…</p>
      ) : (
        <>
          {managers.length > 0 && (
            <Section title="Managers">
              <Grid>
                {managers.map((a) => (
                  <AgentCard key={a.id} agent={a} href={`/agents/${a.id}`} />
                ))}
              </Grid>
            </Section>
          )}
          {employees.length > 0 && (
            <Section title="Strategy Employees">
              <Grid>
                {employees.map((a) => (
                  <AgentCard key={a.id} agent={a} href={`/agents/${a.id}`} />
                ))}
              </Grid>
            </Section>
          )}
          {research.length > 0 && (
            <Section title="Research">
              <Grid>
                {research.map((a) => (
                  <AgentCard key={a.id} agent={a} href={`/agents/${a.id}`} />
                ))}
              </Grid>
            </Section>
          )}
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-text-mute">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
  );
}
