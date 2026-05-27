"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";

type TickPayload = {
  symbol: string;
  quote: number;
  epoch: number;
  bid?: number;
  ask?: number;
};

type ForecastRow = { t: number; p10: number; p50: number; p90: number };

type ForecastPayload = {
  model: string;
  asset: string;
  asof_ts: number;
  last_price: number;
  horizon_steps: number;
  forecast: ForecastRow[];
  point_direction: "up" | "down" | "flat";
  confidence_score: number;
  latency_ms: number;
};

type ServerMessage =
  | { type: "hello"; seq: number; ts_ms: number; payload: Record<string, unknown> }
  | { type: "tick"; seq: number; ts_ms: number; payload: TickPayload }
  | { type: "forecast"; seq: number; ts_ms: number; payload: ForecastPayload };

type Props = { symbol: string; wsUrl: string };

const FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export default function TickChart({ symbol, wsUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tickSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p90SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastEpochRef = useRef<number>(0);

  const [latest, setLatest] = useState<TickPayload | null>(null);
  const [prev, setPrev] = useState<TickPayload | null>(null);
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [tickCount, setTickCount] = useState(0);

  // Init chart + series
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
      rightPriceScale: { borderColor: "#1F2937" },
      timeScale: {
        borderColor: "#1F2937",
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 24,         // leave room for forward forecast
        barSpacing: 4,
      },
      width: containerRef.current.clientWidth,
      height: 480,
      crosshair: {
        vertLine: { color: "#A8FF35", labelBackgroundColor: "#A8FF35" },
        horzLine: { color: "#A8FF35", labelBackgroundColor: "#A8FF35" },
      },
    });

    const tickSeries = chart.addSeries(LineSeries, {
      color: "#A8FF35",
      lineWidth: 2,
      priceLineColor: "#A8FF35",
      priceLineStyle: 2,
      lastValueVisible: true,
    });

    // Forecast band: two thin lines + a translucent fill between them via
    // AreaSeries on p90 with a lower-bound trick.
    const p90 = chart.addSeries(LineSeries, {
      color: "rgba(168, 255, 53, 0.55)",
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const p10 = chart.addSeries(LineSeries, {
      color: "rgba(168, 255, 53, 0.55)",
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const p50 = chart.addSeries(LineSeries, {
      color: "#FBBF24",          // amber for prediction
      lineWidth: 2,
      lineStyle: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    tickSeriesRef.current = tickSeries;
    p50SeriesRef.current = p50;
    p10SeriesRef.current = p10;
    p90SeriesRef.current = p90;

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
      tickSeriesRef.current = null;
      p50SeriesRef.current = null;
      p10SeriesRef.current = null;
      p90SeriesRef.current = null;
    };
  }, []);

  // WebSocket connection
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
        if (!cancelled) reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const msg: ServerMessage = JSON.parse(ev.data);
          if (msg.type === "tick") {
            if (msg.payload.symbol !== symbol) return;
            let t = msg.payload.epoch;
            if (t <= lastEpochRef.current) t = lastEpochRef.current + 1;
            lastEpochRef.current = t;
            tickSeriesRef.current?.update({
              time: t as UTCTimestamp,
              value: msg.payload.quote,
            });
            setPrev((p) => latest ?? p);
            setLatest(msg.payload);
            setTickCount((n) => n + 1);
          } else if (msg.type === "forecast") {
            if (msg.payload.asset !== symbol) return;
            // Render forecast lines extending right from "now".
            const fcast = msg.payload.forecast;
            // Anchor the forecast at the price at asof so the lines visually
            // continue from the current quote rather than jumping.
            const anchorTime = msg.payload.asof_ts;
            const anchorPrice = msg.payload.last_price;
            const p50Data: LineData[] = [
              { time: anchorTime as UTCTimestamp, value: anchorPrice },
              ...fcast.map((f) => ({
                time: f.t as UTCTimestamp,
                value: f.p50,
              })),
            ];
            const p10Data: LineData[] = [
              { time: anchorTime as UTCTimestamp, value: anchorPrice },
              ...fcast.map((f) => ({
                time: f.t as UTCTimestamp,
                value: f.p10,
              })),
            ];
            const p90Data: LineData[] = [
              { time: anchorTime as UTCTimestamp, value: anchorPrice },
              ...fcast.map((f) => ({
                time: f.t as UTCTimestamp,
                value: f.p90,
              })),
            ];
            p50SeriesRef.current?.setData(p50Data);
            p10SeriesRef.current?.setData(p10Data);
            p90SeriesRef.current?.setData(p90Data);
            setForecast(msg.payload);
          }
        } catch {
          /* swallow malformed */
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

  const delta = latest && prev ? latest.quote - prev.quote : null;
  const deltaColor =
    delta == null ? "text-neutral" : delta >= 0 ? "text-bull" : "text-bear";
  const deltaGlyph = delta == null ? "●" : delta >= 0 ? "▲" : "▼";

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-6 shadow-glow">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
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

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Bid"
          value={latest?.bid != null ? FMT.format(latest.bid) : "—"}
        />
        <Stat
          label="Ask"
          value={latest?.ask != null ? FMT.format(latest.ask) : "—"}
        />
        <Stat
          label="Epoch"
          value={
            latest
              ? new Date(latest.epoch * 1000).toLocaleTimeString("en-GB", {
                  hour12: false,
                })
              : "—"
          }
        />
        <ForecastStat forecast={forecast} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elev-1 p-3 text-xs">
      <div className="text-text-mute">{label}</div>
      <div className="num mt-1 text-text">{value}</div>
    </div>
  );
}

function ForecastStat({ forecast }: { forecast: ForecastPayload | null }) {
  if (!forecast) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-bg-elev-1 p-3 text-xs">
        <div className="text-text-mute">TTM forecast</div>
        <div className="num mt-1 text-warning">warming up…</div>
      </div>
    );
  }
  const dir = forecast.point_direction;
  const glyph = dir === "up" ? "▲" : dir === "down" ? "▼" : "●";
  const dirColor =
    dir === "up" ? "text-bull" : dir === "down" ? "text-bear" : "text-neutral";
  return (
    <div className="rounded-lg border border-amber-500/30 bg-bg-elev-1 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-warning">TTM · {forecast.horizon_steps}-step</span>
        <span className="num text-text-mute">{forecast.latency_ms.toFixed(0)}ms</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`num text-sm ${dirColor}`}>{glyph} {dir}</span>
        <span className="num text-xs text-text-mute">
          conf {(forecast.confidence_score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
