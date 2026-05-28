"""Trade-selection-mode gates (PLAN §7.3/§7.4).

The decision loop reacts per-signal, so true multi-candidate ranking (pick the
single best EV across competing setups) is a future architectural change. For
now each mode applies different ACCEPTANCE criteria to the incoming signal:

  specific          — agent only trades the exact (strategy, asset, contract)
                      combos on its whitelist. CEO-style enforcement.
  most_profitable   — gate on minimum expected value in USD.
  safest            — require confidence floor AND the forecast's lower-quantile
                      path to NOT cross the stop (a band-crossing-stop signal
                      means the model itself thinks the stop is plausible).
  balanced          — no extra gate (current default).

Each helper returns (accept: bool, reason: str). The reason is logged into the
intent's entry_context so postmortems explain why a mode passed or rejected.
"""

from __future__ import annotations

from typing import Any


def accept_specific(
    allowed: list[dict[str, Any]],
    *,
    strategy: str | None,
    asset: str,
    contract: str,
) -> tuple[bool, str]:
    """Strict match: every field that's set on a row must match the signal.
    Missing fields on a row act as wildcards (e.g. `{"asset": "frxEURUSD"}`
    allows any strategy/contract on EUR/USD)."""
    if not allowed:
        return False, "specific mode with empty whitelist — fail-closed"
    for combo in allowed:
        if (
            (combo.get("strategy") in (None, "", strategy))
            and (combo.get("asset") in (None, "", asset))
            and (combo.get("contract") in (None, "", contract))
        ):
            return True, f"matched whitelist row {combo}"
    return False, f"no whitelist row matches ({strategy}, {asset}, {contract})"


def accept_most_profitable(ev_usd: float, *, threshold_usd: float) -> tuple[bool, str]:
    if ev_usd >= threshold_usd:
        return True, f"EV ${ev_usd:.2f} ≥ ${threshold_usd:.2f}"
    return False, f"EV ${ev_usd:.2f} below floor ${threshold_usd:.2f}"


def accept_safest(
    forecast: list[dict[str, Any]] | None,
    *,
    direction: str,
    stop_loss: float,
    confidence: float,
    confidence_floor: float = 0.7,
) -> tuple[bool, str]:
    """Reject when the model itself thinks the stop is plausibly hit: for
    longs, any p10 in the forecast below the stop is disqualifying; for shorts,
    any p90 above the stop. Also require a confidence floor."""
    if confidence < confidence_floor:
        return False, f"confidence {confidence:.2f} < safest floor {confidence_floor:.2f}"
    if not forecast:
        # No band data — we can't prove safety; conservatively allow with a
        # note, since the per-agent floor still gates it.
        return True, "no forecast band; confidence-only check"
    if direction == "up":
        worst = min(float(row["p10"]) for row in forecast if "p10" in row)
        if worst <= stop_loss:
            return False, f"p10 ({worst:.4f}) crosses stop ({stop_loss:.4f})"
    elif direction == "down":
        worst = max(float(row["p90"]) for row in forecast if "p90" in row)
        if worst >= stop_loss:
            return False, f"p90 ({worst:.4f}) crosses stop ({stop_loss:.4f})"
    return True, "band clears stop"


def accept_balanced() -> tuple[bool, str]:
    return True, "balanced mode — no gate"


def evaluate_mode(
    mode: str,
    *,
    allowed_combinations: list[dict[str, Any]],
    strategy: str | None,
    asset: str,
    contract: str,
    ev_usd: float,
    ev_threshold_usd: float,
    forecast: list[dict[str, Any]] | None,
    direction: str,
    stop_loss: float,
    confidence: float,
) -> tuple[bool, str]:
    """Dispatch on the agent's trade_selection_mode. Returns (accept, reason)."""
    if mode == "specific":
        return accept_specific(
            allowed_combinations, strategy=strategy, asset=asset, contract=contract,
        )
    if mode == "most_profitable":
        return accept_most_profitable(ev_usd, threshold_usd=ev_threshold_usd)
    if mode == "safest":
        return accept_safest(
            forecast, direction=direction, stop_loss=stop_loss, confidence=confidence,
        )
    # Default + explicit balanced
    return accept_balanced()
