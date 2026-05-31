"use client";

/**
 * VoiceSession — browser-direct Gemini Live client.
 *
 * Architecture (matches Google's recommended ephemeral-token pattern):
 *
 *   1. Browser POSTs `/voice/session` to the api. Api mints a one-shot
 *      ephemeral token bound to this agent's exact model + voice + system
 *      prompt + tools (the GEMINI_API_KEY never leaves the server).
 *   2. Browser opens the WebSocket DIRECTLY to
 *      `wss://generativelanguage.googleapis.com/...?access_token=<token>`.
 *      No api WS proxy — which means no more cross-port WS failures when
 *      the dashboard is behind a tunnel that forwards 3000 but not 8000.
 *   3. Browser sends a tiny `setup` message (the constrained-token endpoint
 *      already knows the full config; setup just needs the model id to
 *      bind the session) and waits for `setupComplete`.
 *   4. Audio in: `realtimeInput.audio.data` base64 PCM16 16kHz mono frames.
 *      Audio out: `serverContent.modelTurn.parts[].inlineData` base64 PCM
 *      at 24kHz mono.
 *   5. Tool calls round-trip through our `/voice/tool` so the function
 *      runs with the user's auth context, then we send `toolResponse`
 *      back over the same WS.
 *   6. On hang-up, the browser POSTs the assembled transcript to
 *      `/voice/transcript` for conversation_messages + mem0 + usage.
 *
 * The half-duplex mic gate (pause uploads while playback is queued) is
 * kept — browser AEC doesn't see our scheduled BufferSource playback, so
 * without it the mic captures the speakers and Gemini hears its own voice.
 */

import { api } from "@/lib/api";

export type SessionState = "idle" | "connecting" | "ready" | "live" | "ended" | "error";

export type TranscriptTurn = { role: "user" | "assistant"; text: string };

export type SessionInit = {
  companyId: string;
  agentId: string;
};

export type SessionCallbacks = {
  onState?: (state: SessionState) => void;
  onError?: (message: string) => void;
  onReady?: (info: { voice: string; voiceLabel: string; model: string; requiresGeminiBrain: boolean }) => void;
  onTranscript?: (turn: TranscriptTurn) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onMicLevel?: (rms: number) => void;
  onClosed?: (durationMs: number) => void;
};

const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live native-audio out

type GeminiToolCall = {
  toolCall?: {
    functionCalls?: Array<{
      id?: string;
      name: string;
      args?: Record<string, unknown>;
    }>;
  };
};

type GeminiServerContent = {
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
  };
};

export class VoiceSession {
  private companyId: string;
  private agentId: string;
  private cb: SessionCallbacks;
  private ws: WebSocket | null = null;
  private state: SessionState = "idle";

  // Mic capture
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micNode: AudioWorkletNode | null = null;

  // Playback (24kHz from Gemini)
  private outCtx: AudioContext | null = null;
  private outNextStartTime = 0;

  // Session metadata + accounting
  private sessionId = "";
  private model = "";
  private transcript: TranscriptTurn[] = [];
  private startedAtMs = 0;

  constructor(init: SessionInit, cb: SessionCallbacks = {}) {
    this.companyId = init.companyId;
    this.agentId = init.agentId;
    this.cb = cb;
  }

  getState(): SessionState { return this.state; }

  private setState(s: SessionState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState?.(s);
  }

  async connect(): Promise<void> {
    if (this.state !== "idle") return;
    this.setState("connecting");
    try {
      const session = await api.mintVoiceSession(this.companyId, this.agentId);
      if (!session.available || !session.token || !session.ws_url) {
        throw new Error(
          session.available
            ? "voice session returned no token"
            : "voice is unavailable — GEMINI_API_KEY isn't configured on the api",
        );
      }
      this.sessionId = session.session_id;
      this.model = session.model;
      this.cb.onReady?.({
        voice: session.voice_name,
        voiceLabel: session.voice_label,
        model: session.model,
        requiresGeminiBrain: session.requires_gemini_brain,
      });
      // Run socket setup and mic init concurrently — independent paths
      // dominated by WS round-trip (~200-600ms) and AudioContext/worklet
      // boot + getUserMedia (~200-800ms cold). Sequencing them used to
      // double-cost cold start; parallel hides the smaller behind the
      // larger.
      await Promise.all([
        this.openSocket(session.ws_url, session.model, session.voice_name),
        this.startMic(),
      ]);
      this.startedAtMs = performance.now();
      this.setState("live");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.cb.onError?.(msg);
      this.setState("error");
      this.cleanup();
      throw e;
    }
  }

