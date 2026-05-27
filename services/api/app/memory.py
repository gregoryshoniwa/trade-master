"""mem0 wrapper with TradeMaster's compound-key scoping (PLAN §8 / §11).

Key rules from the plan:
- mem0 OSS lacks first-class multi-tenant isolation, so we prepend
  `{company_id}:` to every user_id and agent_id we hand to mem0.
- One pgvector collection per Company keeps tenants in separate row spaces
  (defense in depth on top of the compound keys).
- Add()s are fired async after the chat response so they never block UX.
"""

from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID

from mem0 import Memory

from app.config import settings

log = logging.getLogger("trademaster.memory")

# mem0 is sync. Run it on a small thread pool so we don't block the event
# loop. One thread is enough — we expect <1 concurrent extraction per user.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mem0")


# Embedding choice — see the journal below. We tried Gemini's embedding API
# first but hit two blockers: `text-embedding-004` is no longer routable
# via v1beta, and `gemini-embedding-001` outputs 3072-dim vectors which
# exceed pgvector's HNSW index limit of 2000. mem0's wrapper does not
# forward `output_dimensionality` to truncate the vector.
#
# Settled on a small sentence-transformers model running locally inside the
# api container — 384-dim, ~25MB on disk, sub-millisecond CPU inference,
# zero outbound network per embedding. Quality is "good enough" for the
# conversational memory we're storing in Phase 1.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384


def _pgvector_config_for(collection: str) -> dict:
    url = settings.database_url
    from urllib.parse import urlparse
    p = urlparse(url)
    return {
        "user": p.username or "trademaster",
        "password": p.password or "",
        "host": p.hostname or "postgres",
        "port": p.port or 5432,
        "dbname": (p.path or "/trademaster").lstrip("/"),
        "collection_name": collection,
        "embedding_model_dims": EMBEDDING_DIM,
    }


def _config_for_company(company_id: UUID) -> dict:
    """Per-Company mem0 config. The collection_name varies per tenant."""
    collection = f"mem0_company_{str(company_id).replace('-', '_')}"
    return {
        "vector_store": {
            "provider": "pgvector",
            "config": _pgvector_config_for(collection),
        },
        "embedder": {
            "provider": "huggingface",
            "config": {
                "model": EMBEDDING_MODEL,
                "embedding_dims": EMBEDDING_DIM,
            },
        },
        "llm": {
            "provider": "gemini",
            "config": {
                "model": "gemini-2.5-flash",
                "api_key": os.getenv("GEMINI_API_KEY"),
                "temperature": 0.0,
                "max_tokens": 1024,
            },
        },
        "version": "v1.1",
    }


class MemoryService:
    """Thin async wrapper. mem0 is sync — we hop to a thread for each call."""

    def __init__(self):
        # mem0 Memory objects are cheap to create but the embedder + LLM
        # clients inside them are not. Cache per-Company.
        self._cache: dict[UUID, Memory] = {}
        self._cache_lock = asyncio.Lock()

    async def _memory_for(self, company_id: UUID) -> Memory:
        async with self._cache_lock:
            m = self._cache.get(company_id)
            if m is None:
                m = await asyncio.get_running_loop().run_in_executor(
                    _executor,
                    lambda: Memory.from_config(_config_for_company(company_id)),
                )
                self._cache[company_id] = m
            return m

    @staticmethod
    def _user_key(company_id: UUID, account_id: UUID) -> str:
        return f"{company_id}:user:{account_id}"

    @staticmethod
    def _agent_key(company_id: UUID, agent_id: UUID) -> str:
        return f"{company_id}:agent:{agent_id}"

    async def add_turn(
        self,
        *,
        company_id: UUID,
        account_id: UUID,
        agent_id: UUID,
        messages: list[dict[str, str]],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Fire-and-forget: let mem0 extract facts from this exchange.
        Never raises — failures are logged."""
        try:
            mem = await self._memory_for(company_id)
            user_id = self._user_key(company_id, account_id)
            agent_id_s = self._agent_key(company_id, agent_id)
            meta = {
                "company_id": str(company_id),
                "agent_id": str(agent_id),
                **(metadata or {}),
            }
            await asyncio.get_running_loop().run_in_executor(
                _executor,
                lambda: mem.add(
                    messages=messages,
                    user_id=user_id,
                    agent_id=agent_id_s,
                    metadata=meta,
                ),
            )
        except Exception:
            log.exception("mem0 add_turn failed")

    async def search(
        self,
        *,
        company_id: UUID,
        account_id: UUID,
        agent_id: UUID,
        query: str,
        limit: int = 5,
    ) -> list[dict]:
        """Return up to `limit` relevant memories. mem0 v1.1 expects entity
        scoping via the `filters=` arg (top-level kwargs were removed). We
        still can't combine user+agent filters in a single call, so two
        searches + merge.

        Failures return [] rather than raising — the chat must still work
        if memory is broken."""
        try:
            mem = await self._memory_for(company_id)
            user_id = self._user_key(company_id, account_id)
            agent_id_s = self._agent_key(company_id, agent_id)

            loop = asyncio.get_running_loop()
            user_hits, agent_hits = await asyncio.gather(
                loop.run_in_executor(
                    _executor,
                    lambda: mem.search(
                        query=query,
                        filters={"user_id": user_id},
                        limit=limit,
                    ),
                ),
                loop.run_in_executor(
                    _executor,
                    lambda: mem.search(
                        query=query,
                        filters={"agent_id": agent_id_s},
                        limit=limit,
                    ),
                ),
            )

            merged: dict[str, dict] = {}
            for hit in _flatten_hits(user_hits) + _flatten_hits(agent_hits):
                # Dedupe by mem0's stable memory id; keep the higher score.
                mid = hit.get("id") or hit.get("memory_id") or hit.get("memory", "")
                if not mid:
                    continue
                prev = merged.get(mid)
                if prev is None or (hit.get("score", 0) > prev.get("score", 0)):
                    merged[mid] = hit
            ranked = sorted(merged.values(), key=lambda h: h.get("score", 0), reverse=True)
            return ranked[:limit]
        except Exception:
            log.exception("mem0 search failed; returning []")
            return []


def _flatten_hits(result: Any) -> list[dict]:
    """mem0 returns either a list[dict] (v0.x) or {"results": [...]} (v1.x).
    Normalize to a flat list."""
    if result is None:
        return []
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        return list(result.get("results", []))
    return []


memory_service = MemoryService()
