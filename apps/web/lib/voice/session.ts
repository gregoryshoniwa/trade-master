"use client";

/**
 * VoiceSession — browser-side controller for a Gemini Live call.
 *
 * Architecture: the browser opens a WebSocket to OUR api (not directly
 * to Google). The api proxies to Gemini Live so the API key never reaches
 * the browser and tool calls run in-process. We just shuttle PCM and
 * transcript events back and forth.
 *
 * State machine:
 *   "idle" → "connecting" → "ready" → "live" → "ended"
 *                                         ↓
 *                                       "error"
 *
 * Wire protocol (text frames, JSON-tagged) — kept in sync with
 * services/api/app/routes/voice.py:
 *   browser → api:  {type:"audio", data:b64} | {type:"end_turn"} | {type:"bye"}
 *   api → browser:  {type:"ready", voice, model, requires_gemini_brain}
 *                  | {type:"audio", data:b64}
 *                  | {type:"transcript", role:"user"|"assistant", text}
 *                  | {type:"tool_call", name, arguments}
 *                  | {type:"error", message}
 *                  | {type:"closed", duration_ms}
 */

export type SessionState = "idle" | "connecting" | "ready" | "live" | "ended" | "error";

export type TranscriptTurn = { role: "user" | "assistant"; text: string };

export type SessionInit = {
  url: string; // ws[s]://host/api/v1/companies/{cid}/agents/{aid}/voice/connect
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

export class VoiceSession {
  private ws: WebSocket | null = null;
  private state: SessionState = "idle";
  private cb: SessionCallbacks;
  private url: string;

  // Mic capture
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micNode: AudioWorkletNode | null = null;

  // Playback
  private outCtx: AudioContext | null = null;
  private outNextStartTime = 0;

  constructor(init: SessionInit, cb: SessionCallbacks = {}) {
    this.url = init.url;
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
      await this.openSocket();
      await this.startMic();
      this.setState("live");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.cb.onError?.(msg);
      this.setState("error");
      this.cleanup();
      throw e;
    }
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onmessage = (ev) => this.onServerMessage(ev.data);
      ws.onerror = () => reject(new Error("WebSocket connection failed"));
      ws.onclose = (ev) => {
        if (this.state !== "ended" && this.state !== "error") {
          this.setState("ended");
          this.cb.onClosed?.(0);
        }
        // 4401 = our custom unauth code on the server.
        if (ev.code === 4401) this.cb.onError?.("not authenticated");
      };
      ws.onopen = () => {
        // The server sends {type:"ready", …} once it has opened the
        // upstream Gemini Live session. Resolve at that point.
        const onReady = (data: string) => {
          try {
            const m = JSON.parse(data);
            if (m && m.type === "ready") {
              ws.removeEventListener("message", listener);
              this.cb.onReady?.({
                voice: m.voice, voiceLabel: m.voice_label,
                model: m.model, requiresGeminiBrain: !!m.requires_gemini_brain,
              });
              this.setState("ready");
              resolve();
            }
          } catch { /* drop malformed */ }
        };
        const listener = (e: MessageEvent) => onReady(e.data);
        ws.addEventListener("message", listener, { once: false });
      };
    });
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
    // No need to connect to destination — we don't want to hear ourselves.
    this.micCtx = ctx;
    this.micNode = node;
  }

  private onMicFrame(data: { pcm?: ArrayBuffer; level?: number }) {
    if (data.level != null) this.cb.onMicLevel?.(data.level);
    if (!data.pcm) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(data.pcm);
    const b64 = arrayBufferToBase64(bytes);
    this.ws.send(JSON.stringify({ type: "audio", data: b64 }));
  }

  private onServerMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case "audio":
        this.schedulePlayback(msg.data);
        break;
      case "transcript":
        if (msg.text) this.cb.onTranscript?.({ role: msg.role, text: msg.text });
        break;
      case "tool_call":
        this.cb.onToolCall?.(msg.name, msg.arguments ?? {});
        break;
      case "error":
        this.cb.onError?.(msg.message ?? "unknown error");
        this.setState("error");
        break;
      case "closed":
        this.setState("ended");
        this.cb.onClosed?.(msg.duration_ms ?? 0);
        break;
    }
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
      this.ws.send(JSON.stringify({ type: "end_turn" }));
    }
  }

  async close(): Promise<void> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "bye" }));
      }
    } catch { /* ignore */ }
    this.cleanup();
    this.setState("ended");
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
