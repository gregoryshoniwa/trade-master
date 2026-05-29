"""Company CRUD — Phase 0: list, create."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from slugify import slugify

from app.auth import CurrentAccount
from app.db import acquire
from app.personalities import STARTER_AGENTS, apply_preset
from app.schemas import Company, CompanyCreate, CompanyList

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyPaperModeUpdate(BaseModel):
    paper_mode: bool


@router.get("", response_model=CompanyList)
async def list_companies(account_id: CurrentAccount):
    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.id, c.name, c.slug, c.brand_color, c.base_currency,
                   c.paper_mode, c.current_asset_tier, c.unlocked_contract_types,
                   c.created_at, m.role
            FROM companies c
            JOIN company_members m ON m.company_id = c.id
            WHERE m.account_id = $1
            ORDER BY m.joined_at DESC
            """,
            account_id,
        )
    return CompanyList(
        companies=[
            Company(
                id=r["id"],
                name=r["name"],
                slug=r["slug"],
                brand_color=r["brand_color"],
                base_currency=r["base_currency"],
                paper_mode=r["paper_mode"],
                current_asset_tier=r["current_asset_tier"],
                unlocked_contract_types=list(r["unlocked_contract_types"]),
                role=r["role"],
                created_at=r["created_at"],
            )
            for r in rows
        ]
    )


@router.post("", response_model=Company, status_code=status.HTTP_201_CREATED)
async def create_company(body: CompanyCreate, account_id: CurrentAccount):
    async with acquire() as conn:
        async with conn.transaction():
            slug = await _unique_slug(conn, body.name)
            row = await conn.fetchrow(
                """
                INSERT INTO companies
                    (name, slug, brand_color, ceo_account_id, created_by)
                VALUES ($1, $2, $3, $4, $4)
                RETURNING id, name, slug, brand_color, base_currency,
                          paper_mode, current_asset_tier,
                          unlocked_contract_types, created_at
                """,
                body.name,
                slug,
                body.brand_color,
                account_id,
            )
            # Creator becomes owner with CEO title (the AI agents read this).
            await conn.execute(
                """
                INSERT INTO company_members
                    (company_id, account_id, role, title)
                VALUES ($1, $2, 'owner', 'CEO')
                """,
                row["id"],
                account_id,
            )

            # Seed the starter Agent set (PLAN §6.4): Manager + 5 strategy
            # employees + Research. Manager is inserted first so the
            # employees can reports_to it.
            await _seed_starter_agents(conn, row["id"], account_id)

    return Company(
        id=row["id"],
        name=row["name"],
        slug=row["slug"],
        brand_color=row["brand_color"],
        base_currency=row["base_currency"],
        paper_mode=row["paper_mode"],
        current_asset_tier=row["current_asset_tier"],
        unlocked_contract_types=list(row["unlocked_contract_types"]),
        role="owner",
        created_at=row["created_at"],
    )


@router.patch("/{company_id}/paper-mode", response_model=Company)
async def set_paper_mode(
    company_id: UUID, body: CompanyPaperModeUpdate, account_id: CurrentAccount,
    request: Request,
):
    """Flip the company's paper_mode. Going FROM paper TO live is the one
    operation in the whole app that can lose real money — it's gated by a
    fresh passkey assertion (≤5 min old, lives in the `tm_passkey_unlock`
    cookie). The reverse (live → paper) is always allowed; you should
    never need a passkey to put the brakes on."""
    async with acquire() as conn:
        role = await conn.fetchval(
            "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
            company_id, account_id,
        )
        if role is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
        if role not in ("owner", "admin"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "owner/admin only")
        current = await conn.fetchval(
            "SELECT paper_mode FROM companies WHERE id = $1", company_id,
        )
        if current is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")

        # Going live — require fresh passkey assertion.
        if current and not body.paper_mode:
            from app.routes.passkey import UNLOCK_COOKIE, decode_unlock_jwt
            unlock = request.cookies.get(UNLOCK_COOKIE)
            if not unlock:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "passkey required to leave paper mode — sign with your "
                    "passkey at /passkeys then retry within 5 minutes",
                )
            try:
                signer = decode_unlock_jwt(unlock)
            except HTTPException:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "passkey unlock expired — sign again",
                )
            if signer != account_id:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "passkey signer mismatch",
                )

        row = await conn.fetchrow(
            """
            UPDATE companies
            SET paper_mode = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, name, slug, brand_color, base_currency,
                      paper_mode, current_asset_tier,
                      unlocked_contract_types, created_at
            """,
            company_id, body.paper_mode,
        )

    return Company(
        id=row["id"], name=row["name"], slug=row["slug"],
        brand_color=row["brand_color"], base_currency=row["base_currency"],
        paper_mode=row["paper_mode"],
        current_asset_tier=row["current_asset_tier"],
        unlocked_contract_types=list(row["unlocked_contract_types"]),
        role=role, created_at=row["created_at"],
    )


class WebSearchConfig(BaseModel):
    enabled: bool
    allowed_domains: list[str]
    blocked_domains: list[str]
    daily_quota: int
    used_today: int


class WebSearchConfigUpdate(BaseModel):
    enabled: bool | None = None
    allowed_domains: list[str] | None = None
    blocked_domains: list[str] | None = None
    daily_quota: int | None = Field(default=None, ge=0, le=10_000)


