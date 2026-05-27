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
