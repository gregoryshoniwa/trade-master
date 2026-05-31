"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type CandlestickData,
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
  const bg = cssVar("--color-bg") || "#0E1116";
  const bull = cssVar("--color-bull") || "#26A69A";
  const bear = cssVar("--color-bear") || "#EF5350";
  // Lighter grid than border — Deriv-style subtle ruling. Picks a low-
  // alpha version of the border color so it works on any theme.
  const grid = border.startsWith("#") && border.length === 7 ? `${border}88` : border;
  // ~40% alpha band derived from the warning hex.
  const bandSoft = warning.startsWith("#") && warning.length === 7 ? `${warning}66` : warning;
  // Area-fill stops for the primary series. Accent at the top fading to
  // transparent at the bottom for that clean Deriv/TradingView feel.
  const areaTop = accent.startsWith("#") && accent.length === 7 ? `${accent}44` : accent;
  const areaBottom = accent.startsWith("#") && accent.length === 7 ? `${accent}00` : accent;
  return { accent, warning, text, border, grid, bg, bull, bear, bandSoft, areaTop, areaBottom };
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

export type ChartMode = "line" | "candles";

type Props = {
  symbol: string;
  wsUrl: string;
  decimals?: number;
  displayName?: string;
  /** Trade intents filtered to the current symbol — drives markers and the
   *  stop/target price lines for currently-open positions. */
  intents?: TradeIntent[];
  /** Optional id of a single intent to emphasize on the chart (larger
   *  marker, brighter price lines). Click-through from the agents panel. */
  highlightedIntentId?: string | null;
};

const CANDLE_GRANULARITY = 60; // seconds per OHLC bar in candle mode
const CANDLE_COUNT = 240; // ~4 hours of 1-min candles on initial load
const DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089";