  // Wait for the WebSocket to negotiate, send setup, await setupComplete.
  // Past that point the browser-side onmessage handler does all the work.
  private openSocket(wsUrl: string, model: string, voiceName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      // setupComplete has to land within this window or we bail — otherwise
      // the modal sits in "connecting" forever (as it did when our setup
      // was too minimal for the constrained endpoint to ack).
      const setupTimer = setTimeout(() => {
        reject(new Error("Gemini setup didn't complete in time"));
        try { ws.close(); } catch { /* ignore */ }
      }, 15_000);
      ws.onclose = (ev) => {
        clearTimeout(setupTimer);
        if (this.state !== "ended" && this.state !== "error") {
          this.setState("ended");
          this.cb.onClosed?.(this.elapsedMs());
        }
        if (ev.code === 1008) this.cb.onError?.("ephemeral token rejected (1008)");
      };
      ws.onopen = () => {
        // Match the field shape Google's own ephemeral-token example sends.
        // The constrained token has the system_instruction + tools locked
        // server-side, so we don't repeat those. But the constrained
        // endpoint *does* require generationConfig/transcription stubs in
        // the setup envelope or it silently never acks (the failure mode
        // we hit: WS open, no setupComplete, modal stuck "connecting").
        ws.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
      };
      const handle = (parsed: unknown) => {
        const obj = parsed as Record<string, unknown>;
        if ("setupComplete" in obj) {
          clearTimeout(setupTimer);
          resolve();
          return;
        }
        // `goAway` and `error` frames also signal "we won't be acking" —
        // surface them so the modal shows the broker reason instead of
        // hanging on the timeout.
        if (obj.goAway || obj.error) {
          clearTimeout(setupTimer);
          reject(new Error(`Gemini Live: ${JSON.stringify(obj).slice(0, 200)}`));
          return;
        }
        this.onServerMessage(parsed);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try { handle(JSON.parse(ev.data)); } catch { /* drop malformed */ }
        } else if (ev.data instanceof Blob) {
          // Gemini's first frame is sometimes a Blob containing the
          // setupComplete JSON. We have to read async — onmessage can't
          // be async, so we route through the same handle() afterward.
          ev.data.text().then((txt) => {
            try { handle(JSON.parse(txt)); } catch { /* drop */ }
          });
        }
      };
    });
  }

  private onServerMessage(msg: unknown) {
    const m = msg as GeminiServerContent & GeminiToolCall;
    if (m.serverContent) {
      const sc = m.serverContent;
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          const b64 = part.inlineData?.data;
          if (b64) this.schedulePlayback(b64);
        }
      }
      const ti = sc.inputTranscription?.text;
      if (ti) {
        this.transcript.push({ role: "user", text: ti });
        this.cb.onTranscript?.({ role: "user", text: ti });
      }
      const to = sc.outputTranscription?.text;
      if (to) {
        this.transcript.push({ role: "assistant", text: to });
        this.cb.onTranscript?.({ role: "assistant", text: to });
      }
    }
    if (m.toolCall?.functionCalls) {
      void this.handleToolCalls(m.toolCall.functionCalls);
    }
  }

  private async handleToolCalls(
    calls: Array<{ id?: string; name: string; args?: Record<string, unknown> }>,
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const responses: Array<{ id?: string; name: string; response: unknown }> = [];
    for (const c of calls) {
      this.cb.onToolCall?.(c.name, c.args ?? {});
      try {
        const r = await api.runVoiceTool(this.companyId, this.agentId, {
          session_id: this.sessionId,
          call_id: c.id,
          name: c.name,
          arguments: c.args ?? {},
        });
        responses.push({ id: c.id, name: c.name, response: r.response });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        responses.push({ id: c.id, name: c.name, response: { error: err } });
      }
    }
    try {
      this.ws.send(JSON.stringify({
        toolResponse: { functionResponses: responses },
      }));
    } catch { /* WS may have closed between tool exec and reply */ }
  }

  private async startMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.micStream = stream;
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.audioWorklet.addModule("/audio/mic-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "mic-capture", {
      processorOptions: { sampleRate: ctx.sampleRate },
    });
    node.port.onmessage = (ev) => this.onMicFrame(ev.data);
    source.connect(node);
    this.micCtx = ctx;
    this.micNode = node;
  }

  private onMicFrame(data: { pcm?: ArrayBuffer; level?: number }) {
    if (data.level != null) this.cb.onMicLevel?.(data.level);
    if (!data.pcm) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Half-duplex gate: while the agent is speaking, mute the mic
    // upstream. Browser AEC can't see our scheduled BufferSource playback,
    // so without this the mic captures the speakers, Gemini's VAD never
    // closes the user turn, and the call appears "stuck".
    if (this.isAgentSpeaking()) return;
    const bytes = new Uint8Array(data.pcm);
    const b64 = arrayBufferToBase64(bytes);
    // BidiGenerateContentRealtimeInput. The mime_type tells Gemini exactly
    // how to interpret the bytes — we send PCM16 LE @ 16kHz.
    this.ws.send(JSON.stringify({
      realtimeInput: {
        audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
      },
    }));
  }

  private isAgentSpeaking(): boolean {
    if (!this.outCtx) return false;
    const grace = 0.15; // seconds — avoids clipping the last syllable
    return this.outNextStartTime > this.outCtx.currentTime + grace;
  }

  private async schedulePlayback(b64: string) {
    if (!this.outCtx) {
      this.outCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.outNextStartTime = this.outCtx.currentTime;
    }
    if (this.outCtx.state === "suspended") await this.outCtx.resume();
    const pcm = base64ToInt16(b64);
    if (pcm.length === 0) return;
    const buf = this.outCtx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
    const chan = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) chan[i] = pcm[i] / 0x8000;
    const src = this.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outCtx.destination);
    const startAt = Math.max(this.outNextStartTime, this.outCtx.currentTime);
    src.start(startAt);
    this.outNextStartTime = startAt + buf.duration;
  }

  endTurn() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Manual end-of-utterance. Optional — the model's VAD will close
      // the turn on its own when the mic goes quiet.
      this.ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    }
  }

  async close(): Promise<void> {
    const durationMs = this.elapsedMs();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.cleanup();
    this.setState("ended");
    // Best-effort transcript persistence. We don't await this in the
    // critical path because the modal closes synchronously.
    if (this.sessionId && (this.transcript.length || durationMs > 1000)) {
      void api.submitVoiceTranscript(this.companyId, this.agentId, {
        session_id: this.sessionId,
        duration_ms: Math.round(durationMs),
        model: this.model,
        turns: this.transcript,
      }).catch(() => { /* persistence is best-effort */ });
    }
    this.cb.onClosed?.(durationMs);
  }

  private cleanup() {
    try { this.micNode?.disconnect(); } catch { /* ignore */ }
    try { this.micCtx?.close(); } catch { /* ignore */ }
    try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { this.outCtx?.close(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.micNode = null;
    this.micCtx = null;
    this.micStream = null;
    this.outCtx = null;
    this.ws = null;
  }

  private elapsedMs(): number {
    return this.startedAtMs ? performance.now() - this.startedAtMs : 0;
  }
}

// ── helpers ────────────────────────────────────────────────

function arrayBufferToBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunk to avoid blowing the call stack on large frames.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(s);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Int16Array(len / 2);
  for (let i = 0; i < out.length; i++) {
    const lo = bin.charCodeAt(i * 2);
    const hi = bin.charCodeAt(i * 2 + 1);
    let val = (hi << 8) | lo;
    if (val >= 0x8000) val -= 0x10000;
    out[i] = val;
  }
  return out;
}
