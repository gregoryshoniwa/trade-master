"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  api,
  ApiError,
  type Agent,
  type ChatMessage,
  type ChatToolCall,
  type Conversation,
} from "@/lib/api";
import { PERSONALITY_ICON } from "@/lib/personality";

type Props = {
  agent: Agent;
  companyId: string;
};

export default function ChatPanel({ agent, companyId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(
    async (selectId?: string | null) => {
      try {
        const r = await api.listConversations(companyId, agent.id);
        setConversations(r.conversations);
        const target = selectId ?? r.conversations[0]?.id ?? null;
        if (target) {
          await openConversation(target);
        } else {
          setConversationId(null);
          setMessages([]);
        }
      } catch {
        /* no convo yet */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companyId, agent.id],
  );

  const openConversation = useCallback(
    async (id: string) => {
      setConversationId(id);
      try {
        const m = await api.getMessages(companyId, agent.id, id);
        setMessages(m.messages);
      } catch {
        setMessages([]);
      }
    },
    [companyId, agent.id],
  );

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    loadConversations();
  }, [loadConversations]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setError(null);
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const optimistic: ChatMessage = {
      id: `tmp_${Date.now()}`,
      role: "user",
      content: text,
      tool_calls: null,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setInput("");

    try {
      const r = await api.sendChat(companyId, agent.id, {
        message: text,
        conversation_id: conversationId ?? undefined,
      });
      const isNewConv = !conversationId;
      setConversationId(r.conversation_id);
      setMessages((m) => {
        const withoutOptimistic = m.filter((x) => x.id !== optimistic.id);
        return [...withoutOptimistic, r.user_message, r.assistant_message];
      });
      if (isNewConv) {
        // Refresh sidebar to include the new conversation, but DON'T flip
        // the active one — we just opened it.
        const list = await api.listConversations(companyId, agent.id);
        setConversations(list.conversations);
      } else {
        // Bump last_message_at locally so the sidebar reorders.
        setConversations((prev) =>
          [...prev].sort((a, b) => {
            const ta = a.id === r.conversation_id ? Date.now() : new Date(a.last_message_at ?? a.created_at).getTime();
            const tb = b.id === r.conversation_id ? Date.now() : new Date(b.last_message_at ?? b.created_at).getTime();
            return tb - ta;
          }),
        );
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "send failed");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[640px] gap-3">
      <aside className="hidden w-60 shrink-0 flex-col rounded-2xl border border-border bg-bg-card md:flex">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs uppercase tracking-widest text-text-mute">
            Chats
          </span>
          <button
            type="button"
            onClick={newConversation}
            className="text-xs text-bull hover:opacity-80"
          >
            + new
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-text-mute">
              No past chats yet.
            </p>
          )}
          {conversations.map((c) => {
            const active = c.id === conversationId;
            const ts = c.last_message_at ?? c.created_at;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                className={`mb-1 block w-full rounded-md px-2 py-2 text-left text-xs transition ${
                  active
                    ? "bg-bg-elev-2 text-text"
                    : "text-text-dim hover:bg-bg-elev-1 hover:text-text"
                }`}
              >
                <div className="line-clamp-2 leading-snug">
                  {c.title ?? "(untitled)"}
                </div>
                <div className="num mt-1 text-[10px] text-text-mute">
                  {new Date(ts).toLocaleString("en-GB", {
                    hour12: false,
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex flex-1 flex-col rounded-2xl border border-border bg-bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-elev-2">
              {agent.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium">
                {PERSONALITY_ICON[agent.personality]} {agent.name}
              </div>
              <div className="text-xs text-text-mute">{agent.llm_model}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={newConversation}
            className="text-xs text-text-mute hover:text-text"
          >
            + New chat
          </button>
        </header>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !sending && (
            <div className="flex h-full items-center justify-center text-center text-sm text-text-mute">
              <div>
                <div className="mb-2 text-2xl">
                  {PERSONALITY_ICON[agent.personality]}
                </div>
                <div>
                  Say hi to {agent.name}. Try:{" "}
                  <span className="text-text">"What are you set up to do?"</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {messages.map((m) => (
              <Message key={m.id} msg={m} agentName={agent.name} />
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-bg-elev-2 px-4 py-2 text-sm text-text-mute">
                  <span className="animate-pulse">●</span>
                  <span className="ml-1 animate-pulse delay-100">●</span>
                  <span className="ml-1 animate-pulse delay-200">●</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-md border border-bear/40 bg-bear-soft px-3 py-2 text-sm text-bear">
            {error}
          </div>
        )}

        <form onSubmit={onSend} className="border-t border-border p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${agent.name}…`}
              disabled={sending}
              className="flex-1 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-md bg-bull px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Message({ msg, agentName }: { msg: ChatMessage; agentName: string }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
            isUser
              ? "rounded-br-sm bg-bull-soft text-text"
              : "rounded-bl-sm bg-bg-elev-2 text-text"
          }`}
        >
          {msg.content || (
            <span className="italic text-text-mute">
              (no text — tool call only)
            </span>
          )}
        </div>
        {!isUser && msg.tool_calls && msg.tool_calls.length > 0 && (
          <ToolCalls calls={msg.tool_calls} />
        )}
        <div
          className={`mt-1 text-[10px] text-text-mute ${
            isUser ? "text-right" : ""
          }`}
        >
          {isUser ? "You" : agentName} ·{" "}
          {new Date(msg.created_at).toLocaleTimeString("en-GB", {
            hour12: false,
          })}
        </div>
      </div>
    </div>
  );
}

function ToolCalls({ calls }: { calls: ChatToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] uppercase tracking-widest text-text-mute hover:text-text"
      >
        🔧 {calls.length} tool call{calls.length === 1 ? "" : "s"}{" "}
        {expanded ? "▾" : "▸"}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {calls.map((c) => (
            <pre
              key={c.id}
              className="num overflow-x-auto rounded-md bg-bg-elev-1 p-2 text-[11px] text-text-dim"
            >
              {c.name}({JSON.stringify(c.arguments)})
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
