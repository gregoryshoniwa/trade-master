"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import ChatPanel from "@/components/ChatPanel";
import { api, ApiError, type Agent } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AgentChatPage() {
  const params = useParams<{ id: string }>();
  const { activeCompanyId } = useAuth();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId || !params.id) return;
    api
      .getAgent(activeCompanyId, params.id)
      .then(setAgent)
      .catch((e) => setError(e instanceof ApiError ? e.message : "load failed"));
  }, [activeCompanyId, params.id]);

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
  if (!agent || !activeCompanyId) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-6">
      <div className="mb-3">
        <Link
          href={`/agents/${agent.id}`}
          className="text-xs text-text-mute hover:text-text"
        >
          ← Back to {agent.name}
        </Link>
      </div>
      <ChatPanel agent={agent} companyId={activeCompanyId} />
    </main>
  );
}
