-- Whitepaper lifecycle: stato dopo approvazione utente (prima della submit RPC).
DO $$
BEGIN
  ALTER TYPE "ExecutionStatus" ADD VALUE 'PENDING_SIGNATURE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