@router.get("/{company_id}/web-search-config", response_model=WebSearchConfig)
async def get_web_search_config(company_id: UUID, account_id: CurrentAccount):
    async with acquire() as conn:
        role = await conn.fetchval(
            "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
            company_id, account_id,
        )
        if role is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
        row = await conn.fetchrow(
            """
            SELECT web_search_enabled, web_search_allowed_domains,
                   web_search_blocked_domains, web_search_daily_quota
            FROM companies WHERE id = $1
            """,
            company_id,
        )
        used = await conn.fetchval(
            """
            SELECT count(*) FROM web_search_log
            WHERE company_id = $1
              AND created_at >= date_trunc('day', now())
              AND ok
            """,
            company_id,
        ) or 0
    return WebSearchConfig(
        enabled=bool(row["web_search_enabled"]),
        allowed_domains=list(row["web_search_allowed_domains"] or []),
        blocked_domains=list(row["web_search_blocked_domains"] or []),
        daily_quota=int(row["web_search_daily_quota"]),
        used_today=int(used),
    )


@router.patch("/{company_id}/web-search-config", response_model=WebSearchConfig)
async def patch_web_search_config(
    company_id: UUID, body: WebSearchConfigUpdate, account_id: CurrentAccount,
):
    async with acquire() as conn:
        role = await conn.fetchval(
            "SELECT role FROM company_members WHERE company_id=$1 AND account_id=$2",
            company_id, account_id,
        )
        if role is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
        if role not in ("owner", "admin"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "owner/admin only")

        # Normalize domain inputs: strip whitespace, lower-case, drop
        # leading "https://" or "www." if pasted by mistake.
        def _norm(ds: list[str] | None) -> list[str] | None:
            if ds is None:
                return None
            out: list[str] = []
            for d in ds:
                s = (d or "").strip().lower()
                if s.startswith("https://"): s = s[8:]
                if s.startswith("http://"): s = s[7:]
                if s.startswith("www."): s = s[4:]
                s = s.rstrip("/")
                if s:
                    out.append(s)
            # dedupe, preserve order
            seen: set[str] = set()
            return [d for d in out if not (d in seen or seen.add(d))]

        allowed = _norm(body.allowed_domains)
        blocked = _norm(body.blocked_domains)

        row = await conn.fetchrow(
            """
            UPDATE companies SET
                web_search_enabled = COALESCE($2, web_search_enabled),
                web_search_allowed_domains = COALESCE($3, web_search_allowed_domains),
                web_search_blocked_domains = COALESCE($4, web_search_blocked_domains),
                web_search_daily_quota = COALESCE($5, web_search_daily_quota),
                updated_at = now()
            WHERE id = $1
            RETURNING web_search_enabled, web_search_allowed_domains,
                      web_search_blocked_domains, web_search_daily_quota
            """,
            company_id, body.enabled, allowed, blocked, body.daily_quota,
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "company not found")
        used = await conn.fetchval(
            """
            SELECT count(*) FROM web_search_log
            WHERE company_id = $1
              AND created_at >= date_trunc('day', now())
              AND ok
            """,
            company_id,
        ) or 0
    return WebSearchConfig(
        enabled=bool(row["web_search_enabled"]),
        allowed_domains=list(row["web_search_allowed_domains"] or []),
        blocked_domains=list(row["web_search_blocked_domains"] or []),
        daily_quota=int(row["web_search_daily_quota"]),
        used_today=int(used),
    )


async def _unique_slug(conn, name: str) -> str:
    """Generate a slug that doesn't collide. Tries name, then name-2, -3..."""
    base = slugify(name) or "company"
    candidate = base
    n = 2
    while await conn.fetchval("SELECT 1 FROM companies WHERE slug = $1", candidate):
        candidate = f"{base}-{n}"
        n += 1
        if n > 1000:
            raise HTTPException(status.HTTP_409_CONFLICT, "slug exhaustion")
    return candidate


async def _seed_starter_agents(conn, company_id, created_by) -> None:
    """Insert the 7 default agents (Alpha + Trendy/Brakey/Rocky/Rev/Action
    + Scout), with the Manager first so employees can report to it."""
    manager_id = None
    for spec in STARTER_AGENTS:
        preset = apply_preset(spec["personality"])
        reports_to = manager_id if spec["role"] != "manager" else None
        inserted_id = await conn.fetchval(
            """
            INSERT INTO agents (
                company_id, name, role, reports_to_agent_id,
                llm_provider, llm_model, voice_id, strategies,
                personality, trade_selection_mode,
                kelly_fraction, min_confidence_threshold, min_payoff_ratio,
                max_trades_per_day, target_holding_secs,
                trade_mode, created_by
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, 'balanced',
                $10, $11, $12,
                $13, $14,
                'approve_each', $15
            )
            RETURNING id
            """,
            company_id, spec["name"], spec["role"], reports_to,
            spec["llm_provider"], spec["llm_model"], spec["voice_id"], spec["strategies"],
            spec["personality"],
            preset["kelly_fraction"], preset["min_confidence_threshold"], preset["min_payoff_ratio"],
            preset["max_trades_per_day"], preset["target_holding_secs"],
            created_by,
        )
        if spec["role"] == "manager":
            manager_id = inserted_id
