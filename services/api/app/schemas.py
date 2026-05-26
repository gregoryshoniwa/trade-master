"""Pydantic request/response schemas. Keep them all in one file at this scale."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ───────────────────────── auth ─────────────────────────


class MagicLinkRequest(BaseModel):
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=120)


class MagicLinkResponse(BaseModel):
    sent: bool
    # Dev convenience: we return the link in the response so the frontend
    # can show "click here to log in" without an email provider wired up.
    # Phase 4+ removes this and ships via Resend.
    dev_link: str | None = None


class VerifyRequest(BaseModel):
    token: str


class VerifyResponse(BaseModel):
    account_id: UUID
    email: EmailStr
    full_name: str | None
    is_new: bool


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
    role: str  # this user's role in this company
    created_at: datetime


class CompanyList(BaseModel):
    companies: list[Company]


class SwitchCompanyRequest(BaseModel):
    company_id: UUID
