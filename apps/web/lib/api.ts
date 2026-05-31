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
  tier_name: "free" | "starter" | "pro" | "enterprise";
  role: "owner" | "admin" | "trader" | "viewer";
  created_at: string;
};

export type BillingStatus = {
  enabled: boolean;             // billing configured on this api instance
  has_customer: boolean;        // company has a Stripe customer id
  subscription_status: string | null;
  current_period_end: string | null;
  portal_available: boolean;
};

export type TierStatus = {
  tier_name: "free" | "starter" | "pro" | "enterprise";
  label: string;
  label_color: string;
  limits: {
    max_users: number | null;
    max_employees: number | null;
    allowed_forecasters: string[];
    paper_only: boolean;
    voice_minutes_per_month: number | null;
    web_search_daily_quota: number | null;
    manager_loop: boolean;
  };
  usage: {
    users: number;
    employee_agents: number;
    web_search_today: number;
  };
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
  daily_profit_target_usd: number | null;
  forecast_min_interval_secs: number;
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
  voice_enabled?: boolean;
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
  daily_profit_target_usd?: number | null;
  forecast_min_interval_secs?: number;
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

  createMember: (
    companyId: string,
    body: {
      email: string; full_name: string; password: string;
      role: "admin" | "trader" | "viewer"; title?: string;
    },
  ) =>
    request<CompanyMember>(`/api/v1/companies/${companyId}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resetMemberPassword: (companyId: string, accountId: string) =>
    request<{ account_id: string; email: string; temp_password: string }>(
      `/api/v1/companies/${companyId}/members/${accountId}/reset-password`,
      { method: "POST" },
    ),

  updateMember: (
    companyId: string,
    accountId: string,
    body: { role?: CompanyMember["role"]; title?: string; full_name?: string },
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

  // ─── voice ───
  listVoices: () =>
    request<{ voices: VoiceDef[]; default: string }>("/api/v1/llm/voices"),
  mintVoiceSession: (companyId: string, agentId: string) =>
    request<VoiceSession>(
      `/api/v1/companies/${companyId}/agents/${agentId}/voice/session`,
      { method: "POST" },
    ),
  runVoiceTool: (
    companyId: string, agentId: string,
    body: { session_id: string; call_id?: string; name: string; arguments: Record<string, unknown> },
  ) =>
    request<{ call_id: string | null; name: string; response: unknown }>(
      `/api/v1/companies/${companyId}/agents/${agentId}/voice/tool`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  submitVoiceTranscript: (
    companyId: string, agentId: string,
    body: { session_id: string; duration_ms: number; model: string; turns: { role: "user" | "assistant"; text: string }[] },
  ) =>
    request<{ persisted: boolean; user_chars: number; assistant_chars: number }>(
      `/api/v1/companies/${companyId}/agents/${agentId}/voice/transcript`,
      { method: "POST", body: JSON.stringify(body) },
    ),

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
  getDerivStatement: (opts?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.offset) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return request<DerivStatement>(`/api/v1/deriv/statement${qs ? `?${qs}` : ""}`);
  },

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

  // ─── backtests ───
  createBacktest: (companyId: string, body: BacktestCreate) =>
    request<BacktestRun>(
      `/api/v1/companies/${companyId}/backtests`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  listBacktests: (companyId: string, limit = 50) =>
    request<{ runs: BacktestRun[] }>(
      `/api/v1/companies/${companyId}/backtests?limit=${limit}`,
    ),

  getBacktest: (companyId: string, runId: string) =>
    request<BacktestRun>(
      `/api/v1/companies/${companyId}/backtests/${runId}`,
    ),

  applyBacktest: (
    companyId: string, runId: string,
    body: { agent_id: string; set_min_confidence?: boolean; prune_weak_symbols?: boolean },
  ) =>
    request<BacktestApplyResult>(
      `/api/v1/companies/${companyId}/backtests/${runId}/apply`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ─── attribution ───
  getAttribution: (companyId: string, window: AttributionWindow = "30d") =>
    request<AttributionSummary>(
      `/api/v1/companies/${companyId}/attribution?window=${window}`,
    ),

  // ─── edge report ───
  getEdgeReport: (companyId: string, window: EdgeWindow = "30d") =>
    request<EdgeReport>(
      `/api/v1/companies/${companyId}/edge?window=${window}`,
    ),

  // ─── company paper-mode flip ───
  setCompanyPaperMode: (companyId: string, paperMode: boolean) =>
    request<Company>(`/api/v1/companies/${companyId}/paper-mode`, {
      method: "PATCH",
      body: JSON.stringify({ paper_mode: paperMode }),
    }),

  // ─── passkey ───
  passkeyStatus: () =>
    request<{ has_passkey: boolean; count: number }>(
      "/api/v1/auth/passkey/status",
    ),
  passkeyRegisterOptions: () =>
    request<{ options_json: string }>(
      "/api/v1/auth/passkey/register/options",
      { method: "POST" },
    ),
  passkeyRegisterVerify: (credentialJson: string, name?: string) =>
    request<{ ok: true }>("/api/v1/auth/passkey/register/verify", {
      method: "POST",
      body: JSON.stringify({ credential_json: credentialJson, name }),
    }),
  passkeyAssertOptions: () =>
    request<{ options_json: string }>(
      "/api/v1/auth/passkey/assert/options",
      { method: "POST" },
    ),
  passkeyAssertVerify: (credentialJson: string) =>
    request<{ ok: true; expires_in: number }>(
      "/api/v1/auth/passkey/assert/verify",
      { method: "POST", body: JSON.stringify({ credential_json: credentialJson }) },
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
    status: TradeIntentStatus | "all" | "open" = "all",
    limit = 50,
  ) =>
    request<{ intents: TradeIntent[] }>(
      `/api/v1/companies/${companyId}/intents?status=${status}&limit=${limit}`,
    ),

  /** One-shot CEO trade: create + auto-approve + publish to gateway.
   *  Manager agent is auto-selected as the on-paper attribution; the
   *  entry_context marks `sizing.method = "ceo_manual"`. */
  placeQuickTrade: (
    companyId: string,
    body: {
      asset: string;
      direction: "up" | "down";
      stake_usd: number;
      duration_secs?: number;
      reason?: string;
    },
  ) =>
    request<QuickTradeResult>(
      `/api/v1/companies/${companyId}/trades/quick`,
      { method: "POST", body: JSON.stringify(body) },
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

  proposeTrade: (
    companyId: string,
    body: {
      agent_id: string; asset: string;
      direction: "up" | "down"; stake_usd: number; reason: string;
    },
  ) =>
    request<TradeIntent>(
      `/api/v1/companies/${companyId}/approvals`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  closeIntent: (companyId: string, intentId: string) =>
    request<CloseResult>(
      `/api/v1/companies/${companyId}/intents/${intentId}/close`,
      { method: "POST" },
    ),

  // ─── postmortems ───
  listPostmortems: (
    companyId: string,
    opts?: {
      agentId?: string;
      asset?: string;
      outcome?: "win" | "loss" | "neutral";
      q?: string;
      limit?: number;
      offset?: number;
    },
  ) => {
    const p = new URLSearchParams();
    if (opts?.agentId) p.set("agent_id", opts.agentId);
    if (opts?.asset) p.set("asset", opts.asset);
    if (opts?.outcome) p.set("outcome", opts.outcome);
    if (opts?.q) p.set("q", opts.q);
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    if (opts?.offset != null) p.set("offset", String(opts.offset));
    const qs = p.toString();
    return request<PostmortemPage>(
      `/api/v1/companies/${companyId}/postmortems${qs ? `?${qs}` : ""}`,
    );
  },

  listPostmortemFacets: (companyId: string) =>
    request<PostmortemFacets>(
      `/api/v1/companies/${companyId}/postmortems/facets`,
    ),

  getPostmortem: (companyId: string, intentId: string) =>
    request<Postmortem>(
      `/api/v1/companies/${companyId}/intents/${intentId}/postmortem`,
    ),

  // ─── forecast calibration ───
  getCalibrator: (companyId: string, model: string) =>
    request<CalibratorStatus>(
      `/api/v1/companies/${companyId}/calibrators/${encodeURIComponent(model)}`,
    ),

  // ─── per-agent activity feed ───
  getAgentActivity: (companyId: string, agentId: string, limit = 50) =>
    request<AgentActivityFeed>(
      `/api/v1/companies/${companyId}/agents/${agentId}/activity?limit=${limit}`,
    ),

  // ─── per-company credentials (Deriv + LLM provider keys) ───
  getCredentials: (companyId: string) =>
    request<CredentialsStatus>(`/api/v1/companies/${companyId}/credentials`),

  updateCredentials: (companyId: string, body: CredentialsUpdate) =>
    request<CredentialsStatus>(
      `/api/v1/companies/${companyId}/credentials`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  // ─── manager meetings ───
  triggerManagerReview: (companyId: string) =>
    request<{ accepted: boolean; note: string | null }>(
      `/api/v1/companies/${companyId}/manager/run-review`,
      { method: "POST" },
    ),

  scheduleManagerMeeting: (
    companyId: string,
    body: { employee_agent_id: string; agenda?: string | null },
  ) =>
    request<{ accepted: boolean; note: string | null }>(
      `/api/v1/companies/${companyId}/manager/meetings`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  listMeetings: (
    companyId: string,
    opts?: {
      kind?: "review" | "meeting";
      employee_id?: string;
      limit?: number;
      offset?: number;
    },
  ) => {
    const p = new URLSearchParams();
    if (opts?.kind) p.set("kind", opts.kind);
    if (opts?.employee_id) p.set("employee_id", opts.employee_id);
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    if (opts?.offset != null) p.set("offset", String(opts.offset));
    const qs = p.toString();
    return request<MeetingsPage>(
      `/api/v1/companies/${companyId}/meetings${qs ? `?${qs}` : ""}`,
    );
  },

  getMeeting: (companyId: string, meetingId: string) =>
    request<MeetingDetail>(
      `/api/v1/companies/${companyId}/meetings/${meetingId}`,
    ),

  followUpOnMeeting: (companyId: string, meetingId: string, message: string) =>
    request<{ accepted: boolean; note: string | null }>(
      `/api/v1/companies/${companyId}/manager/meetings/${meetingId}/follow-up`,
      { method: "POST", body: JSON.stringify({ message }) },
    ),

  listEmployeeRequests: (companyId: string) =>
    request<EmployeeMeetingRequest[]>(
      `/api/v1/companies/${companyId}/meeting-requests`,
    ),

  // ─── company goals ───
  getTierStatus: (companyId: string) =>
    request<TierStatus>(`/api/v1/companies/${companyId}/tier`),

  // ─── billing ───
  getBillingStatus: (companyId: string) =>
    request<BillingStatus>(`/api/v1/companies/${companyId}/billing`),

  startCheckout: (companyId: string, tier: "starter" | "pro") =>
    request<{ url: string }>(
      `/api/v1/companies/${companyId}/billing/checkout`,
      { method: "POST", body: JSON.stringify({ tier }) },
    ),

  openBillingPortal: (companyId: string) =>
    request<{ url: string }>(
      `/api/v1/companies/${companyId}/billing/portal`,
      { method: "POST" },
    ),

  getCompanyGoals: (companyId: string) =>
    request<CompanyGoals>(`/api/v1/companies/${companyId}/goals`),

  updateCompanyGoals: (companyId: string, body: CompanyGoals) =>
    request<CompanyGoals>(
      `/api/v1/companies/${companyId}/goals`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  // ─── notifications ───
  listNotifications: (limit = 30) =>
    request<NotificationList>(`/api/v1/notifications?limit=${limit}`),

  markNotificationRead: (notificationId: string) =>
    request<{ ok: boolean }>(
      `/api/v1/notifications/${notificationId}/read`,
      { method: "POST" },
    ),

  markAllNotificationsRead: () =>
    request<{ ok: boolean; marked: number }>(
      `/api/v1/notifications/read-all`,
      { method: "POST" },
    ),

  // ─── web search config ───
  getWebSearchConfig: (companyId: string) =>
    request<WebSearchConfig>(`/api/v1/companies/${companyId}/web-search-config`),

  updateWebSearchConfig: (companyId: string, body: WebSearchConfigUpdate) =>
    request<WebSearchConfig>(
      `/api/v1/companies/${companyId}/web-search-config`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  // ─── manager actions (audit) ───
  listManagerActions: (
    companyId: string,
    opts?: {
      employeeId?: string;
      actionKind?: "review" | "adjust" | "pause" | "resume" | "meeting";
      limit?: number;
      offset?: number;
    },
  ) => {
    const p = new URLSearchParams();
    if (opts?.employeeId) p.set("employee_id", opts.employeeId);
    if (opts?.actionKind) p.set("action_kind", opts.actionKind);
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    if (opts?.offset != null) p.set("offset", String(opts.offset));
    const qs = p.toString();
    return request<ManagerActionPage>(
      `/api/v1/companies/${companyId}/manager-actions${qs ? `?${qs}` : ""}`,
    );
  },
};

export type ManagerAction = {
  id: string;
  company_id: string;
  manager_agent_id: string;
  manager_name: string | null;
  employee_agent_id: string | null;
  employee_name: string | null;
  action_kind: "review" | "adjust" | "pause" | "resume" | "meeting";
  field_name: string | null;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  llm_narrative: string | null;
  created_at: string;
};

export type ManagerActionPage = {
  actions: ManagerAction[];
  total: number;
  limit: number;
  offset: number;
};

export type CalibratorPoint = { x: number; y: number };

export type WebSearchConfig = {
  enabled: boolean;
  allowed_domains: string[];
  blocked_domains: string[];
  daily_quota: number;
  used_today: number;
  backend: "auto" | "tavily" | "duckduckgo";
  tavily_available: boolean;
};

export type WebSearchConfigUpdate = {
  enabled?: boolean;
  allowed_domains?: string[];
  blocked_domains?: string[];
  daily_quota?: number;
  backend?: "auto" | "tavily" | "duckduckgo";
};

export type MeetingKind = "review" | "meeting";

export type MeetingSummary = {
  id: string;
  kind: MeetingKind;
  manager_agent_id: string | null;
  manager_name: string | null;
  employee_name: string | null;
  employee_agent_id: string | null;
  agenda: string | null;
  narrative_preview: string | null;
  has_transcript: boolean;
  created_at: string;
};

export type MeetingsPage = {
  items: MeetingSummary[];
  total: number;
};

export type MeetingTurn = {
  role: string;
  content: string;
  tool_calls: unknown;
  created_at: string;
};

export type MeetingDetail = MeetingSummary & {
  narrative: string | null;
  transcript: MeetingTurn[];
};

export type CredentialsStatus = {
  deriv_demo_configured: boolean;
  deriv_real_configured: boolean;
  deriv_environment: "demo" | "real";
  /** True when active env has no per-company token AND the system has a
   *  fallback (DERIV_API_TOKEN env). The runtime is using the fallback. */
  deriv_env_fallback?: boolean;
  anthropic_configured: boolean;
  openai_configured: boolean;
  gemini_configured: boolean;
  openrouter_configured: boolean;
  groq_configured: boolean;
  updated_at: string | null;
};

export type CredentialsUpdate = {
  // Empty string clears a configured key; omit to leave untouched.
  deriv_token_demo?: string;
  deriv_token_real?: string;
  deriv_environment?: "demo" | "real";
  anthropic_api_key?: string;
  openai_api_key?: string;
  gemini_api_key?: string;
  openrouter_api_key?: string;
  groq_api_key?: string;
};

export type EmployeeMeetingRequest = {
  id: string;
  employee_agent_id: string;
  employee_name: string | null;
  reason: string;
  status: "pending" | "addressed" | "declined";
  created_at: string;
  addressed_at: string | null;
  addressed_action_id: string | null;
};

export type CompanyGoals = {
  daily_profit_target_usd: number | null;
};

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationList = {
  items: Notification[];
  unread: number;
};

export type AgentActivityEvent = {
  ts: string;
  kind:
    | "intent_opened"
    | "intent_executed"
    | "intent_closed"
    | "intent_rejected"
    | "manager_action"
    | "chat_message";
  title: string;
  detail: string | null;
  tone: "bull" | "bear" | "accent" | "muted";
  refs: Record<string, string>;
};

export type AgentActivityFeed = {
  events: AgentActivityEvent[];
  fetched_at: string;
};

export type CalibratorStatus = {
  forecasting_model: string;
  fitted_at: string | null;
  window_days: number | null;
  n_samples: number;
  method: "isotonic" | "platt" | null;
  raw_brier: number | null;
  calibrated_brier: number | null;
  raw_ece: number | null;
  calibrated_ece: number | null;
  artifact: CalibratorPoint[];
  state: "calibrated" | "insufficient_data" | "never_fit";
  min_samples_required: number;
};

export type CloseResult = {
  intent_id: string;
  contract_id: number;
  sold_for_usd: number;
  realized_pnl_usd: number;
  balance_after_usd: number;
};

export type BacktestStatus = "pending" | "running" | "done" | "failed";

export type BacktestCreate = {
  model_key: string;
  symbols: string[];
  granularity_secs?: number;
  bar_count?: number;
  horizon?: number;
  stride?: number;
  stop_pct?: number;
  payoff_ratio?: number;
};

export type BacktestFloorBucket = {
  floor: number;
  n: number;
  hit: number;
  pnl: number;
};

export type BacktestPerSymbol = {
  symbol: string;
  // Populated when the symbol ran successfully:
  n?: number;
  flat?: number;
  hit?: number;
  brier?: number;
  total_pnl_pct?: number;
  avg_pnl_bps?: number;
  win_rate?: number;
  profit_factor?: number;
  by_floor?: BacktestFloorBucket[];
  // Populated when the symbol failed (couldn't fetch data, too few candles, etc.):
  error?: string;
};

export type BacktestSummary = {
  n_forecasts: number;
  overall_hit_rate: number | null;
  overall_brier: number | null;
  overall_pnl_pct: number | null;
  by_floor?: BacktestFloorBucket[];
  best_floor: BacktestFloorBucket | null;
  weak_symbols: string[];
};

export type BacktestResult = {
  model_key: string;
  params: Record<string, unknown>;
  per_symbol: BacktestPerSymbol[];
  summary: BacktestSummary;
};

export type BacktestRun = {
  id: string;
  company_id: string;
  requested_by: string;
  model_key: string;
  symbols: string[];
  granularity_secs: number;
  bar_count: number;
  horizon: number;
  stride: number;
  stop_pct: number;
  payoff_ratio: number;
  status: BacktestStatus;
  error_message: string | null;
  result_json: BacktestResult | null;
  n_forecasts: number | null;
  overall_hit_rate: number | null;
  overall_brier: number | null;
  overall_pnl_pct: number | null;
  applied_actions: Array<{
    agent_id: string;
    agent_name: string;
    by_account: string;
    at: string;
    changes: Record<string, unknown>;
  }>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_secs: number | null;
};

export type BacktestApplyResult = {
  run_id: string;
  agent_id: string;
  changes: Record<string, unknown>;
};

export type PostmortemPage = {
  postmortems: Postmortem[];
  total: number;
  limit: number;
  offset: number;
};

export type PostmortemFacets = {
  assets: string[];
  agents: { id: string; name: string }[];
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

export type QuickTradeResult = {
  intent_id: string;
  asset: string;
  direction: "up" | "down";
  contract_type: string;
  stake_usd: number;
  duration_secs: number;
  entry_price: number;
  status: string;
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

export type DerivStatementTransaction = {
  transaction_id: number;
  reference_id: number;
  action_type: string; // buy | sell | deposit | withdrawal | adjustment | escrow
  amount: number;
  balance_after: number;
  transaction_time: number;
  longcode: string | null;
  contract_id: number;
  symbol: string | null;
};

export type DerivStatement = {
  count: number;
  transactions: DerivStatementTransaction[];
};

// ─── voice (Gemini Live) ───

export type VoiceFeel = "warm" | "neutral" | "cool" | "energetic";

export type VoiceDef = {
  name: string;
  label: string;
  feel: VoiceFeel;
  description: string;
};

export type VoiceSession = {
  available: boolean;
  session_id: string;
  token: string | null;
  ws_url: string | null;
  model: string;
  voice_name: string;
  voice_label: string;
  voice_feel: VoiceFeel | "";
  requires_gemini_brain: boolean;
  agent_brain_label: string;
  expire_time: string | null;
};

// ─── safety types ───

export type SafetyState = {
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  kill_switch_at: string | null;
  daily_loss_limit_usd: number | null;
  today_realized_pnl_usd: number;
  insurance_balance_usd: number;
  recent_sweeps: SweepRecord[];
  cooling_off_agents: CoolingOffAgent[];
};

export type SweepRecord = {
  id: string;
  agent_name: string | null;
  amount_usd: number;
  window_realized_pnl_usd: number;
  allocation_usd: number;
  reason: string;
  created_at: string;
};

export type CoolingOffAgent = {
  agent_id: string;
  agent_name: string;
  cooling_off_until: string;
  streak_at_trigger: number;
};

// ─── edge report ───

export type EdgeWindow = "7d" | "30d" | "90d" | "all";

export type AgentEdge = {
  agent_id: string;
  agent_name: string;
  forecasting_model: string;
  is_active: boolean;
  is_paused: boolean;
  live_n: number;
  live_wins: number;
  live_losses: number;
  live_hit_rate: number | null;
  live_avg_pnl_usd: number | null;
  live_total_pnl_usd: number;
  live_avg_confidence: number | null;
  backtest_hit_rate: number | null;
  backtest_run_id: string | null;
  backtest_n_forecasts: number | null;
  hit_rate_gap_pp: number | null;
  verdict: string;
  verdict_tone: "bull" | "bear" | "muted";
  calibration_method: "isotonic" | "platt" | null;
  calibration_n_samples: number | null;
  calibration_brier_raw: number | null;
  calibration_brier_calibrated: number | null;
  calibration_ece_raw: number | null;
  calibration_ece_calibrated: number | null;
};

export type EdgeReport = {
  window: EdgeWindow;
  generated_at: string;
  agents: AgentEdge[];
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
