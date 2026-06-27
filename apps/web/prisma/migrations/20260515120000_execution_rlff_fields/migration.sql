-- ExecutionLog: campi RLFF/backtest + stato DRAFT (proposte IA prima della submit)
DO $$
BEGIN
  ALTER TYPE "ExecutionStatus" ADD VALUE 'DRAFT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "strategy_metrics" JSONB;
ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "action_type" VARCHAR(64);
ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "payload_json" JSONB;
