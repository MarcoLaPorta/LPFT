-- LPFT→AFX bridge: stato iniziale sweeper + idempotenza ExecutionLog
DO $$
BEGIN
  ALTER TYPE "ExecutionStatus" ADD VALUE 'PENDING';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);

UPDATE "execution_logs"
SET "idempotency_key" = gen_random_uuid()::text
WHERE "idempotency_key" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "execution_logs_idempotency_key_key" ON "execution_logs"("idempotency_key");

ALTER TABLE "execution_logs" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- Utente ponte LPFT (intent senza wallet reale ancora)
INSERT INTO "users" ("id", "wallet_address", "email", "created_at", "updated_at")
VALUES (
  'cmfnhlpftbridge0000000001',
  '0x0000000000000000000000000000000000000001',
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT ("wallet_address") DO NOTHING;
