-- CreateTable
CREATE TABLE "market_data_bars" (
    "id" TEXT NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "adj_close" DECIMAL(24,8) NOT NULL,
    "volume" DECIMAL(24,2),
    "source" VARCHAR(16) NOT NULL DEFAULT 'yahoo',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_bars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_data_bars_symbol_date_key" ON "market_data_bars"("symbol", "date");

-- CreateIndex
CREATE INDEX "market_data_bars_symbol_date_idx" ON "market_data_bars"("symbol", "date");
