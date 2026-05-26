"""Auth routes: request magic link, verify, logout."""

import logging

from fastapi import APIRouter, Response

from app.auth import (
    clear_session_cookie,
    consume_magic_link,
    create_magic_link,
    set_session_cookie,
)
from app.schemas import MagicLinkRequest, MagicLinkResponse, VerifyRequest, VerifyResponse

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("trademaster.auth")


@router.post("/magic-link", response_model=MagicLinkResponse)
async def request_magic_link(body: MagicLinkRequest):
    raw_token = await create_magic_link(body.email, body.full_name)
    link = f"http://localhost:3000/auth/verify?token={raw_token}"

    # In Phase 0 we print the link to logs (no email provider). The frontend
    # also shows the link returned in `dev_link` so the user can click without
    # tailing logs.
    log.info("magic link for %s → %s", body.email, link)
    return MagicLinkResponse(sent=True, dev_link=link)


@router.post("/verify", response_model=VerifyResponse)
async def verify_magic_link(body: VerifyRequest, response: Response):
    account_id, email, full_name, is_new = await consume_magic_link(body.token)
    set_session_cookie(response, account_id)
    return VerifyResponse(
        account_id=account_id, email=email, full_name=full_name, is_new=is_new
    )


@router.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}
