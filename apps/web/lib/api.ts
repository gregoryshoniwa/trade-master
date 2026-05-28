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

export type AssetClass = "synthetic" | "forex" | "commodity" | "crypto" | "stock_index";

export type SymbolDef = {
  code: string;
  display: string;
  asset_class: AssetClass;
  tier: number;
  decimals: number;
  description: string;
};

export type HistoryRow = { t: number; value: number };

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
  forecasting_model: string;
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
  allowed_combinations: { strategy?: string; asset?: string; contract?: string }[];
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
  forecasting_model?: string;
  personality?: Personality;
  trade_selection_mode?: Agent["trade_selection_mode"];
  strategies?: string[];
  allowed_assets?: string[];
  allowed_contract_types?: string[];
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

export type AuthResponse = {
  account_id: string;
  email: string;
  full_name: string | null;
  is_new_account: boolean;
  company_id: string | null;
};

export type InvitePeek = {
  email: string;
  company_id: string;
  company_name: string;
  role: string;
  title: string | null;
};

export type CompanyMember = {
  account_id: string;
  email: string;
  full_name: string | null;
  role: "owner" | "admin" | "trader" | "viewer";
  title: string | null;
  joined_at: string;
};

export type InviteCreated = {
  invite_id: string;
  email: string;
  role: string;
  title: string | null;
  expires_at: string;
  accept_url: string;
};

