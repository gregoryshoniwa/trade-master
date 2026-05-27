"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type ForecastModelDef } from "@/lib/api";

type Props = {
  value: string; // forecasting_model key
  onChange: (key: string) => void;
};

const TIER_LABEL: Record<ForecastModelDef["tier"], string> = {
  fast: "Fast",
  mid: "Mid",
  heavy: "Heavy",
};

const TIER_COLOR: Record<ForecastModelDef["tier"], string> = {
  fast: "text-bull",
  mid: "text-info",
  heavy: "text-warning",
};

export default function ForecastingModelPicker({ value, onChange }: Props) {
  const [models, setModels] = useState<ForecastModelDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listForecastingModels()
      .then((r) => setModels(r.models))
      .catch((e) => setError(e?.message ?? "failed to load forecasting models"));
  }, []);

  const current = useMemo(
    () => models?.find((m) => m.key === value) ?? null,
    [models, value],
  );

  const grouped = useMemo(() => {
    if (!models) return [];
    const byFam = new Map<string, ForecastModelDef[]>();
    for (const m of models) {
      const list = byFam.get(m.family) ?? [];
      list.push(m);
      byFam.set(m.family, list);
    }
    return [...byFam.entries()].map(([family, list]) => ({ family, list }));
  }, [models]);

  if (error) return <p className="text-sm text-bear">{error}</p>;
  if (!models) return <p className="text-sm text-text-mute">Loading models…</p>;

  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
      >
        {grouped.map(({ family, list }) => (
          <optgroup key={family} label={family}>
            {list.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}  —  {m.params} · {m.inputs}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {current && (
        <div className="mt-2 rounded-md bg-bg-elev-1 p-3 text-xs text-text-dim">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-medium ${TIER_COLOR[current.tier]}`}>
              {TIER_LABEL[current.tier]}
            </span>
            <span className="num">{current.params}</span>
            <span className="text-text-mute">{current.license}</span>
            <span className="num">{current.granularity}</span>
            <span className="num">
              ctx {current.context_length} → {current.prediction_length}
            </span>
          </div>
          <p>{current.description}</p>
        </div>
      )}
    </div>
  );
}
