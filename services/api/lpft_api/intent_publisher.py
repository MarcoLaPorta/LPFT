"""Pubblica intent eseguibili (post-spec LLM) su Redis per il consumer AFX (ExecutionLog)."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import redis

from lpft_api.config import settings

logger = logging.getLogger(__name__)


def _intent_idempotency_key(*, user_prompt: str, spec_dump: dict[str, Any]) -> str:
    raw = (user_prompt or "").encode("utf-8") + b"\0" + json.dumps(spec_dump, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def publish_executable_intent(
    *,
    user_prompt: str,
    ai_reasoning: str,
    strategy_spec: dict[str, Any],
    symbol: str | None = None,
    wallet_address: str | None = None,
    router_address: str | None = None,
    chain_id: int | None = None,
    market_routing_mode: str = "SECONDARY_AMM",
    model_id: str | None = None,
    idempotency_key: str | None = None,
) -> bool:
    """
    Pubblica JSON su LPFT_AFX_INTENTS_CHANNEL (default `afx:intents:new`).
    Ritorna False se disabilitato o Redis non disponibile (non blocca l'API).
    """
    if not getattr(settings, "afx_intents_enabled", False):
        return False
    channel = getattr(settings, "afx_intents_channel", "afx:intents:new")
    key = idempotency_key or _intent_idempotency_key(user_prompt=user_prompt, spec_dump=strategy_spec)
    payload = {
        "version": 1,
        "idempotency_key": key,
        "user_prompt": user_prompt or "",
        "ai_reasoning": ai_reasoning or "",
        "strategy_spec": strategy_spec,
        "symbol": symbol,
        "wallet_address": wallet_address,
        "router_address": router_address,
        "chain_id": chain_id,
        "market_routing_mode": market_routing_mode,
        "model_id": model_id or getattr(settings, "llm_model", None),
    }
    try:
        r = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        try:
            n = r.publish(channel, json.dumps(payload, default=str))
            logger.info("AFX intent published channel=%s subscribers=%s key=%s", channel, n, key[:16])
            return True
        finally:
            r.close()
    except Exception as exc:
        logger.warning("AFX intent publish skipped: %s", exc)
        return False
