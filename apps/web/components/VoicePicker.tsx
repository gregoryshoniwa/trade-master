"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type VoiceDef, type VoiceFeel } from "@/lib/api";

type Props = {
  value: string | null;
  onChange: (voice: string) => void;
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
};

const FEEL_LABEL: Record<VoiceFeel, string> = {
  warm: "Warm",
  neutral: "Neutral",
  cool: "Cool",
  energetic: "Energetic",
};

const FEEL_ORDER: VoiceFeel[] = ["warm", "neutral", "cool", "energetic"];

const FEEL_COLOR: Record<VoiceFeel, string> = {
  warm: "text-warning",
  neutral: "text-text-dim",
  cool: "text-info",
  energetic: "text-bull",
};

export default function VoicePicker({ value, onChange, enabled, onEnabledChange }: Props) {
  const [voices, setVoices] = useState<VoiceDef[] | null>(null);
  const [defaultVoice, setDefaultVoice] = useState<string>("Aoede");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listVoices()
      .then((r) => { setVoices(r.voices); setDefaultVoice(r.default); })
      .catch((e) => setError(e?.message ?? "failed to load voices"));
  }, []);

  const grouped = useMemo(() => {
    if (!voices) return [];
    const byFeel = new Map<VoiceFeel, VoiceDef[]>();
    for (const v of voices) {
      const list = byFeel.get(v.feel) ?? [];
      list.push(v);
      byFeel.set(v.feel, list);
    }
    return FEEL_ORDER
      .filter((f) => byFeel.has(f))
      .map((f) => [f, byFeel.get(f) ?? []] as const);
  }, [voices]);

  const current = voices?.find((v) => v.name === (value || defaultVoice)) ?? null;

  if (error) return <p className="text-sm text-bear">{error}</p>;
  if (!voices) return <p className="text-sm text-text-mute">Loading voices…</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span>Voice enabled</span>
        </label>
      </div>

      <select
        value={value ?? defaultVoice}
        onChange={(e) => onChange(e.target.value)}
        disabled={!enabled}
        className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
      >
        {grouped.map(([feel, list]) => (
          <optgroup key={feel} label={FEEL_LABEL[feel]}>
            {list.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label} — {v.description}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {current && (
        <div className="mt-2 rounded-md bg-bg-elev-1 p-3 text-xs text-text-dim">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-medium ${FEEL_COLOR[current.feel]}`}>
              {FEEL_LABEL[current.feel]}
            </span>
            <span className="num">{current.name}</span>
          </div>
          <p className="mt-1">{current.description}</p>
        </div>
      )}
    </div>
  );
}
