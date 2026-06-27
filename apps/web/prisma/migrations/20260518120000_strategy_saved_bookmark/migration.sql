-- AlterTable
ALTER TABLE "strategy_snapshots" ADD COLUMN "saved_at" TIMESTAMP(3),
ADD COLUMN "title" VARCHAR(256);

-- CreateIndex
CREATE INDEX "strategy_snapshots_user_id_saved_at_idx" ON "strategy_snapshots"("user_id", "saved_at");
