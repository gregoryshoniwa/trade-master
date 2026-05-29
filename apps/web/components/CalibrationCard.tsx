"use client";

import { useEffect, useState } from "react";

import { api, ApiError, type CalibratorStatus } from "@/lib/api";

const FMT_DT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

const FMT_PCT = (v: number) => `${(v * 100).toFixed(1)}%`;
const FMT_NUM = (v: number) => v.toFixed(4);

function Delta({ before, after, lowerIsBetter = true }: {
  before: number; after: number; lowerIsBetter?: boolean;
}) {
  const delta = after - before;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const cls = Math.abs(delta) < 1e-4
    ? "text-text-mute"
    : improved ? "text-bull" : "text-bear";
  const sign = delta > 0 ? "+" : "";
  return <span className={`num ${cls}`}>{sign}{delta.toFixed(4)}</span>;
}

/** Tiny inline plot: dashed diagonal = identity, solid line = the
 * isotonic step function. No external chart lib — SVG is fine for
 * a calibration curve with ≤ a few hundred breakpoints. */
function ReliabilitySVG({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 2) {
    return null;
  }
  const W = 280;
  const H = 140;
  const PAD = 12;
  const px = (x: number) => PAD + x * (W - 2 * PAD);
  const py = (y: number) => H - PAD - y * (H - 2 * PAD);

  // Build the staircase path. At each breakpoint k>0, draw a flat
  // segment from x_{k-1} → x_k at height y_k.
  let d = `M ${px(0)} ${py(points[0].y)}`;
  for (const p of points) {
    d += ` L ${px(p.x)} ${py(p.y)}`;
  }
  // Tail: extend last y to x=1 so the curve touches the right edge.
  d += ` L ${px(1)} ${py(points[points.length - 1].y)}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-text-mute">
      <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD}
        fill="none" stroke="currentColor" strokeOpacity="0.2" />
      {/* identity line */}
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)}
        stroke="currentColor" strokeDasharray="4 4" strokeOpacity="0.4" />
      {/* calibration curve */}
      <path d={d} stroke="var(--color-accent, #6aa9ff)" strokeWidth="1.75" fill="none" />
      {/* axes labels */}
      <text x={PAD} y={H - 1} fontSize="9" fill="currentColor">raw 0</text>
      <text x={W - 30} y={H - 1} fontSize="9" fill="currentColor">raw 1</text>
      <text x={2} y={PAD + 4} fontSize="9" fill="currentColor">cal 1</text>
      <text x={2} y={H - PAD} fontSize="9" fill="currentColor">cal 0</text>
    </svg>
  );
}

export default function CalibrationCard({
  companyId,
  model,
}: {
  companyId: string;
  model: string;
}) {
  const [status, setStatus] = useState<CalibratorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCalibrator(companyId, model)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "load failed");
      });
    return () => { cancelled = true; };
  }, [companyId, model]);

  if (error) {
    return <div className="text-sm text-text-mute">Couldn't load calibrator: {error}</div>;
  }
  if (!status) {
    return <div className="text-sm text-text-mute">Loading…</div>;
  }

  if (status.state !== "calibrated") {
    const pct = Math.min(100, Math.round((status.n_samples / status.min_samples_required) * 100));
    return (
      <div className="space-y-2 text-sm">
        <p className="text-text-mute">
          Not yet calibrated. Calibration fits once <span className="num">{model}</span> has
          at least <span className="num">{status.min_samples_required}</span> settled trades
          in the last 30 days.
        </p>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-mute">
            <span>Progress</span>
            <span className="num">{status.n_samples} / {status.min_samples_required}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-elev-2">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  const methodLabel = status.method === "platt"
    ? "Platt scaling (logistic, 2 params)"
    : "Isotonic (PAV step-function)";
  const methodHint = status.method === "platt"
    ? "Small-sample fitter — robust below 80 settled trades."
    : "Full step-function — best when the model has 80+ settled trades.";

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-text-mute">Fit on </span>
          <span className="num">{status.n_samples}</span>
          <span className="text-text-mute"> settled trades over </span>
          <span className="num">{status.window_days}d</span>
        </div>
        {status.fitted_at && (
          <span className="text-xs text-text-mute">
            updated {FMT_DT.format(new Date(status.fitted_at))}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className="rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-mute"
          title={methodHint}
        >
          {methodLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Brier (lower better)"
          raw={status.raw_brier!} cal={status.calibrated_brier!}
          lowerIsBetter
        />
        <Metric
          label="ECE (lower better)"
          raw={status.raw_ece!} cal={status.calibrated_ece!}
          lowerIsBetter
        />
      </div>

      <div className="rounded-lg bg-bg-elev-1 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-text-mute">
            Reliability curve
          </span>
          <span className="text-[10px] text-text-mute">
            dashed = perfectly calibrated
          </span>
        </div>
        <ReliabilitySVG points={status.artifact} />
      </div>
    </div>
  );
}

function Metric({
  label, raw, cal, lowerIsBetter,
}: {
  label: string; raw: number; cal: number; lowerIsBetter: boolean;
}) {
  return (
    <div className="rounded-lg bg-bg-elev-1 p-3">
      <div className="text-xs text-text-mute">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="num text-text-mute line-through">{FMT_NUM(raw)}</span>
        <span className="num">{FMT_NUM(cal)}</span>
      </div>
      <div className="text-xs">
        Δ <Delta before={raw} after={cal} lowerIsBetter={lowerIsBetter} />
      </div>
    </div>
  );
}

// Avoid the unused-import lint hit if FMT_PCT isn't used yet.
void FMT_PCT;
