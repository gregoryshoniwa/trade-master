"use client";

import { useEffect, useState } from "react";

import { api, type Personality, type PersonalityDef } from "@/lib/api";

type Props = {
  value: Personality;
  onChange: (key: Personality) => void;
};

export default function PersonalityPicker({ value, onChange }: Props) {
  const [presets, setPresets] = useState<PersonalityDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPersonalities()
      .then(setPresets)
      .catch((e) => setError(e?.message ?? "failed to load presets"));
  }, []);

  if (error) {
    return <p className="text-sm text-bear">{error}</p>;
  }
  if (!presets) {
    return <p className="text-sm text-text-mute">Loading personalities…</p>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {presets.map((p) => {
        const selected = value === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
              selected
                ? "border-bull bg-bull-soft"
                : "border-border bg-bg-elev-1 hover:border-bull/40"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-base">
                {p.icon} <span className="font-medium">{p.label}</span>
              </span>
              {selected && <span className="text-xs text-bull">selected</span>}
            </div>
            <p className="text-xs text-text-dim">{p.description}</p>
            <div className="num mt-1 grid w-full grid-cols-3 gap-2 text-[10px] text-text-mute">
              <span>Kelly {p.kelly_fraction.toFixed(2)}</span>
              <span>Conf ≥ {p.min_confidence_threshold.toFixed(2)}</span>
              <span>{p.max_trades_per_day}/day</span>
            </div>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange("custom")}
        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
          value === "custom"
            ? "border-bull bg-bull-soft"
            : "border-border bg-bg-elev-1 hover:border-bull/40"
        }`}
      >
        <span className="text-base">
          ✦ <span className="font-medium">Custom</span>
        </span>
        <p className="text-xs text-text-dim">Tune every parameter yourself.</p>
      </button>
    </div>
  );
}
