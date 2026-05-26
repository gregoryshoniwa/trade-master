"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

type TickPayload = {
  symbol: string;
  quote: number;
  epoch: number; // seconds
  bid?: number;
  ask?: number;
};

type ServerMessage =
  | { type: "hello"; seq: number; ts_ms: number; payload: { server: string; phase: number } }
  | { type: "tick"; seq: number; ts_ms: number; payload: TickPayload };

type Props = { symbol: string; wsUrl: string };

const FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export default function TickChart({ symbol, wsUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastEpochRef = useRef<number>(0);

  const [latest, setLatest] = useState<TickPayload | null>(null);
  const [prev, setPrev] = useState<TickPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [tickCount, setTickCount] = useState(0);

  // Init chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0B0E14" },
        textColor: "#9CA3AF",
        fontFamily:
          'ui-monospace, "JetBrains Mono Variable", "IBM Plex Mono", Menlo, monospace',
      },
      grid: {
        vertLines: { color: "#1F2937" },
        horzLines: { color: "#1F2937" },
      },
      rightPriceScale: {
        borderColor: "#1F2937",
      },
      timeScale: {
        borderColor: "#1F2937",
        timeVisible: true,
        secondsVisible: true,
      },
      width: containerRef.current.clientWidth,
      height: 480,
      crosshair: {
        vertLine: { color: "#A8FF35", labelBackgroundColor: "#A8FF35" },
        horzLine: { color: "#A8FF35", labelBackgroundColor: "#A8FF35" },
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#A8FF35",
      lineWidth: 2,
      priceLineColor: "#A8FF35",
      priceLineStyle: 2,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // WebSocket connection with reconnect
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
      ws.onmessage = (ev) => {
        try {
          const msg: ServerMessage = JSON.parse(ev.data);
          if (msg.type !== "tick") return;
          if (msg.payload.symbol !== symbol) return;

          // LWC requires strictly increasing timestamps. If two ticks share
          // the same epoch second, bump by +1ms via fractional time (not
          // supported on Line series) — use a monotonic counter instead.
          let t = msg.payload.epoch;
          if (t <= lastEpochRef.current) t = lastEpochRef.current + 1;
          lastEpochRef.current = t;

          seriesRef.current?.update({
            time: t as UTCTimestamp,
            value: msg.payload.quote,
          });

          setPrev((p) => latest ?? p);
          setLatest(msg.payload);
          setTickCount((n) => n + 1);
        } catch {
          // ignore malformed
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl, symbol]);

  const delta =
    latest && prev ? latest.quote - prev.quote : null;
  const deltaColor =
    delta == null ? "text-neutral" : delta >= 0 ? "text-bull" : "text-bear";
  const deltaGlyph = delta == null ? "●" : delta >= 0 ? "▲" : "▼";

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-6 shadow-glow">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-text-mute">
            {symbol} · live
          </div>
          <div className="num mt-1 flex items-baseline gap-3 text-4xl font-medium">
            <span>{latest ? FMT.format(latest.quote) : "—"}</span>
            <span className={`text-base ${deltaColor}`}>
              {deltaGlyph} {delta != null ? FMT.format(Math.abs(delta)) : "0.0000"}
            </span>
          </div>
        </div>
        <div className="text-right text-xs">
          <div className={connected ? "text-bull" : "text-bear"}>
            {connected ? "● connected" : "○ disconnected"}
          </div>
          <div className="num mt-1 text-text-mute">{tickCount} ticks</div>
        </div>
      </div>

      <div ref={containerRef} className="w-full" />

      {latest && (
        <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
          <Stat label="Bid" value={latest.bid != null ? FMT.format(latest.bid) : "—"} />
          <Stat label="Ask" value={latest.ask != null ? FMT.format(latest.ask) : "—"} />
          <Stat
            label="Epoch"
            value={new Date(latest.epoch * 1000).toLocaleTimeString("en-GB", { hour12: false })}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elev-1 p-3">
      <div className="text-text-mute">{label}</div>
      <div className="num mt-1 text-text">{value}</div>
    </div>
  );
}