export const api = {
  signup: (body: {
    email: string;
    password: string;
    full_name: string;
    jurisdiction?: string;
    company_name?: string;
  }) =>
    request<AuthResponse>("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  peekInvite: (token: string) =>
    request<InvitePeek>(
      `/api/v1/auth/invite?token=${encodeURIComponent(token)}`,
    ),

  acceptInvite: (body: {
    token: string;
    password?: string;
    full_name?: string;
  }) =>
    request<AuthResponse>("/api/v1/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify(body),
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

  // ─── symbols + history ───
  listSymbols: () =>
    request<{ symbols: SymbolDef[] }>("/api/v1/symbols"),

  symbolHistory: (symbol: string, minutes = 30, bucketSecs = 1) =>
    request<{ symbol: string; bucket_secs: number; rows: HistoryRow[] }>(
      `/api/v1/symbols/${encodeURIComponent(symbol)}/history?minutes=${minutes}&bucket_secs=${bucketSecs}`,
    ),

  // ─── chat ───
  listConversations: (companyId: string, agentId: string) =>
    request<{ conversations: Conversation[] }>(
      `/api/v1/companies/${companyId}/agents/${agentId}/conversations`,
    ),

  getMessages: (companyId: string, agentId: string, conversationId: string) =>
    request<{ messages: ChatMessage[] }>(
      `/api/v1/companies/${companyId}/agents/${agentId}/conversations/${conversationId}/messages`,
    ),

  sendChat: (
    companyId: string,
    agentId: string,
    body: { message: string; conversation_id?: string },
  ) =>
    request<ChatResponse>(
      `/api/v1/companies/${companyId}/agents/${agentId}/chat`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ─── members + invites ───
  listMembers: (companyId: string) =>
    request<{ members: CompanyMember[] }>(
      `/api/v1/companies/${companyId}/members`,
    ),

  createInvite: (
    companyId: string,
    body: { email: string; role: "admin" | "trader" | "viewer"; title?: string },
  ) =>
    request<InviteCreated>(`/api/v1/companies/${companyId}/invites`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateMember: (
    companyId: string,
    accountId: string,
    body: { role: CompanyMember["role"]; title?: string },
  ) =>
    request<CompanyMember>(
      `/api/v1/companies/${companyId}/members/${accountId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  removeMember: (companyId: string, accountId: string) =>
    request<void>(
      `/api/v1/companies/${companyId}/members/${accountId}`,
      { method: "DELETE" },
    ),

  // ─── LLM models + payroll ───
  listLLMModels: () =>
    request<{ models: LLMModelDef[] }>("/api/v1/llm/models"),

  listForecastingModels: () =>
    request<{ models: ForecastModelDef[] }>("/api/v1/forecasting/models"),

  // ─── economic calendar ───
  listEvents: (opts?: { impact?: "all" | "high" | "medium" | "low"; horizonHours?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.impact) q.set("impact", opts.impact);
    if (opts?.horizonHours) q.set("horizon_hours", String(opts.horizonHours));
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return request<{ events: EconomicEvent[] }>(`/api/v1/calendar${qs ? `?${qs}` : ""}`);
  },

  // ─── deriv state ───
  getDerivBalance: () => request<DerivBalance>("/api/v1/deriv/balance"),

  // ─── safety ───
  getSafety: (companyId: string) =>
    request<SafetyState>(`/api/v1/companies/${companyId}/safety`),
  setKillSwitch: (companyId: string, active: boolean, reason?: string) =>
    request<SafetyState>(`/api/v1/companies/${companyId}/kill-switch`, {
      method: "POST",
      body: JSON.stringify({ active, reason }),
    }),
  setLossLimit: (companyId: string, daily_loss_limit_usd: number | null) =>
    request<SafetyState>(`/api/v1/companies/${companyId}/safety/loss-limit`, {
      method: "PUT",
      body: JSON.stringify({ daily_loss_limit_usd }),
    }),

  // ─── attribution ───
  getAttribution: (companyId: string, window: AttributionWindow = "30d") =>
    request<AttributionSummary>(
      `/api/v1/companies/${companyId}/attribution?window=${window}`,
    ),

  payroll: (companyId: string, window: PayrollWindow = "30d") =>
    request<PayrollSummary>(
      `/api/v1/companies/${companyId}/payroll?window=${window}`,
    ),

  // ─── approvals + intents ───
  listPendingApprovals: (companyId: string) =>
    request<{ intents: TradeIntent[] }>(
      `/api/v1/companies/${companyId}/approvals`,
    ),

  listIntents: (
    companyId: string,
    status: TradeIntentStatus | "all" = "all",
    limit = 50,
  ) =>
    request<{ intents: TradeIntent[] }>(
      `/api/v1/companies/${companyId}/intents?status=${status}&limit=${limit}`,
    ),

  approveIntent: (companyId: string, intentId: string, reason?: string) =>
    request<TradeIntent>(
      `/api/v1/companies/${companyId}/approvals/${intentId}/approve`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),

  rejectIntent: (companyId: string, intentId: string, reason?: string) =>
    request<TradeIntent>(
      `/api/v1/companies/${companyId}/approvals/${intentId}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),

  // ─── postmortems ───
  listPostmortems: (companyId: string, opts?: { agentId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.agentId) q.set("agent_id", opts.agentId);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return request<{ postmortems: Postmortem[] }>(
      `/api/v1/companies/${companyId}/postmortems${qs ? `?${qs}` : ""}`,
    );
  },

  getPostmortem: (companyId: string, intentId: string) =>
    request<Postmortem>(
      `/api/v1/companies/${companyId}/intents/${intentId}/postmortem`,
    ),
};

export type TradeIntentStatus =
  | "pending_risk"
  | "rejected_by_risk"
  | "pending_approval"
  | "approved"
  | "auto_approved"
  | "rejected_by_user"
  | "expired"
  | "executed"
  | "failed_execution";

export type RiskCheck = {
  name: string;
  passed: boolean;
  detail?: string | null;
};

export type RiskVerdict = {
  ok: boolean;
  reason: string | null;
  checks: RiskCheck[];
  applied_stake_usd: number | null;
};

export type TradeIntent = {
  id: string;
  client_uuid: string;
  company_id: string;
  agent_id: string;
  agent_name: string;
  asset: string;
  contract_type: string;
  direction: "up" | "down" | "flat";
  stake_usd: number;
  multiplier: number | null;
  duration_secs: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  source_model: string;
  source_asof_ts: string;
  confidence: number;
  expected_payoff_ratio: number | null;
  expected_value_usd: number | null;
  rationale: string;
  status: TradeIntentStatus;
  risk_verdict: RiskVerdict | null;
  user_decision_by: string | null;
  user_decision_at: string | null;
  user_decision_reason: string | null;
  expires_at: string | null;
  executed_at: string | null;
  broker_contract_id: string | null;
  buy_price_usd: number | null;
  longcode: string | null;
  realized_pnl_usd: number | null;
  exit_reason: string | null;
  closed_at: string | null;
  execution_error: string | null;
  created_at: string;
  updated_at: string;
};

// ─── postmortem types ───

export type EmployeeRating = {
  direction_score: number;
  calibration_score: number;
  information_value_score: number | null;
  composite_rating: number;
};

export type Postmortem = {
  id: string;
  intent_id: string;
  company_id: string;
  agent_id: string | null;
  agent_name: string | null;
  asset: string | null;
  contract_type: string | null;
  direction: string | null;
  outcome: "win" | "loss" | "break_even";
  pnl_usd: number;
  entry_trace: Record<string, unknown>;
  exit_trace: Record<string, unknown>;
  employee_rating: EmployeeRating;
  narrative: string;
  generated_at: string;
};

// ─── LLM model + payroll types ───

export type LLMTier = "frontier" | "mid" | "fast" | "tiny";
export type LLMCategory = "cloud" | "self_hosted";

export type LLMModelDef = {
  provider: string;
  model: string;
  label: string;
  family: string;
  category: LLMCategory;
  context_window: number;
  input_cost_per_1m_usd: number;
  output_cost_per_1m_usd: number;
  supports_tools: boolean;
  tier: LLMTier;
};

// ─── economic calendar ───

export type EconomicEvent = {
  event_id: string;
  ts: string;
  country: string;
  name: string;
  impact: "high" | "medium" | "low";
  category: string | null;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
  affected_currencies: string[];
  affected_assets: string[];
  source: string;
};

// ─── deriv account state ───

export type DerivBalance = {
  loginid: string | null;
  currency: string;
  balance: number;
  is_virtual: boolean;
  available: boolean;
};

// ─── safety types ───

export type SafetyState = {
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  kill_switch_at: string | null;
  daily_loss_limit_usd: number | null;
  today_realized_pnl_usd: number;
};

// ─── attribution types ───

export type AttributionWindow = "today" | "7d" | "30d" | "all";

export type AgentAttribution = {
  agent_id: string | null;
  agent_name: string | null;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_usd: number;
  best_usd: number;
  worst_usd: number;
  avg_pnl_usd: number;
  avg_calibration: number | null;
  allocated_balance_usd: number | null;
};

export type ModelAttribution = {
  source_model: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_usd: number;
  avg_pnl_usd: number;
};

export type AssetAttribution = {
  asset: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_usd: number;
  avg_pnl_usd: number;
};

export type AttributionSummary = {
  window: AttributionWindow;
  trades: number;
  pnl_usd: number;
  win_rate: number;
  by_agent: AgentAttribution[];
  by_model: ModelAttribution[];
  by_asset: AssetAttribution[];
};

// ─── forecasting (TSFM) model types ───

export type ForecastModelDef = {
  key: string;
  label: string;
  family: string;
  params: string;
  license: string;
  inputs: string;
  granularity: string;
  context_length: number;
  prediction_length: number;
  description: string;
  tier: "fast" | "mid" | "heavy";
};

export type PayrollWindow = "today" | "7d" | "30d" | "mtd" | "all";

export type PayrollRow = {
  agent_id: string | null;
  name: string;
  role: string | null;
  personality: string | null;
  provider: string;
  model: string;
  model_label: string | null;
  category: LLMCategory | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  projected_monthly_usd: number;
};

export type PayrollSummary = {
  window: PayrollWindow;
  days_in_window: number;
  total_cost_usd: number;
  projected_monthly_usd: number;
  rows: PayrollRow[];
};

// ─── chat types ───

export type Conversation = {
  id: string;
  agent_id: string;
  title: string | null;
  last_message_at: string | null;
  created_at: string;
};

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls: ChatToolCall[] | null;
  created_at: string;
};

export type ChatResponse = {
  conversation_id: string;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  tool_calls: ChatToolCall[];
  input_tokens: number;
  output_tokens: number;
  model: string;
};
