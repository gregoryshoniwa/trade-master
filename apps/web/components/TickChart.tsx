"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { api, type TradeIntent } from "@/lib/api";
import { cssVar, useTheme } from "@/lib/theme";

/** Chart colors derived live from the active theme's CSS variables. */
function chartColors() {
  const accent = cssVar("--color-accent") || "#2962FF";
  const warning = cssVar("--color-warning") || "#FFB74D";
  const text = cssVar("--color-text-dim") || "#9BA3AF";
  const border = cssVar("--color-border") || "#252C36";
  const bg = cssVar("--color-bg-card") || "#161B22";
  // ~40% alpha band derived from the warning hex.
  const bandSoft = warning.startsWith("#") && warning.length === 7 ? `${warning}66` : warning;
  return { accent, warning, text, border, bg, bandSoft };
}

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

type Props = {
  symbol: string;
  wsUrl: string;
  decimals?: number;
  displayName?: string;
  /** Filtered to the current symbol by the caller. Rendered as arrow markers
   *  at executed_at (entry) / closed_at (exit, win or loss colored), plus
   *  stop/target price lines for currently-open positions. */
  intents?: TradeIntent[];
};

export default function TickChart({ symbol, wsUrl, decimals = 4, displayName, intents = [] }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tickSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p90SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastEpochRef = useRef<number>(0);
  // Track the symbol the live socket is rendering. If it changes, we ignore
  // any in-flight messages that beat the unmount.
  const symbolRef = useRef(symbol);
  // Trade-overlay state: currently-rendered price lines for OPEN positions.
  // Keyed by intent id so we can remove them surgically when an intent closes.
  const priceLinesRef = useRef<Map<string, IPriceLine[]>>(new Map());
  // v5 markers are a series primitive, not a series method.
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [latest, setLatest] = useState<TickPayload | null>(null);
  const [prev, setPrev] = useState<TickPayload | null>(null);
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [historyRows, setHistoryRows] = useState<number | null>(null);
  const theme = useTheme();

  const fmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  // Init chart + series once
  useEffect(() => {
    if (!containerRef.current) return;

    const c = chartColors();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: c.bg },
        textColor: c.text,
        fontFamily:
          'ui-monospace, "JetBrains Mono Variable", "IBM Plex Mono", Menlo, monospace',
      },
      grid: {
        vertLines: { color: c.border },
        horzLines: { color: c.border },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 24,
        barSpacing: 4,
      },
      width: containerRef.current.clientWidth,
      height: 480,
      crosshair: {
        vertLine: { color: c.accent, labelBackgroundColor: c.accent },
        horzLine: { color: c.accent, labelBackgroundColor: c.accent },
      },
    });

    const tickSeries = chart.addSeries(LineSeries, {
      color: c.accent,
      lineWidth: 2,
      priceLineColor: c.accent,
      priceLineStyle: 2,
      lastValueVisible: true,
    });
    const p90 = chart.addSeries(LineSeries, {
      color: c.bandSoft,
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const p10 = chart.addSeries(LineSeries, {
      color: c.bandSoft,
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    const p50 = chart.addSeries(LineSeries, {
      color: c.warning,
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
    markersRef.current = createSeriesMarkers(tickSeries, []);

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
      markersRef.current = null;
    };
  }, []);

  // Re-skin the chart when the user flips dark/light. lightweight-charts
  // doesn't observe CSS-var changes itself; we have to push the new values.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = chartColors();
    chart.applyOptions({
      layout: { background: { color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.border }, horzLines: { color: c.border } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
      crosshair: {
        vertLine: { color: c.accent, labelBackgroundColor: c.accent },
        horzLine: { color: c.accent, labelBackgroundColor: c.accent },
      },
    });
    tickSeriesRef.current?.applyOptions({ color: c.accent, priceLineColor: c.accent });
    p50SeriesRef.current?.applyOptions({ color: c.warning });
    p10SeriesRef.current?.applyOptions({ color: c.bandSoft });
    p90SeriesRef.current?.applyOptions({ color: c.bandSoft });
  }, [theme]);

  // Render trade overlays (entry/exit markers + stop/target price lines for
  // currently-open positions). Rebuilds on every intents change — the dataset
  // is small (recent ~50) and lightweight-charts handles it instantly.
  useEffect(() => {
    const tick = tickSeriesRef.current;
    if (!tick) return;
    const c = chartColors();
    const cBull = cssVar("--color-bull") || "#26A69A";
    const cBear = cssVar("--color-bear") || "#EF5350";

    // 1. Markers: entry arrow at executed_at, exit flag at closed_at.
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    for (const i of intents) {
      if (i.executed_at) {
        const t = (new Date(i.executed_at).getTime() / 1000) as UTCTimestamp;
        const up = i.direction === "up";
        markers.push({
          time: t,
          position: up ? "belowBar" : "aboveBar",
          color: up ? cBull : cBear,
          shape: up ? "arrowUp" : "arrowDown",
          text: `${i.agent_name} $${i.stake_usd.toFixed(0)}`,
        });
      }
      if (i.closed_at && i.realized_pnl_usd != null) {
        const t = (new Date(i.closed_at).getTime() / 1000) as UTCTimestamp;
        const win = i.realized_pnl_usd >= 0;
        markers.push({
          time: t,
          position: "inBar",
          color: win ? cBull : cBear,
          shape: win ? "circle" : "square",
          text: `${win ? "+" : ""}${i.realized_pnl_usd.toFixed(2)}`,
        });
      }
    }
    // setMarkers wants ascending order.
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);

    // 2. Price lines: stop + target for currently-open positions only.
    const openNow = new Set(
      intents
        .filter((i) => i.status === "executed" && i.closed_at == null)
        .map((i) => i.id),
    );

    // Remove lines whose intent has closed or is no longer in scope.
    for (const [id, lines] of priceLinesRef.current) {
      if (!openNow.has(id)) {
        lines.forEach((l) => tick.removePriceLine(l));
        priceLinesRef.current.delete(id);
      }
    }
    // Add lines for any open intent we're not yet rendering.
    for (const i of intents) {
      if (!openNow.has(i.id) || priceLinesRef.current.has(i.id)) continue;
      const lines: IPriceLine[] = [];
      if (i.stop_loss != null) {
        lines.push(
          tick.createPriceLine({
            price: i.stop_loss,
            color: cBear,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `${i.agent_name} STOP`,
          }),
        );
      }
      if (i.take_profit != null) {
        lines.push(
          tick.createPriceLine({
            price: i.take_profit,
            color: cBull,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `${i.agent_name} TGT`,
          }),
        );
      }
      priceLinesRef.current.set(i.id, lines);
    }
    // We also re-skin existing lines if theme changed (c is unused on purpose
    // outside of color reads above — adding a no-op reference keeps the lint
    // happy without changing behavior).
    void c;
  }, [intents]);

  // Wipe overlays when the user switches symbols — the next intents-prop
  // change for the new symbol will repopulate them.
  useEffect(() => {
    const tick = tickSeriesRef.current;
    if (!tick) return;
    markersRef.current?.setMarkers([]);
    for (const lines of priceLinesRef.current.values()) {
      lines.forEach((l) => tick.removePriceLine(l));
    }
    priceLinesRef.current.clear();
  }, [symbol]);

  // Symbol change → reset state, load history, reset series
  useEffect(() => {
    symbolRef.current = symbol;
    lastEpochRef.current = 0;
    setLatest(null);
    setPrev(null);
    setForecast(null);
    setTickCount(0);
    setHistoryRows(null);

    // Clear forecast series; history below replaces tick series.
    p50SeriesRef.current?.setData([]);
    p10SeriesRef.current?.setData([]);
    p90SeriesRef.current?.setData([]);

    let cancelled = false;
    api
      .symbolHistory(symbol, 30, 1)
      .then((r) => {
        if (cancelled || symbolRef.current !== symbol) return;
        const lines: LineData[] = r.rows.map((row) => ({
          time: row.t as UTCTimestamp,
          value: row.value,
        }));
        tickSeriesRef.current?.setData(lines);
        if (lines.length) {
          lastEpochRef.current = lines[lines.length - 1].time as number;
          chartRef.current?.timeScale().fitContent();
        }
        setHistoryRows(lines.length);
      })
      .catch(() => {
        if (!cancelled) {
          tickSeriesRef.current?.setData([]);
          setHistoryRows(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // WebSocket connection (single connection for the chart's lifetime; we
  // filter incoming messages by `symbolRef.current`).
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
          const activeSymbol = symbolRef.current;

          if (msg.type === "tick") {
            if (msg.payload.symbol !== activeSymbol) return;
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
            if (msg.payload.asset !== activeSymbol) return;
            const fcast = msg.payload.forecast;
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
  }, [wsUrl]);

  const delta = latest && prev ? latest.quote - prev.quote : null;
  const deltaColor =
    delta == null ? "text-neutral" : delta >= 0 ? "text-bull" : "text-bear";
  const deltaGlyph = delta == null ? "●" : delta >= 0 ? "▲" : "▼";

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-6 shadow-glow">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-text-mute">
            {displayName ?? symbol} · live
          </div>
          <div className="num mt-1 flex items-baseline gap-3 text-4xl font-medium">
            <span>{latest ? fmt.format(latest.quote) : "—"}</span>
            <span className={`text-base ${deltaColor}`}>
              {deltaGlyph} {delta != null ? fmt.format(Math.abs(delta)) : "0.0000"}
            </span>
          </div>
        </div>
        <div className="text-right text-xs">
          <div className={connected ? "text-bull" : "text-bear"}>
            {connected ? "● connected" : "○ disconnected"}
          </div>
          <div className="num mt-1 text-text-mute">
            {tickCount} ticks{historyRows != null ? ` · ${historyRows} backfill` : ""}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="w-full" />

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Bid"
          value={latest?.bid != null ? fmt.format(latest.bid) : "—"}
        />
        <Stat
          label="Ask"
          value={latest?.ask != null ? fmt.format(latest.ask) : "—"}
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
        <span className={`num text-sm ${dirColor}`}>
          {glyph} {dir}
        </span>
        <span className="num text-xs text-text-mute">
          conf {(forecast.confidence_score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
