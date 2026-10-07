-- The AI assistant (F11.14, F11.15) and the MCP server (F11.16): the assistant's settings per user
-- (own system prompt, chat consent, MCP switches), personal access tokens for MCP (hash only),
-- conversations with their messages and proposals, and the audit log of every tool call.
-- New tables only — no existing table is redefined.
--
-- The CHECK constraints are hand-added inside each CREATE TABLE, as in the earlier migrations;
-- assistant.persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "assistant_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "system_prompt" TEXT,
    "chat_consent_at" DATETIME,
    "mcp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mcp_areas" TEXT NOT NULL DEFAULT '[]',
    "mcp_allow_write" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "assistant_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assistant_settings_prompt" CHECK ("system_prompt" IS NULL OR length("system_prompt") BETWEEN 1 AND 8000),
    CONSTRAINT "assistant_settings_areas" CHECK (json_valid("mcp_areas") AND json_type("mcp_areas") = 'array')
);

-- CreateTable
CREATE TABLE "mcp_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mcp_token_name" CHECK (length(trim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "mcp_token_hash" CHECK (length("token_hash") = 64 AND "token_hash" NOT GLOB '*[^0-9a-f]*'),
    CONSTRAINT "mcp_token_hint" CHECK (length("token_hint") BETWEEN 1 AND 8)
);

-- CreateTable
CREATE TABLE "chat_conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "chat_conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_conversation_title" CHECK (length(trim("title")) BETWEEN 1 AND 120)
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_message_role" CHECK ("role" IN ('user', 'assistant', 'tool', 'event')),
    CONSTRAINT "chat_message_seq" CHECK ("seq" >= 0),
    CONSTRAINT "chat_message_data" CHECK (json_valid("data") AND json_type("data") = 'object')
);

-- CreateTable
CREATE TABLE "chat_proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" DATETIME,
    CONSTRAINT "chat_proposal_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_proposal_status" CHECK ("status" IN ('pending', 'executed', 'failed', 'cancelled')),
    CONSTRAINT "chat_proposal_args" CHECK (json_valid("args") AND json_type("args") = 'object'),
    CONSTRAINT "chat_proposal_preview" CHECK (json_valid("preview") AND json_type("preview") = 'object'),
    CONSTRAINT "chat_proposal_result" CHECK ("result" IS NULL OR json_valid("result")),
    CONSTRAINT "chat_proposal_decided" CHECK (("status" = 'pending') = ("decided_at" IS NULL))
);

-- CreateTable
CREATE TABLE "tool_audit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "token_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tool_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tool_audit_source" CHECK ("source" IN ('chat', 'mcp')),
    CONSTRAINT "tool_audit_status" CHECK ("status" IN ('ok', 'error', 'refused', 'proposed')),
    CONSTRAINT "tool_audit_args" CHECK (length("args") <= 2000),
    CONSTRAINT "tool_audit_duration" CHECK ("duration_ms" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_token_token_hash_key" ON "mcp_token"("token_hash");

-- CreateIndex
CREATE INDEX "mcp_token_user_id_idx" ON "mcp_token"("user_id");

-- CreateIndex
CREATE INDEX "chat_conversation_user_id_updated_at_idx" ON "chat_conversation"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_conversation_id_seq_key" ON "chat_message"("conversation_id", "seq");

-- CreateIndex
CREATE INDEX "chat_proposal_conversation_id_idx" ON "chat_proposal"("conversation_id");

-- CreateIndex
CREATE INDEX "tool_audit_user_id_created_at_idx" ON "tool_audit"("user_id", "created_at");
