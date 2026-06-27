-- CreateTable
CREATE TABLE "strategy_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "benchmark" VARCHAR(32),
    "intent_class" VARCHAR(32),
    "intent_summary" TEXT,
    "compiled_strategy" JSONB,
    "engine_spec" JSONB,
    "metrics" JSONB,
    "benchmark_metrics" JSONB,
    "equity_series" JSONB,
    "projections" JSONB,
    "trades" JSONB,
    "market_context" JSONB,
    "market_routing_mode" VARCHAR(32),
    "risk_caps_applied" JSONB,
    "execution_log_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_snapshots_execution_log_id_key" ON "strategy_snapshots"("execution_log_id");

-- CreateIndex
CREATE INDEX "strategy_snapshots_user_id_created_at_idx" ON "strategy_snapshots"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "strategy_snapshots" ADD CONSTRAINT "strategy_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
