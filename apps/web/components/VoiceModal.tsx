"use client";

import { useEffect, useRef, useState } from "react";

import { VoiceSession, type SessionState, type TranscriptTurn } from "@/lib/voice/session";

type Props = {
  open: boolean;
  agentName: string;
  agentLlmLabel: string; // e.g. "google/gemini-2.5-flash" or "anthropic/claude-sonnet-4-6"
  companyId: string;
  agentId: string;
  onClose: () => void;
};

const STATE_LABEL: Record<SessionState, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  ready: "Connected",
  live: "Live",
  ended: "Ended",
  error: "Error",
};

export default function VoiceModal({
  open, agentName, agentLlmLabel, companyId, agentId, onClose,
}: Props) {
  const [state, setState] = useState<SessionState>("idle");
  const [info, setInfo] = useState<{ voiceLabel: string; model: string; requiresGeminiBrain: boolean } | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const sessionRef = useRef<VoiceSession | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  async function start() {
    if (sessionRef.current) return;
    setError(null);
    setTranscript([]);
    // The session now mints its own ephemeral token via the api and opens
    // the WSS directly to Gemini — no more local WS URL to construct, no
    // more cross-port WS failures when the dashboard runs behind a tunnel
    // that forwards 3000 transparently but not 8000.
    const sess = new VoiceSession({ companyId, agentId }, {
      onState: setState,
      onError: setError,
      onReady: (i) => setInfo({
        voiceLabel: i.voiceLabel, model: i.model, requiresGeminiBrain: i.requiresGeminiBrain,
      }),
      onTranscript: (t) => setTranscript((prev) => mergeTranscript(prev, t)),
      onMicLevel: setMicLevel,
      onClosed: () => { /* state event already handles it */ },
    });
    sessionRef.current = sess;
    try {
      await sess.connect();
    } catch {
      sessionRef.current = null;
    }
  }

  async function stop() {
    if (sessionRef.current) {
      await sessionRef.current.close();
      sessionRef.current = null;
    }
  }

  // Auto-stop + cleanup on close.
  useEffect(() => {
    if (!open && sessionRef.current) {
      void sessionRef.current.close();
      sessionRef.current = null;
      setState("idle");
      setInfo(null);
      setTranscript([]);
      setError(null);
      setMicLevel(0);
    }
  }, [open]);

  // Auto-scroll transcript.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  if (!open) return null;

  const live = state === "live" || state === "ready";
  const ringLevel = Math.min(1, micLevel * 6); // amplify for visibility
  const isPreLive = state === "idle" || state === "connecting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-full max-h-[720px] w-full max-w-2xl flex-col rounded-2xl border border-border bg-bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">🎙 Voice chat — {agentName}</div>
            <div className="truncate text-xs text-text-mute">
              {info ? (
                <>
                  Voice <span className="text-text">{info.voiceLabel}</span>
                  {info.requiresGeminiBrain ? (
                    <> · voice via Gemini Live · text brain: <span className="num">{agentLlmLabel}</span></>
                  ) : (
                    <> · on <span className="num">{info.model}</span></>
                  )}
                </>
              ) : (
                <>State: {STATE_LABEL[state]}</>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-xs text-text-dim hover:border-bear/40 hover:text-bear"
          >
            Close
          </button>
        </header>

        {/* Call button + mic ring */}
        <div className="flex flex-col items-center justify-center py-6">
          <button
            type="button"
            onClick={live ? stop : start}
            disabled={state === "connecting"}
            className={`relative grid h-28 w-28 place-items-center rounded-full transition disabled:opacity-50 ${
              live ? "bg-bear text-white hover:bg-bear/80" : "bg-accent text-white hover:bg-accent-strong"
            }`}
            aria-label={live ? "End call" : "Start call"}
          >
            <span
              className="absolute inset-0 rounded-full ring-2 ring-bull/40 transition"
              style={{
                transform: `scale(${1 + 0.18 * ringLevel})`,
                opacity: live ? 0.5 + 0.5 * ringLevel : 0,
              }}
            />
            <span className="relative">
              {state === "connecting" ? <Spinner /> : live ? <HangupIcon /> : <CallIcon />}
            </span>
          </button>
          <div className="mt-3 text-xs text-text-mute">
            {isPreLive && !error && (info ? "Tap to start" : "Tap to start (will request mic permission)")}
            {live && "Speak naturally — tap to hang up"}
            {state === "ended" && "Session ended"}
            {state === "error" && (error ?? "Something went wrong")}
          </div>
        </div>

        {/* Transcript */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto border-t border-border px-4 py-3">
          {transcript.length === 0 && (
            <div className="grid h-full place-items-center text-center text-xs text-text-mute">
              Your conversation transcript will appear here as you talk.
            </div>
          )}
          <div className="space-y-2">
            {transcript.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                    t.role === "user"
                      ? "rounded-br-sm bg-accent-soft text-text"
                      : "rounded-bl-sm bg-bg-elev-2 text-text"
                  }`}
                >
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="border-t border-border bg-bear-soft px-4 py-2 text-xs text-bear">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// Gemini sends transcripts as incremental deltas. Coalesce consecutive
// turns of the same role into one bubble so the UI doesn't fragment.
function mergeTranscript(prev: TranscriptTurn[], next: TranscriptTurn): TranscriptTurn[] {
  if (prev.length === 0) return [next];
  const last = prev[prev.length - 1];
  if (last.role === next.role) {
    const updated = { ...last, text: (last.text + " " + next.text).trim() };
    return [...prev.slice(0, -1), updated];
  }
  return [...prev, next];
}

function CallIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.07 4.18 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8 10a16 16 0 0 0 6 6l1.36-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function HangupIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: "rotate(135deg)" }}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.07 4.18 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8 10a16 16 0 0 0 6 6l1.36-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
