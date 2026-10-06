-- Wallets (F6.1–F6.7): wallets per user, wallets of a project, the last fetch per wallet and
-- network, "kein Spam" overrides, manual balances with evidence, and the keys/addresses the chain
-- lookups need. Project files derived from a wallet fetch carry the origin `wallet:<wallet id>`.
--
-- The CHECK constraints are hand-added, as in the earlier migrations. project_file is redefined
-- only to widen its `origin` CHECK (SQLite cannot alter a CHECK); every other column, constraint
-- and index is copied unchanged from 20261007090000_ai_settings.
-- wallets.persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "address_kind" TEXT NOT NULL,
    "networks" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "network_check" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wallet_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallet_label_not_blank" CHECK (length(trim("label")) > 0),
    CONSTRAINT "wallet_address_not_blank" CHECK (length(trim("address")) > 0),
    CONSTRAINT "wallet_address_kind" CHECK ("address_kind" IN ('evm', 'bitcoinAddress', 'bitcoinXpub', 'solana', 'cardano', 'polkadot', 'cosmos')),
    CONSTRAINT "wallet_networks_json" CHECK (json_valid("networks") AND json_type("networks") = 'array'),
    CONSTRAINT "wallet_network_check_json" CHECK ("network_check" IS NULL OR json_valid("network_check"))
);

-- CreateTable
CREATE TABLE "project_wallet" (
    "project_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("project_id", "wallet_id"),
    CONSTRAINT "project_wallet_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_wallet_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wallet_network_data" (
    "wallet_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_detail" TEXT,
    "movements" TEXT NOT NULL DEFAULT '[]',
    "info" TEXT NOT NULL DEFAULT '{}',
    "fetched_at" DATETIME NOT NULL,

    PRIMARY KEY ("wallet_id", "network"),
    CONSTRAINT "wallet_network_data_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallet_network_data_network" CHECK ("network" IN ('bitcoin', 'ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'solana', 'cardano', 'polkadot', 'cosmos')),
    CONSTRAINT "wallet_network_data_status" CHECK ("status" IN ('ok', 'error')),
    CONSTRAINT "wallet_network_data_error" CHECK ("status" = 'ok' OR "error_code" IS NOT NULL),
    CONSTRAINT "wallet_network_data_movements_json" CHECK (json_valid("movements")),
    CONSTRAINT "wallet_network_data_info_json" CHECK (json_valid("info"))
);

-- CreateTable
CREATE TABLE "wallet_token_override" (
    "wallet_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "token_key" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("wallet_id", "network", "token_key"),
    CONSTRAINT "wallet_token_override_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallet_token_override_token_key" CHECK (length("token_key") BETWEEN 1 AND 200)
);

-- CreateTable
CREATE TABLE "wallet_manual_balance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "as_of" TEXT NOT NULL,
    "evidence_file_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wallet_manual_balance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallet_manual_balance_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wallet_manual_balance_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "project_file" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "wallet_manual_balance_network" CHECK ("network" IN ('bitcoin', 'ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'solana', 'cardano', 'polkadot', 'cosmos')),
    CONSTRAINT "wallet_manual_balance_asset_not_blank" CHECK (length(trim("asset")) > 0),
    CONSTRAINT "wallet_manual_balance_quantity_decimal" CHECK ("quantity" GLOB '[0-9]*' AND "quantity" NOT GLOB '*[^0-9.]*'),
    CONSTRAINT "wallet_manual_balance_as_of" CHECK ("as_of" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

-- CreateTable
CREATE TABLE "chain_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "helius_key" TEXT,
    "solana_rpc_url" TEXT NOT NULL DEFAULT '',
    "subscan_key" TEXT,
    "esplora_url" TEXT NOT NULL DEFAULT '',
    "koios_url" TEXT NOT NULL DEFAULT '',
    "cosmos_lcd_url" TEXT NOT NULL DEFAULT '',
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "chain_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chain_settings_helius_key_sealed" CHECK ("helius_key" IS NULL OR "helius_key" LIKE 'enc:v1:%'),
    CONSTRAINT "chain_settings_subscan_key_sealed" CHECK ("subscan_key" IS NULL OR "subscan_key" LIKE 'enc:v1:%')
);

-- CreateIndex
CREATE INDEX "wallet_owner_id_idx" ON "wallet"("owner_id");

-- CreateIndex
CREATE INDEX "project_wallet_wallet_id_idx" ON "project_wallet"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_manual_balance_project_id_wallet_id_idx" ON "wallet_manual_balance"("project_id", "wallet_id");

-- CreateIndex
CREATE INDEX "wallet_manual_balance_wallet_id_idx" ON "wallet_manual_balance"("wallet_id");

-- CreateIndex
CREATE INDEX "wallet_manual_balance_evidence_file_id_idx" ON "wallet_manual_balance"("evidence_file_id");

-- RedefineTables (project_file: origin CHECK widened to `wallet:_%`)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_project_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "importer_id" TEXT,
    "mapping_id" TEXT,
    "platform" TEXT,
    "period_from" TEXT,
    "period_to" TEXT,
    "booking_count" INTEGER NOT NULL DEFAULT 0,
    "holding_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "coverage" TEXT NOT NULL DEFAULT '[]',
    "origin" TEXT NOT NULL DEFAULT 'uploaded',
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_file_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_file_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_file_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "import_mapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "project_file_status" CHECK ("status" IN ('standard', 'mapped', 'needs_mapping', 'evidence_only')),
    CONSTRAINT "project_file_mapped_has_mapping" CHECK ("status" <> 'mapped' OR "mapping_id" IS NOT NULL),
    CONSTRAINT "project_file_origin" CHECK ("origin" = 'uploaded' OR "origin" LIKE 'from_project:_%' OR "origin" LIKE 'derived_from:_%' OR "origin" LIKE 'wallet:_%'),
    CONSTRAINT "project_file_counts" CHECK ("booking_count" >= 0 AND "holding_count" >= 0 AND "error_count" >= 0),
    CONSTRAINT "project_file_period" CHECK ("period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to"),
    CONSTRAINT "project_file_coverage_json" CHECK (json_valid("coverage")),
    CONSTRAINT "project_file_display_name_not_blank" CHECK (length(trim("display_name")) > 0)
);
INSERT INTO "new_project_file" ("id", "project_id", "file_id", "display_name", "status", "importer_id", "mapping_id", "platform", "period_from", "period_to", "booking_count", "holding_count", "error_count", "coverage", "origin", "added_at") SELECT "id", "project_id", "file_id", "display_name", "status", "importer_id", "mapping_id", "platform", "period_from", "period_to", "booking_count", "holding_count", "error_count", "coverage", "origin", "added_at" FROM "project_file";
DROP TABLE "project_file";
ALTER TABLE "new_project_file" RENAME TO "project_file";
CREATE INDEX "project_file_file_id_idx" ON "project_file"("file_id");
CREATE INDEX "project_file_mapping_id_idx" ON "project_file"("mapping_id");
CREATE UNIQUE INDEX "project_file_project_id_file_id_key" ON "project_file"("project_id", "file_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
