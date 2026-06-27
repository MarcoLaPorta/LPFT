"""Tier 1 Phase 2 — validation quant (CPCV, DSR, FFD, MC, CVaR)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from lpft_api.schemas import Tier1MonteCarloRequest, Tier1MonteCarloResponse, Tier1ValidateRequest, Tier1ValidateResponse
from lpft_shared.tier1.monte_carlo import simulate_terminal_returns
from lpft_shared.tier1.pipeline import run_tier1_validation

router = APIRouter()


@router.post("/validate", response_model=Tier1ValidateResponse)
def tier1_validate(body: Tier1ValidateRequest) -> Tier1ValidateResponse:
    if not body.equity and not body.returns:
        raise HTTPException(status_code=400, detail="Provide equity or returns")
    try:
        result = run_tier1_validation(
            equity=body.equity,
            returns=body.returns,
            n_trials=body.n_trials,
            mc_paths=body.mc_paths,
            mc_horizon_days=body.mc_horizon_days,
            ffd_d=body.ffd_d,
            cpcv_n_groups=body.cpcv_n_groups,
            cpcv_n_test_groups=body.cpcv_n_test_groups,
            periods_per_year=body.periods_per_year,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Tier1ValidateResponse(**result)


@router.post("/monte-carlo", response_model=Tier1MonteCarloResponse)
def tier1_monte_carlo(body: Tier1MonteCarloRequest) -> Tier1MonteCarloResponse:
    if not body.returns:
        raise HTTPException(status_code=400, detail="Provide returns")
    try:
        result = simulate_terminal_returns(
            body.returns,
            horizon_days=body.horizon_days,
            n_paths=body.n_paths,
            seed=body.seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Tier1MonteCarloResponse(**result)
