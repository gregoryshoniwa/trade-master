"use client";

/**
 * Bottom dock on the dashboard. Lists every agent in the active
 * company; each row shows the agent name + LLM badge and two actions:
 *   💬  → opens /agents/{id}/chat (existing full-page composer)
 *   📞  → opens VoiceModal in-place for a Gemini-Live voice call
 *
 * Sized to fit in viewport — the dashboard above gets `flex-1`, the
 * dock is a fixed-height strip so the user never has to scroll to
 * reach it.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import VoiceModal from "@/components/VoiceModal";
import { api, type Agent } from "@/lib/api";

type Props = {
  companyId: string;
};

export default function AgentDock({ companyId }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [voiceFor, setVoiceFor] = useState<Agent | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listAgents(companyId)
      .then((r) => { if (!cancelled) setAgents(r.agents); })
      .catch(() => { /* silent — dock just renders empty */ });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!agents.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-text-mute">
        No agents yet —{" "}
        <Link href="/agents/new" className="ml-1 text-accent hover:underline">
          hire your first employee
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full items-center gap-2 overflow-x-auto px-3">
        <div className="shrink-0 text-[10px] uppercase tracking-widest text-text-mute">
          Talk to
        </div>
        {agents.map((a) => (
          <AgentPill
            key={a.id}
            agent={a}
            onCall={() => setVoiceFor(a)}
          />
        ))}
      </div>

      {voiceFor && (
        <VoiceModal
          open={!!voiceFor}
          agentName={voiceFor.name}
          agentLlmLabel={`${voiceFor.llm_provider}/${voiceFor.llm_model}`}
          companyId={companyId}
          agentId={voiceFor.id}
          onClose={() => setVoiceFor(null)}
        />
      )}
    </>
  );
}

function AgentPill({ agent, onCall }: { agent: Agent; onCall: () => void }) {
  // Color tint by role so manager/research/employee read at a glance.
  const tint =
    agent.role === "manager"
      ? "border-accent/40 bg-accent-soft"
      : agent.role === "research"
        ? "border-warning/40 bg-warning-soft"
        : "border-border bg-bg-card";

  return (
    <div className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 ${tint}`}>
      <span
        className="max-w-[120px] truncate text-[11px] font-medium"
        title={`${agent.name} · ${agent.llm_provider}/${agent.llm_model}`}
      >
        {agent.name}
      </span>
      <Link
        href={`/agents/${agent.id}/chat`}
        className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[10px] text-text-dim hover:border-accent/40 hover:text-text"
        title={`Chat with ${agent.name}`}
      >
        💬
      </Link>
      <button
        type="button"
        onClick={onCall}
        className="rounded-md border border-bull/40 bg-bull/10 px-1.5 py-0.5 text-[10px] text-bull hover:bg-bull/20"
        title={`Voice call ${agent.name}`}
      >
        📞
      </button>
    </div>
  );
}
