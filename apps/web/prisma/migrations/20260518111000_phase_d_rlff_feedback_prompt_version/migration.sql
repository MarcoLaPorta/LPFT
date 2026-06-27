-- Phase D: RLFF feedback + prompt version metadata.
ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "user_feedback" TEXT;
ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "feedback_at" TIMESTAMP(3);
ALTER TABLE "execution_logs" ADD COLUMN IF NOT EXISTS "prompt_version" VARCHAR(64);
