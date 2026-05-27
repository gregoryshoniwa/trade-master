"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  api,
  ApiError,
  type PayrollRow,
  type PayrollSummary,
  type PayrollWindow,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PERSONALITY_ICON } from "@/lib/personality";

const WINDOWS: { value: PayrollWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "mtd", label: "Month-to-date" },
  { value: "all", label: "All time" },
];

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const FMT_USD_TINY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});

const FMT_INT = new Intl.NumberFormat("en-US");

export default function PayrollPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [data, setData] = useState<PayrollSummary | null>(null);
  const [window, setWindow] = useState<PayrollWindow>("30d");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.payroll(activeCompanyId, window));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, window]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (authLoading) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  }
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to view the payroll.</p>
        <Link
          href="/login"
          className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg"
        >
          Sign in
        </Link>
      </main>
    );
  }
  if (!active) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">
        Select or create a company first.
      </main>
    );
  }

  const employees = (data?.rows ?? []).filter((r) => r.category === "self_hosted");
  const freelancers = (data?.rows ?? []).filter((r) => r.category !== "self_hosted");

  const totalEmployees = employees.reduce((s, r) => s + r.cost_usd, 0);
  const totalFreelancers = freelancers.reduce((s, r) => s + r.cost_usd, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {active.name} — Payroll
          </h1>
          <p className="text-xs text-text-mute">
            What your AI employees and freelancers are costing you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-widest text-text-mute">
            Window
          </label>
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as PayrollWindow)}
            className="rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm outline-none focus:border-bull"
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Summary
          label="Spend in window"
          value={FMT_USD.format(data?.total_cost_usd ?? 0)}
          hint={`${(data?.days_in_window ?? 0).toFixed(1)} days`}
          accent="bull"
        />
        <Summary
          label="Projected monthly"
          value={FMT_USD.format(data?.projected_monthly_usd ?? 0)}
          hint="annualized × 30 / days"
          accent="amber"
        />
        <Summary
          label="Freelancer vs Employee"
          value={`${FMT_USD.format(totalFreelancers)} · ${FMT_USD.format(totalEmployees)}`}
          hint="cloud LLMs · self-hosted"
          accent="dim"
        />
      </div>

      <Section title="Freelancers (cloud LLMs — pay per token)">
        <Table rows={freelancers} loading={loading} emptyMsg="No freelancer calls in window." />
      </Section>

      {employees.length > 0 && (
        <Section title="Self-hosted employees (compute only)">
          <Table
            rows={employees}
            loading={loading}
            emptyMsg="No self-hosted models active."
          />
        </Section>
      )}
    </main>
  );
}

function Summary({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: "bull" | "amber" | "dim";
}) {
  const colour =
    accent === "bull"
      ? "text-bull"
      : accent === "amber"
        ? "text-warning"
        : "text-text-dim";
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 text-2xl font-medium ${colour}`}>{value}</div>
      <div className="mt-1 text-xs text-text-mute">{hint}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({
  rows,
  loading,
  emptyMsg,
}: {
  rows: PayrollRow[];
  loading: boolean;
  emptyMsg: string;
}) {
  if (loading && rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-card p-6 text-sm text-text-mute">
        Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
        {emptyMsg}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg-elev-1 text-text-mute">
          <tr>
            <Th>Agent</Th>
            <Th>Role</Th>
            <Th>Model</Th>
            <Th className="text-right">Calls</Th>
            <Th className="text-right">Tokens (in / out)</Th>
            <Th className="text-right">Cost</Th>
            <Th className="text-right">Projected / mo</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.agent_id ?? "internal"}-${r.model}`}
              className="border-b border-border last:border-0"
            >
              <Td>
                <span>
                  {r.personality &&
                    `${PERSONALITY_ICON[r.personality as keyof typeof PERSONALITY_ICON] ?? ""} `}
                  {r.name}
                </span>
              </Td>
              <Td className="text-text-dim">{r.role ?? "—"}</Td>
              <Td className="text-text-dim">
                <span className="block">{r.model_label ?? r.model}</span>
                <span className="num text-[10px] text-text-mute">
                  {r.provider}
                </span>
              </Td>
              <Td className="num text-right">{FMT_INT.format(r.calls)}</Td>
              <Td className="num text-right text-text-dim">
                {FMT_INT.format(r.input_tokens)} / {FMT_INT.format(r.output_tokens)}
              </Td>
              <Td className="num text-right text-text">
                {r.cost_usd === 0 && r.category === "self_hosted" ? (
                  <span className="text-text-mute">free</span>
                ) : (
                  FMT_USD_TINY.format(r.cost_usd)
                )}
              </Td>
              <Td className="num text-right text-text-dim">
                {r.cost_usd === 0 && r.category === "self_hosted" ? (
                  <span className="text-text-mute">—</span>
                ) : (
                  FMT_USD.format(r.projected_monthly_usd)
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-widest ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 align-top ${className}`}>{children}</td>;
}
