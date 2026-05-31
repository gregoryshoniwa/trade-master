"""Pydantic request/response schemas. Keep them all in one file at this scale."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ───────────────────────── auth ─────────────────────────


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    full_name: str = Field(min_length=1, max_length=120)
    jurisdiction: str = Field(default="ZW", max_length=2, min_length=2)
    # If provided, immediately create a Company and make the user its
    # owner+CEO. If omitted, the user can create one later.
    company_name: str | None = Field(default=None, min_length=2, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class AuthResponse(BaseModel):
    account_id: UUID
    email: EmailStr
    full_name: str | None
    is_new_account: bool = False
    company_id: UUID | None = None  # populated on signup + invite-accept


class InvitePeekResponse(BaseModel):
    email: EmailStr
    company_id: UUID
    company_name: str
    role: str
    title: str | None


class AcceptInviteRequest(BaseModel):
    token: str
    # Both optional — required only for first-time signup via invite.
    password: str | None = Field(default=None, min_length=10, max_length=200)
    full_name: str | None = Field(default=None, max_length=120)


# ───────────────────────── me ─────────────────────────


class Me(BaseModel):
    account_id: UUID
    email: EmailStr
    full_name: str | None
    jurisdiction: str
    created_at: datetime
    active_company_id: UUID | None = None


# ───────────────────── companies ────────────────────────


class CompanyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    brand_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class Company(BaseModel):
    id: UUID
    name: str
    slug: str
    brand_color: str | None
    base_currency: str
    paper_mode: bool
    current_asset_tier: int
    unlocked_contract_types: list[str]
    tier_name: str  # 'free' | 'starter' | 'pro' | 'enterprise'
    role: str  # this user's role in this company
    created_at: datetime


class CompanyList(BaseModel):
    companies: list[Company]


class SwitchCompanyRequest(BaseModel):
    company_id: UUID


# ─────────────────────── company members ──────────────────────


class CompanyMember(BaseModel):
    account_id: UUID
    email: EmailStr
    full_name: str | None
    role: str  # owner | admin | trader | viewer
    title: str | None
    joined_at: datetime


class CompanyMemberList(BaseModel):
    members: list[CompanyMember]


class InviteCreate(BaseModel):
    email: EmailStr
    role: str = Field(pattern=r"^(admin|trader|viewer)$")
    title: str | None = Field(default=None, max_length=120)


class InviteCreated(BaseModel):
    invite_id: UUID
    email: EmailStr
    role: str
    title: str | None
    expires_at: datetime
    # Dev convenience until Resend is wired (PLAN §33.5)
    accept_url: str


class UpdateMemberRoleRequest(BaseModel):
    # All optional — only set fields are touched. `full_name` lets an
    # admin correct a typo in someone's display name without forcing
    # them to log in and change it themselves.
    role: str | None = Field(default=None, pattern=r"^(owner|admin|trader|viewer)$")
    title: str | None = Field(default=None, max_length=120)
    full_name: str | None = Field(default=None, min_length=1, max_length=120)


class CreateMemberRequest(BaseModel):
    """Admin-create flow. Replaces the email-invite path with direct
    account creation: the admin enters the user's email + initial
    password and tells them out-of-band; the user logs in immediately."""
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=10, max_length=200)
    role: str = Field(pattern=r"^(admin|trader|viewer)$")
    title: str | None = Field(default=None, max_length=120)


class ResetMemberPasswordResponse(BaseModel):
    """Returned to the admin after a reset. The caller is responsible
    for communicating the temp password to the user; we never email it.
    The user can change it themselves once logged in."""
    account_id: UUID
    email: EmailStr
    temp_password: str


# ─────────────────────── personalities ──────────────────────


class PersonalityDef(BaseModel):
    key: str
    label: str
    icon: str
    description: str
    kelly_fraction: float
    min_confidence_threshold: float
    min_payoff_ratio: float
    max_trades_per_day: int
    target_holding_secs: int | None


# ────────────────────────── agents ──────────────────────────

# Validation: keep these tight enough to be safe, loose enough to accept
# future LLM models without API changes. The Risk Agent enforces the
# trading-side caps regardless.

AGENT_ROLES = ("manager", "employee", "research")
PERSONALITIES = ("sniper", "scalper", "hunter", "guardian", "balanced", "custom")
TRADE_SELECTION_MODES = ("specific", "most_profitable", "safest", "balanced")
TRADE_MODES = ("autonomous", "approve_each", "approve_above_threshold")


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    role: str = Field(pattern=r"^(manager|employee|research)$")
    avatar_url: str | None = None
    reports_to_agent_id: UUID | None = None
    llm_provider: str = Field(min_length=2, max_length=32)
    llm_model: str = Field(min_length=2, max_length=80)
    forecasting_model: str = "ttm-granite-r2"
    llm_config: dict = Field(default_factory=dict)
    voice_id: str | None = None
    voice_enabled: bool = True
    strategies: list[str] = Field(default_factory=list)
    allowed_assets: list[str] = Field(default_factory=list)
    allowed_contract_types: list[str] = Field(default_factory=list)
    allocated_balance_usd: float = 0
    max_position_size_usd: float = 25
    max_daily_drawdown_pct: float = 5.0
    personality: str = "balanced"
    trade_selection_mode: str = "balanced"
    allowed_combinations: list[dict] = Field(default_factory=list)
    kelly_fraction: float | None = None
    min_confidence_threshold: float | None = None
    min_payoff_ratio: float | None = None
    max_trades_per_day: int | None = None
    target_holding_secs: int | None = None
    event_aware: bool = True
    trade_mode: str = "approve_each"
    system_prompt_addendum: str | None = None


class AgentUpdate(BaseModel):
    name: str | None = None
    avatar_url: str | None = None
    reports_to_agent_id: UUID | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    forecasting_model: str | None = None
    llm_config: dict | None = None
    voice_id: str | None = None
    voice_enabled: bool | None = None
    strategies: list[str] | None = None
    allowed_assets: list[str] | None = None
    allowed_contract_types: list[str] | None = None
    allocated_balance_usd: float | None = None
    max_position_size_usd: float | None = None
    max_daily_drawdown_pct: float | None = None
    personality: str | None = None
    trade_selection_mode: str | None = None
    allowed_combinations: list[dict] | None = None
    kelly_fraction: float | None = None
    min_confidence_threshold: float | None = None
    min_payoff_ratio: float | None = None
    max_trades_per_day: int | None = None
    target_holding_secs: int | None = None
    daily_profit_target_usd: float | None = None
    forecast_min_interval_secs: int | None = None
    event_aware: bool | None = None
    trade_mode: str | None = None
    system_prompt_addendum: str | None = None


class Agent(BaseModel):
    id: UUID
    company_id: UUID
    name: str
    avatar_url: str | None
    role: str
    reports_to_agent_id: UUID | None
    llm_provider: str
    llm_model: str
    forecasting_model: str
    voice_id: str | None
    voice_enabled: bool
    strategies: list[str]
    allowed_assets: list[str]
    allowed_contract_types: list[str]
    allocated_balance_usd: float
    max_position_size_usd: float
    max_daily_drawdown_pct: float
    personality: str
    trade_selection_mode: str
    allowed_combinations: list[dict]
    kelly_fraction: float
    min_confidence_threshold: float
    min_payoff_ratio: float
    max_trades_per_day: int
    target_holding_secs: int | None
    daily_profit_target_usd: float | None
    forecast_min_interval_secs: int
    event_aware: bool
    aggression_index: int
    detected_personality: str | None
    trade_mode: str
    is_active: bool
    is_paused: bool
    pause_reason: str | None
    system_prompt_addendum: str | None
    created_at: datetime
    updated_at: datetime


class AgentList(BaseModel):
    agents: list[Agent]


class PauseRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=200)