export default function TickChart({
  symbol, wsUrl, decimals = 4, displayName,
  intents = [], highlightedIntentId = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const p50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p10SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const p90SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Moving-average overlays — added below the price series so the price
  // line stays the most prominent. Periods chosen to mirror what's most
  // commonly drawn on retail charts: SMA-20 for the short trend, SMA-50
  // for the medium one.
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  // Source data for indicator computation. We keep our own array because
  // lightweight-charts series don't expose their backing data, and a
  // running window over the visible price series is the only honest way
  // to compute an SMA without bringing in a TA dep.
  const priceHistoryRef = useRef<{ time: UTCTimestamp; close: number }[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<Map<string, IPriceLine[]>>(new Map());
  const lastEpochRef = useRef<number>(0);
  // Active-symbol/mode refs so async messages from stale connections drop.
  const symbolRef = useRef(symbol);
  // Current in-progress candle bar (for candle mode + live ticks).
  const curBarRef = useRef<CandlestickData<UTCTimestamp> | null>(null);

  const [latest, setLatest] = useState<TickPayload | null>(null);
  const [prev, setPrev] = useState<TickPayload | null>(null);
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [historyRows, setHistoryRows] = useState<number | null>(null);
  const [mode, setMode] = useState<ChartMode>("line");
  const modeRef = useRef<ChartMode>(mode);
  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);
  const theme = useTheme();

  const fmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  // ── chart init (once) ──────────────────────────────────────────────
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
      // Lighter grid + invisible scale borders so the chart blends with
      // the dashboard surface instead of sitting in a hard frame.
      grid: {
        vertLines: { color: c.grid, style: 1 },
        horzLines: { color: c.grid, style: 1 },
      },
      rightPriceScale: {
        borderColor: c.bg,
        borderVisible: false,
      },
      timeScale: {
        borderColor: c.bg,
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 24,
        barSpacing: 4,
      },
      width: containerRef.current.clientWidth,
      // Fill the parent's available height when it has one (the fullscreen
      // dashboard layout), fall back to 480 when the parent is unsized
      // (e.g. backtest preview, modal mount).
      height: containerRef.current.clientHeight || 480,
      crosshair: {
        vertLine: { color: c.accent, labelBackgroundColor: c.accent },
        horzLine: { color: c.accent, labelBackgroundColor: c.accent },
      },
    });

    // Primary "line" mode now renders as an area with a gradient fill —
    // matches the Deriv/TradingView clean look while still showing the
    // trace clearly. CandlestickSeries is the alternate, toggled by the
    // mode chips above the chart.
    const lineSeries = chart.addSeries(AreaSeries, {
      lineColor: c.accent,
      topColor: c.areaTop,
      bottomColor: c.areaBottom,
      lineWidth: 2,
      priceLineColor: c.accent,
      priceLineStyle: 2,
      lastValueVisible: true,
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: c.bull, borderUpColor: c.bull, wickUpColor: c.bull,
      downColor: c.bear, borderDownColor: c.bear, wickDownColor: c.bear,
      // Hidden by default — line mode is initial.
      visible: false,
    });
    const p90 = chart.addSeries(LineSeries, {
      color: c.bandSoft, lineWidth: 1, lineStyle: 2,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    const p10 = chart.addSeries(LineSeries, {
      color: c.bandSoft, lineWidth: 1, lineStyle: 2,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    const p50 = chart.addSeries(LineSeries, {
      color: c.warning, lineWidth: 2, lineStyle: 1,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    // SMA-20 / SMA-50 overlays. Hidden by default; the user opts in via
    // the chips above the chart.
    const sma20 = chart.addSeries(LineSeries, {
      color: c.bull, lineWidth: 1, lineStyle: 1, visible: false,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    const sma50 = chart.addSeries(LineSeries, {
      color: c.bear, lineWidth: 1, lineStyle: 1, visible: false,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    lineSeriesRef.current = lineSeries;
    candleSeriesRef.current = candleSeries;
    p50SeriesRef.current = p50;
    p10SeriesRef.current = p10;
    p90SeriesRef.current = p90;
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;
    // Attach markers to whichever series is currently primary; we re-attach
    // on mode switch so markers follow the visible price.
    markersRef.current = createSeriesMarkers(lineSeries, []);

    // Width + height now track the container, not the viewport, so the
    // chart resizes when the dashboard's flex layout reflows (open the
    // agent dock, toggle the goal strip, drag a side panel, etc.).
    const resizeChart = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 480,
        });
      }
    };
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      ro = new ResizeObserver(resizeChart);
      ro.observe(containerRef.current);
    }
    window.addEventListener("resize", resizeChart);

    return () => {
      window.removeEventListener("resize", resizeChart);
      ro?.disconnect();
      chart.remove();
      chartRef.current = null;
      lineSeriesRef.current = null;
      candleSeriesRef.current = null;
      p50SeriesRef.current = null;
      p10SeriesRef.current = null;
      p90SeriesRef.current = null;
      sma20Ref.current = null;
      sma50Ref.current = null;
      markersRef.current = null;
    };
  }, []);

  // ── indicator toggles ──────────────────────────────────────────────
  // We hide the series rather than blank its data so flipping back on
  // doesn't need a full recompute.
  useEffect(() => {
    sma20Ref.current?.applyOptions({ visible: showSMA20 });
  }, [showSMA20]);
  useEffect(() => {
    sma50Ref.current?.applyOptions({ visible: showSMA50 });
  }, [showSMA50]);

  // ── theme re-skin ──────────────────────────────────────────────────
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
    lineSeriesRef.current?.applyOptions({
      lineColor: c.accent,
      topColor: c.areaTop,
      bottomColor: c.areaBottom,
      priceLineColor: c.accent,
    });
    candleSeriesRef.current?.applyOptions({
      upColor: c.bull, borderUpColor: c.bull, wickUpColor: c.bull,
      downColor: c.bear, borderDownColor: c.bear, wickDownColor: c.bear,
    });
    p50SeriesRef.current?.applyOptions({ color: c.warning });
    p10SeriesRef.current?.applyOptions({ color: c.bandSoft });
    p90SeriesRef.current?.applyOptions({ color: c.bandSoft });
    sma20Ref.current?.applyOptions({ color: c.bull });
    sma50Ref.current?.applyOptions({ color: c.bear });
  }, [theme]);

  // ── symbol or mode change → reload history + reset overlays ─────────
  useEffect(() => {
    symbolRef.current = symbol;
    modeRef.current = mode;
    lastEpochRef.current = 0;
    curBarRef.current = null;
    setLatest(null);
    setPrev(null);
    setForecast(null);
    setTickCount(0);
    setHistoryRows(null);
    p50SeriesRef.current?.setData([]);
    p10SeriesRef.current?.setData([]);
    p90SeriesRef.current?.setData([]);
    sma20Ref.current?.setData([]);
    sma50Ref.current?.setData([]);
    priceHistoryRef.current = [];
    markersRef.current?.setMarkers([]);
    for (const lines of priceLinesRef.current.values()) {
      const tip = lineSeriesRef.current;
      if (tip) lines.forEach((l) => tip.removePriceLine(l));
    }
    priceLinesRef.current.clear();

    // Swap which series is visible — keep both registered so theme/series
    // switching is cheap; just toggle data + visibility.
    lineSeriesRef.current?.applyOptions({ visible: mode === "line" });
    candleSeriesRef.current?.applyOptions({ visible: mode === "candles" });
    // Markers/lines always attach to the visible price series.
    if (markersRef.current) {
      markersRef.current.detach();
      const host = mode === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
      if (host) markersRef.current = createSeriesMarkers(host, []);
    }

    let cancelled = false;
    if (mode === "line") {
      // Backfill from QuestDB via api (1-second buckets).
      api
        .symbolHistory(symbol, 30, 1)
        .then((r) => {
          if (cancelled || symbolRef.current !== symbol || modeRef.current !== "line") return;
          const lines: LineData[] = r.rows.map((row) => ({
            time: row.t as UTCTimestamp,
            value: row.value,
          }));
          lineSeriesRef.current?.setData(lines);
          // Seed indicator history off the backfill so SMAs aren't blank
          // until enough live ticks arrive.
          priceHistoryRef.current = lines.map((l) => ({
            time: l.time as UTCTimestamp, close: l.value,
          }));
          recomputeIndicators(priceHistoryRef.current, sma20Ref.current, sma50Ref.current);
          if (lines.length) {
            lastEpochRef.current = lines[lines.length - 1].time as number;
            chartRef.current?.timeScale().fitContent();
          }
          setHistoryRows(lines.length);
        })
        .catch(() => {
          if (!cancelled) {
            lineSeriesRef.current?.setData([]);
            setHistoryRows(0);
          }
        });
    } else {
      // Backfill candles directly from Deriv's public ticks_history (no auth).
      // One-shot WS request; closes after the response.
      void (async () => {
        try {
          const candles = await fetchDerivCandles(symbol, CANDLE_GRANULARITY, CANDLE_COUNT);
          if (cancelled || symbolRef.current !== symbol || modeRef.current !== "candles") return;
          candleSeriesRef.current?.setData(candles);
          priceHistoryRef.current = candles.map((c) => ({
            time: c.time, close: c.close,
          }));
          recomputeIndicators(priceHistoryRef.current, sma20Ref.current, sma50Ref.current);
          if (candles.length) {
            curBarRef.current = candles[candles.length - 1];
            lastEpochRef.current = candles[candles.length - 1].time as number;
            chartRef.current?.timeScale().fitContent();
          }
          setHistoryRows(candles.length);
        } catch {
          if (!cancelled) {
            candleSeriesRef.current?.setData([]);
            setHistoryRows(0);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [symbol, mode]);

  // ── WebSocket (gateway tick + forecast feed) ───────────────────────
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
          const activeMode = modeRef.current;

          if (msg.type === "tick") {
            if (msg.payload.symbol !== activeSymbol) return;
            let t = msg.payload.epoch;
            const quote = msg.payload.quote;

            if (activeMode === "line") {
              if (t <= lastEpochRef.current) t = lastEpochRef.current + 1;
              lastEpochRef.current = t;
              lineSeriesRef.current?.update({
                time: t as UTCTimestamp,
                value: quote,
              });
              appendIndicatorSample(
                priceHistoryRef.current, t as UTCTimestamp, quote,
                sma20Ref.current, sma50Ref.current,
              );
            } else {
              // Aggregate into the current OHLC bar.
              const bucket = (Math.floor(t / CANDLE_GRANULARITY) * CANDLE_GRANULARITY) as UTCTimestamp;
              const cur = curBarRef.current;
              if (!cur || (cur.time as number) < (bucket as number)) {
                const bar: CandlestickData<UTCTimestamp> = {
                  time: bucket, open: quote, high: quote, low: quote, close: quote,
                };
                curBarRef.current = bar;
                candleSeriesRef.current?.update(bar);
                appendIndicatorSample(
                  priceHistoryRef.current, bucket, quote,
                  sma20Ref.current, sma50Ref.current,
                );
              } else {
                cur.high = Math.max(cur.high, quote);
                cur.low = Math.min(cur.low, quote);
                cur.close = quote;
                candleSeriesRef.current?.update(cur);
                // Update the last sample's close (same bar still in progress)
                // so the indicator tracks the live tip.
                const hist = priceHistoryRef.current;
                if (hist.length && hist[hist.length - 1].time === cur.time) {
                  hist[hist.length - 1].close = quote;
                  recomputeLatestSMA(hist, sma20Ref.current, sma50Ref.current);
                }
              }
              lastEpochRef.current = t;
            }

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
              ...fcast.map((f) => ({ time: f.t as UTCTimestamp, value: f.p50 })),
            ];
            const p10Data: LineData[] = [
              { time: anchorTime as UTCTimestamp, value: anchorPrice },
              ...fcast.map((f) => ({ time: f.t as UTCTimestamp, value: f.p10 })),
            ];
            const p90Data: LineData[] = [
              { time: anchorTime as UTCTimestamp, value: anchorPrice },
              ...fcast.map((f) => ({ time: f.t as UTCTimestamp, value: f.p90 })),
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

  // ── Trade overlays (markers + price lines), incl. highlight ────────
  useEffect(() => {
    const cBull = cssVar("--color-bull") || "#26A69A";
    const cBear = cssVar("--color-bear") || "#EF5350";
    const cAccent = cssVar("--color-accent") || "#2962FF";

    // Only draw markers for trades whose timestamp falls within the
    // chart's actually-rendered data range. Without this guard,
    // executed_at values from earlier today get clamped to the left
    // edge of the (much shorter) live tick window and pile on top of
    // each other — the symptom the user saw in line mode where the
    // markers showed up but the agents panel disagreed.
    const firstTickTime = priceHistoryRef.current[0]?.time as UTCTimestamp | undefined;
    const inRange = (epoch: number): boolean =>
      firstTickTime === undefined || epoch >= (firstTickTime as number);

    const markers: SeriesMarker<UTCTimestamp>[] = [];
    for (const i of intents) {
      const isHi = i.id === highlightedIntentId;
      if (i.executed_at) {
        const epoch = Math.floor(new Date(i.executed_at).getTime() / 1000);
        if (inRange(epoch)) {
          const up = i.direction === "up";
          markers.push({
            time: epoch as UTCTimestamp,
            position: up ? "belowBar" : "aboveBar",
            color: isHi ? cAccent : up ? cBull : cBear,
            shape: up ? "arrowUp" : "arrowDown",
            text: `${i.agent_name} $${i.stake_usd.toFixed(0)}`,
            size: isHi ? 2 : 1,
          });
        }
      }
      if (i.closed_at && i.realized_pnl_usd != null) {
        const epoch = Math.floor(new Date(i.closed_at).getTime() / 1000);
        if (inRange(epoch)) {
          const win = i.realized_pnl_usd >= 0;
          markers.push({
            time: epoch as UTCTimestamp,
            position: "inBar",
            color: win ? cBull : cBear,
            shape: win ? "circle" : "square",
            text: `${win ? "+" : ""}${i.realized_pnl_usd.toFixed(2)}`,
          });
        }
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);

    const tick = mode === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    if (!tick) return;
    const openNow = new Set(
      intents
        .filter((i) => i.status === "executed" && i.closed_at == null)
        .map((i) => i.id),
    );
    for (const [id, lines] of priceLinesRef.current) {
      if (!openNow.has(id)) {
        lines.forEach((l) => tick.removePriceLine(l));
        priceLinesRef.current.delete(id);
      }
    }
    for (const i of intents) {
      if (!openNow.has(i.id) || priceLinesRef.current.has(i.id)) continue;
      const isHi = i.id === highlightedIntentId;
      const lines: IPriceLine[] = [];
      if (i.stop_loss != null) {
        lines.push(tick.createPriceLine({
          price: i.stop_loss, color: cBear,
          lineWidth: isHi ? 2 : 1, lineStyle: 2,
          axisLabelVisible: true, title: `${i.agent_name} STOP`,
        }));
      }
      if (i.take_profit != null) {
        lines.push(tick.createPriceLine({
          price: i.take_profit, color: cBull,
          lineWidth: isHi ? 2 : 1, lineStyle: 2,
          axisLabelVisible: true, title: `${i.agent_name} TGT`,
        }));
      }
      priceLinesRef.current.set(i.id, lines);
    }
  }, [intents, highlightedIntentId, mode]);

  const delta = latest && prev ? latest.quote - prev.quote : null;
  const deltaColor = delta == null ? "text-text-mute" : delta >= 0 ? "text-bull" : "text-bear";
  const deltaGlyph = delta == null ? "●" : delta >= 0 ? "▲" : "▼";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Floating top overlay — symbol pill + price. Sits ON the chart
          instead of stealing vertical space above it. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1">
        <div className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-md border border-border bg-bg-card/80 px-3 py-1.5 backdrop-blur">
          <span className="text-[10px] uppercase tracking-widest text-text-mute">
            {displayName ?? symbol}
          </span>
          <span className="num text-sm font-medium" title="Live last price">
            {latest ? fmt.format(latest.quote) : "—"}
          </span>
          <span className={`text-[11px] ${deltaColor}`}>
            {deltaGlyph} {delta != null ? fmt.format(Math.abs(delta)) : "—"}
          </span>
        </div>
      </div>

      {/* Floating top-right cluster — one consolidated pill with mode,
          indicators, fit and live status sharing a single backdrop so
          they read as one control bar instead of four separate badges
          fighting for space next to the agents panel. */}
      <div className="pointer-events-auto absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border bg-bg-card/80 p-1 text-[11px] backdrop-blur">
        <ModeToggle value={mode} onChange={setMode} />
        <span className="h-4 w-px bg-border" aria-hidden />
        <IndicatorChips
          sma20={showSMA20} onSMA20={setShowSMA20}
          sma50={showSMA50} onSMA50={setShowSMA50}
        />
        <span className="h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => chartRef.current?.timeScale().fitContent()}
          className="rounded px-1.5 py-0.5 text-text-dim hover:bg-bg-elev-2 hover:text-text"
          title="Fit all data into view"
        >
          Fit
        </button>
        <span
          className={`rounded px-1.5 py-0.5 ${connected ? "text-bull" : "text-bear"}`}
          title={`${tickCount} ticks${historyRows != null ? ` · ${historyRows} backfill` : ""}`}
        >
          {connected ? "● live" : "○ off"}
        </span>
      </div>

      {/* The canvas itself fills the wrapper. The bottom info strip
          sits OUTSIDE the canvas (separate flex child) so the time
          axis labels never collide with bid/ask/forecast pills. */}
      <div ref={containerRef} className="min-h-0 w-full flex-1" />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pt-2 text-[11px]">
        <div className="inline-flex items-center gap-3 rounded-md border border-border bg-bg-card/60 px-3 py-1">
          <Inline label="Bid" value={latest?.bid != null ? fmt.format(latest.bid) : "—"} />
          <Inline label="Ask" value={latest?.ask != null ? fmt.format(latest.ask) : "—"} />
          <Inline label="Time" value={
            latest ? new Date(latest.epoch * 1000).toLocaleTimeString("en-GB", { hour12: false }) : "—"
          } />
        </div>
        {forecast && (
          <div className="max-w-[260px] rounded-md border border-warning/40 bg-bg-card/60 px-3 py-1">
            <ForecastBadge forecast={forecast} />
          </div>
        )}
      </div>
    </div>
  );
}

function Inline({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-text-mute">{label}</span>
      <span className="num">{value}</span>
    </span>
  );
}

// ── Indicator math ─────────────────────────────────────────────────
// Simple moving average — sum the last N closes, divide. Computed once
// over the full history when the data is reseeded; incrementally on each
// new sample. We feed the resulting series directly to lightweight-charts
// without a TA library because SMA is a one-liner and bringing in `klinecharts`
// or `technicalindicators` would double the bundle for a single overlay.

const SMA20_PERIOD = 20;
const SMA50_PERIOD = 50;

function smaSeries(
  history: { time: UTCTimestamp; close: number }[],
  period: number,
): LineData[] {
  if (history.length < period) return [];
  const out: LineData[] = [];
  let sum = 0;
  for (let i = 0; i < history.length; i++) {
    sum += history[i].close;
    if (i >= period) sum -= history[i - period].close;
    if (i >= period - 1) {
      out.push({ time: history[i].time, value: sum / period });
    }
  }
  return out;
}

function recomputeIndicators(
  history: { time: UTCTimestamp; close: number }[],
  sma20: ISeriesApi<"Line"> | null,
  sma50: ISeriesApi<"Line"> | null,
) {
  sma20?.setData(smaSeries(history, SMA20_PERIOD));
  sma50?.setData(smaSeries(history, SMA50_PERIOD));
}

function appendIndicatorSample(
  history: { time: UTCTimestamp; close: number }[],
  time: UTCTimestamp, close: number,
  sma20: ISeriesApi<"Line"> | null,
  sma50: ISeriesApi<"Line"> | null,
) {
  history.push({ time, close });
  // Bound the buffer so the page doesn't leak after a long session. 5000
  // samples = ~83 minutes of 1-sec ticks or ~3.5 days of 1-min candles —
  // far more than the chart can render meaningfully.
  if (history.length > 5000) history.shift();
  recomputeLatestSMA(history, sma20, sma50);
}

function recomputeLatestSMA(
  history: { time: UTCTimestamp; close: number }[],
  sma20: ISeriesApi<"Line"> | null,
  sma50: ISeriesApi<"Line"> | null,
) {
  if (history.length >= SMA20_PERIOD && sma20) {
    let s = 0;
    for (let i = history.length - SMA20_PERIOD; i < history.length; i++) s += history[i].close;
    sma20.update({ time: history[history.length - 1].time, value: s / SMA20_PERIOD });
  }
  if (history.length >= SMA50_PERIOD && sma50) {
    let s = 0;
    for (let i = history.length - SMA50_PERIOD; i < history.length; i++) s += history[i].close;
    sma50.update({ time: history[history.length - 1].time, value: s / SMA50_PERIOD });
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function IndicatorChips({
  sma20, onSMA20, sma50, onSMA50,
}: {
  sma20: boolean; onSMA20: (v: boolean) => void;
  sma50: boolean; onSMA50: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-0.5">
      <Chip on={sma20} onClick={() => onSMA20(!sma20)} tone="bull">SMA 20</Chip>
      <Chip on={sma50} onClick={() => onSMA50(!sma50)} tone="bear">SMA 50</Chip>
    </div>
  );
}

function Chip({
  on, onClick, tone, children,
}: {
  on: boolean; onClick: () => void; tone: "bull" | "bear"; children: React.ReactNode;
}) {
  const onCls = tone === "bull" ? "bg-bull-soft text-bull" : "bg-bear-soft text-bear";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 transition ${on ? onCls : "text-text-mute hover:text-text"}`}
    >
      {children}
    </button>
  );
}

function ModeToggle({ value, onChange }: { value: ChartMode; onChange: (m: ChartMode) => void }) {
  const opts: { v: ChartMode; label: string }[] = [
    { v: "line", label: "Line" },
    { v: "candles", label: "Candles" },
  ];
  return (
    <div className="flex gap-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded px-2 py-0.5 transition ${
            value === o.v ? "bg-accent text-white" : "text-text-dim hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact forecast pill rendered as a floating overlay on the chart's
 *  bottom-right corner. Renders nothing if no forecast yet — caller
 *  conditions on `forecast` truthiness. */
function ForecastBadge({ forecast }: { forecast: ForecastPayload }) {
  const dir = forecast.point_direction;
  const glyph = dir === "up" ? "▲" : dir === "down" ? "▼" : "●";
  const dirColor = dir === "up" ? "text-bull" : dir === "down" ? "text-bear" : "text-text-mute";
  return (
    <div className="text-[11px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-warning">{forecast.model} · {forecast.horizon_steps}-step</span>
        <span className="num text-text-mute">{forecast.latency_ms.toFixed(0)}ms</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className={`num text-xs ${dirColor}`}>{glyph} {dir}</span>
        <span className="num text-[10px] text-text-mute">
          conf {(forecast.confidence_score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// Fetches OHLC candles for `symbol` from Deriv's public ticks_history. Uses
// app_id 1089 (the demo id) — no auth, no rate concerns at our volume.
async function fetchDerivCandles(symbol: string, granularity: number, count: number): Promise<CandlestickData<UTCTimestamp>[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Deriv candles fetch timed out"));
    }, 10000);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        end: "latest",
        count,
        style: "candles",
        granularity,
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.error) { clearTimeout(timeout); ws.close(); reject(new Error(msg.error.message)); return; }
        if (msg.msg_type === "candles" && Array.isArray(msg.candles)) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.candles.map((c: { epoch: number; open: number; high: number; low: number; close: number }) => ({
            time: c.epoch as UTCTimestamp,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
          })));
        }
      } catch (e) {
        clearTimeout(timeout);
        ws.close();
        reject(e);
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Deriv WS error"));
    };
  });
}
