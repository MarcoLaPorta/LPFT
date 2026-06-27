-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "DexProtocol" AS ENUM ('UNISWAP_V3', 'UNISWAP_V2', 'CURVE', 'OTHER');

-- CreateEnum
CREATE TYPE "VaultStatus" AS ENUM ('PENDING_DEPLOY', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('OPEN', 'ACCEPTED', 'SETTLED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketRoutingMode" AS ENUM ('PRIMARY_MINT_BURN', 'PRIMARY_RFQ_ATOMIC', 'SECONDARY_AMM');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('LOGGED_PROPOSAL', 'AWAITING_USER_SIGNATURE', 'AWAITING_MANAGER_SIGNATURE', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whitelisted_dex_routers" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "protocol" "DexProtocol" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whitelisted_dex_routers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_factory_configs" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "factory_address" TEXT NOT NULL,
    "implementation_address" TEXT,
    "deployed_block" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_factory_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smart_vaults" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "vault_address" TEXT NOT NULL,
    "manager_address" TEXT NOT NULL,
    "deployed_at" TIMESTAMP(3),
    "deployment_tx_hash" TEXT,
    "status" "VaultStatus" NOT NULL DEFAULT 'PENDING_DEPLOY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smart_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rwa_tokens" (
    "id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "token_address" TEXT NOT NULL,
    "underlying_ticker" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "primary_window_only" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rwa_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" DECIMAL(78,0) NOT NULL,
    "amount_out" DECIMAL(78,0) NOT NULL,
    "quote_provider" VARCHAR(64) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'OPEN',
    "idempotency_key" TEXT,
    "settlement_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "smart_vault_id" TEXT,
    "conversation_id" TEXT,
    "user_prompt" TEXT NOT NULL,
    "ai_reasoning" TEXT NOT NULL,
    "pnl_result" JSONB NOT NULL,
    "market_routing_mode" "MarketRoutingMode" NOT NULL,
    "execution_status" "ExecutionStatus" NOT NULL DEFAULT 'LOGGED_PROPOSAL',
    "token_in_address" TEXT,
    "token_out_address" TEXT,
    "router_address" TEXT,
    "chain_id" INTEGER,
    "calldata_digest" VARCHAR(66),
    "transaction_hash" TEXT,
    "confirmed_block" BIGINT,
    "model_id" VARCHAR(128),
    "prompt_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "conversations_user_id_created_at_idx" ON "conversations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "whitelisted_dex_routers_chain_id_active_idx" ON "whitelisted_dex_routers"("chain_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "whitelisted_dex_routers_chain_id_address_key" ON "whitelisted_dex_routers"("chain_id", "address");

-- CreateIndex
CREATE UNIQUE INDEX "vault_factory_configs_chain_id_key" ON "vault_factory_configs"("chain_id");

-- CreateIndex
CREATE UNIQUE INDEX "smart_vaults_vault_address_key" ON "smart_vaults"("vault_address");

-- CreateIndex
CREATE INDEX "smart_vaults_user_id_chain_id_idx" ON "smart_vaults"("user_id", "chain_id");

-- CreateIndex
CREATE INDEX "smart_vaults_chain_id_status_idx" ON "smart_vaults"("chain_id", "status");

-- CreateIndex
CREATE INDEX "rwa_tokens_chain_id_symbol_idx" ON "rwa_tokens"("chain_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "rwa_tokens_chain_id_token_address_key" ON "rwa_tokens"("chain_id", "token_address");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_quotes_idempotency_key_key" ON "rfq_quotes"("idempotency_key");

-- CreateIndex
CREATE INDEX "rfq_quotes_user_id_status_created_at_idx" ON "rfq_quotes"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "execution_logs_user_id_created_at_idx" ON "execution_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "execution_logs_execution_status_created_at_idx" ON "execution_logs"("execution_status", "created_at");

-- CreateIndex
CREATE INDEX "execution_logs_market_routing_mode_created_at_idx" ON "execution_logs"("market_routing_mode", "created_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_vaults" ADD CONSTRAINT "smart_vaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "rfq_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_smart_vault_id_fkey" FOREIGN KEY ("smart_vault_id") REFERENCES "smart_vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

