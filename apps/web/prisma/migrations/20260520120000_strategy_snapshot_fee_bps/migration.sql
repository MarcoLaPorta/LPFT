-- Denormalized institutional fee bps on strategy snapshots (optional for legacy rows).
ALTER TABLE "strategy_snapshots" ADD COLUMN IF NOT EXISTS "maker_fee_bps" INTEGER;
ALTER TABLE "strategy_snapshots" ADD COLUMN IF NOT EXISTS "taker_fee_bps" INTEGER;
