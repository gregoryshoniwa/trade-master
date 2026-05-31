"use client";

/**
 * Top-bar "Talk to" dropdown. Lists every agent in the active company;
 * each row has 💬 chat (links to the agent's chat page) and 📞 voice
 * (opens VoiceModal inline). Replaces the bottom AgentDock so the
 * dashboard's chart gets full vertical real estate.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import VoiceModal from "@/components/VoiceModal";
import { api, type Agent } from "@/lib/api";

type Props = {
  companyId: string;
};

export default function AgentMenu({ companyId }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [voiceFor, setVoiceFor] = useState<Agent | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listAgents(companyId)
      .then((r) => { if (!cancelled) setAgents(r.agents); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [companyId]);

  // Click-outside to close. The voice modal is rendered above with its
  // own backdrop, so we don't intercept its events.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-bg-elev-2 px-2 py-1.5 text-sm hover:border-accent/40"
        title="Chat or call any agent"
      >
        <span>💬</span>
        <span className="hidden sm:inline">Talk to</span>
        <span className="text-text-mute">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border border-border bg-bg-card p-1 shadow-xl">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-text-mute">
            Your team
          </div>
          {agents.length === 0 ? (
            <Link
              href="/agents/new"
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-2 text-sm text-accent hover:bg-bg-elev-2"
            >
              + Hire your first agent
            </Link>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {agents.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  onChat={() => setOpen(false)}
                  onCall={() => {
                    setVoiceFor(a);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

function AgentRow({
  agent, onChat, onCall,
}: { agent: Agent; onChat: () => void; onCall: () => void }) {
  const tint =
    agent.role === "manager"
      ? "text-accent"
      : agent.role === "research"
        ? "text-warning"
        : "text-text";
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-elev-2">
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${tint}`} title={agent.name}>
          {agent.name}
        </div>
        <div className="truncate text-[10px] text-text-mute" title={`${agent.llm_provider}/${agent.llm_model}`}>
          {agent.llm_provider}/{agent.llm_model}
        </div>
      </div>
      <Link
        href={`/agents/${agent.id}/chat`}
        onClick={onChat}
        className="rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text-dim hover:border-accent/40 hover:text-text"
        title={`Chat with ${agent.name}`}
      >
        💬
      </Link>
      <button
        type="button"
        onClick={onCall}
        className="rounded-md border border-bull/40 bg-bull/10 px-2 py-1 text-[12px] text-bull hover:bg-bull/20"
        title={`Voice call ${agent.name}`}
      >
        📞
      </button>
    </div>
  );
}
