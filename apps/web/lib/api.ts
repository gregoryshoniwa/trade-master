// Thin REST client for the FastAPI backend. Cookies (tm_session) carry auth.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Me = {
  account_id: string;
  email: string;
  full_name: string | null;
  jurisdiction: string;
  created_at: string;
  active_company_id: string | null;
};

export type Company = {
  id: string;
  name: string;
  slug: string;
  brand_color: string | null;
  base_currency: string;
  paper_mode: boolean;
  current_asset_tier: number;
  unlocked_contract_types: string[];
  role: "owner" | "admin" | "trader" | "viewer";
  created_at: string;
};

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, msg: string) {
    super(msg);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : res.statusText) || `HTTP ${res.status}`;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}

export type AgentRole = "manager" | "employee" | "research";
export type Personality = "sniper" | "scalper" | "hunter" | "guardian" | "balanced" | "custom";
export type TradeMode = "autonomous" | "approve_each" | "approve_above_threshold";

export type PersonalityDef = {
  key: Personality;
  label: string;
  icon: string;
  description: string;
  kelly_fraction: number;
  min_confidence_threshold: number;
  min_payoff_ratio: number;
  max_trades_per_day: number;
  target_holding_secs: number | null;
};

export type Agent = {
  id: string;
  company_id: string;
  name: string;
  avatar_url: string | null;
  role: AgentRole;
  reports_to_agent_id: string | null;
  llm_provider: string;
  llm_model: string;
  voice_id: string | null;
  voice_enabled: boolean;
  strategies: string[];
  allowed_assets: string[];
  allowed_contract_types: string[];
  allocated_balance_usd: number;
  max_position_size_usd: number;
  max_daily_drawdown_pct: number;
  personality: Personality;
  trade_selection_mode: "specific" | "most_profitable" | "safest" | "balanced";
  kelly_fraction: number;
  min_confidence_threshold: number;
  min_payoff_ratio: number;
  max_trades_per_day: number;
  target_holding_secs: number | null;
  event_aware: boolean;
  aggression_index: number;
  detected_personality: string | null;
  trade_mode: TradeMode;
  is_active: boolean;
  is_paused: boolean;
  pause_reason: string | null;
  system_prompt_addendum: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentCreate = {
  name: string;
  role: AgentRole;
  llm_provider: string;
  llm_model: string;
  personality?: Personality;
  trade_selection_mode?: Agent["trade_selection_mode"];
  strategies?: string[];
  reports_to_agent_id?: string | null;
  voice_id?: string | null;
  allocated_balance_usd?: number;
  max_position_size_usd?: number;
  max_daily_drawdown_pct?: number;
  trade_mode?: TradeMode;
  system_prompt_addendum?: string | null;
};

export type AgentUpdate = Partial<AgentCreate> & {
  kelly_fraction?: number;
  min_confidence_threshold?: number;
  min_payoff_ratio?: number;
  max_trades_per_day?: number;
  target_holding_secs?: number | null;
  event_aware?: boolean;
};

export const api = {
  requestMagicLink: (email: string, full_name?: string) =>
    request<{ sent: boolean; dev_link: string | null }>(
      "/api/v1/auth/magic-link",
      { method: "POST", body: JSON.stringify({ email, full_name }) },
    ),

  verifyMagicLink: (token: string) =>
    request<{
      account_id: string;
      email: string;
      full_name: string | null;
      is_new: boolean;
    }>("/api/v1/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),

  me: () => request<Me>("/api/v1/me"),

  listCompanies: () =>
    request<{ companies: Company[] }>("/api/v1/companies"),

  createCompany: (name: string, brand_color?: string) =>
    request<Company>("/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name, brand_color }),
    }),

  // ─── personalities ───
  listPersonalities: () =>
    request<PersonalityDef[]>("/api/v1/personalities"),

  // ─── agents ───
  listAgents: (companyId: string) =>
    request<{ agents: Agent[] }>(`/api/v1/companies/${companyId}/agents`),

  getAgent: (companyId: string, agentId: string) =>
    request<Agent>(`/api/v1/companies/${companyId}/agents/${agentId}`),

  createAgent: (companyId: string, body: AgentCreate) =>
    request<Agent>(`/api/v1/companies/${companyId}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateAgent: (companyId: string, agentId: string, body: AgentUpdate) =>
    request<Agent>(`/api/v1/companies/${companyId}/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteAgent: (companyId: string, agentId: string) =>
    request<void>(`/api/v1/companies/${companyId}/agents/${agentId}`, {
      method: "DELETE",
    }),

  activateAgent: (companyId: string, agentId: string) =>
    request<Agent>(`/api/v1/companies/${companyId}/agents/${agentId}/activate`, {
      method: "POST",
    }),

  pauseAgent: (companyId: string, agentId: string, reason?: string) =>
    request<Agent>(`/api/v1/companies/${companyId}/agents/${agentId}/pause`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};
