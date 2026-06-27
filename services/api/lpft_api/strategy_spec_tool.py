"""Tool Anthropic `submit_strategy_spec` con JSON Schema da Pydantic (structured output)."""

from __future__ import annotations

from functools import lru_cache

from lpft_api.dsl import StrategySpec

TOOL_NAME = "submit_strategy_spec"


@lru_cache(maxsize=1)
def _cached_strategy_spec_json_schema() -> dict:
    return StrategySpec.model_json_schema()


def get_submit_strategy_spec_tool_definition() -> dict:
    """Definizione tool per `messages.create(..., tools=[...], tool_choice=...)`."""
    return {
        "name": TOOL_NAME,
        "description": (
            "Submit one complete LPFT StrategySpec object: kind, params, risk, universe, execution, data. "
            "All fields required by the engine must be explicit."
        ),
        "input_schema": _cached_strategy_spec_json_schema(),
    }


def extract_strategy_spec_from_tool_response(message) -> StrategySpec | None:
    """Estrae StrategySpec da `Message.content` se presente tool_use `submit_strategy_spec`."""
    for block in getattr(message, "content", None) or []:
        if getattr(block, "type", None) != "tool_use":
            continue
        if getattr(block, "name", None) != TOOL_NAME:
            continue
        inp = getattr(block, "input", None)
        if isinstance(inp, dict):
            return StrategySpec.model_validate(inp)
    return None
