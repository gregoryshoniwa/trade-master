"""Company CRUD — Phase 0: list, create."""

from fastapi import APIRouter, HTTPException, status
from slugify import slugify

from app.auth import CurrentAccount
from app.db import acquire
from app.personalities import STARTER_AGENTS, apply_preset
from app.schemas import Company, CompanyCreate, CompanyList

router = APIRouter(prefix="/companies", tags=["companies"])


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
