"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type LLMModelDef } from "@/lib/api";

type Props = {
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
};

const TIER_LABEL: Record<LLMModelDef["tier"], string> = {
  frontier: "Frontier",
  mid: "Mid",
  fast: "Fast",
  tiny: "Tiny",
};

const TIER_COLOR: Record<LLMModelDef["tier"], string> = {
  frontier: "text-bull",
  mid: "text-info",
  fast: "text-warning",
  tiny: "text-text-mute",
};

export default function ModelPicker({ provider, model, onChange }: Props) {
  const [models, setModels] = useState<LLMModelDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listLLMModels()
      .then((r) => setModels(r.models))
      .catch((e) => setError(e?.message ?? "failed to load models"));
  }, []);

  const current = useMemo(
    () => models?.find((m) => m.provider === provider && m.model === model) ?? null,
    [models, provider, model],
  );

  const grouped = useMemo(() => {
    if (!models) return [];
    // Order: Cloud first, then Self-hosted. Within each, by family.
    const byCat = new Map<LLMModelDef["category"], Map<string, LLMModelDef[]>>();
    for (const m of models) {
      const fam = byCat.get(m.category) ?? new Map();
      const list = fam.get(m.family) ?? [];
      list.push(m);
      fam.set(m.family, list);
      byCat.set(m.category, fam);
    }
    const out: { category: LLMModelDef["category"]; family: string; list: LLMModelDef[] }[] = [];
    for (const cat of ["cloud", "self_hosted"] as const) {
      const fams = byCat.get(cat);
      if (!fams) continue;
      for (const [fam, list] of fams.entries()) {
        out.push({ category: cat, family: fam, list });
      }
    }
    return out;
  }, [models]);

  if (error) return <p className="text-sm text-bear">{error}</p>;
  if (!models) return <p className="text-sm text-text-mute">Loading models…</p>;

  return (
    <div>
      <select
        value={`${provider}::${model}`}
        onChange={(e) => {
          const [p, m] = e.target.value.split("::");
          onChange(p, m);
        }}
        className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
      >
        {grouped.map(({ category, family, list }) => (
          <optgroup
            key={`${category}-${family}`}
            label={`${category === "cloud" ? "☁ Cloud" : "🏠 Self-hosted"} · ${family}`}
          >
            {list.map((m) => (
              <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                {m.label}
                {m.category === "cloud"
                  ? `  —  $${m.input_cost_per_1m_usd}/M in · $${m.output_cost_per_1m_usd}/M out`
                  : "  —  free (compute)"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {current && (
        <div className="mt-2 rounded-md bg-bg-elev-1 p-3 text-xs text-text-dim">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`font-medium ${TIER_COLOR[current.tier]}`}>
              {TIER_LABEL[current.tier]}
            </span>
            <span className="text-text-mute">
              {current.category === "cloud" ? "freelancer" : "in-house"}
            </span>
            <span className="num">
              ctx {current.context_window.toLocaleString()}
            </span>
            {current.supports_tools ? (
              <span>🔧 tools</span>
            ) : (
              <span className="text-text-mute">no tools</span>
            )}
          </div>
          {current.category === "cloud" && (
            <div className="num mt-1">
              ${current.input_cost_per_1m_usd}/M in · ${current.output_cost_per_1m_usd}/M out
            </div>
          )}
        </div>
      )}
    </div>
  );
}
