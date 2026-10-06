-- Calculation (F7), rates (F7.4), corrections (F9), open items (F8.2), exports (F10) and user
-- settings (F11). As in the earlier migrations, the CHECK constraints at the end of each CREATE
-- TABLE are hand-added; copy them along if a later change makes Prisma redefine one of these
-- tables. calculation.persistence.integration.spec.ts tests them.


-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL DEFAULT '',
    "canton" TEXT NOT NULL DEFAULT '',
    "advisor_name" TEXT NOT NULL DEFAULT '',
    "advisor_email" TEXT NOT NULL DEFAULT '',
    "number_format" TEXT NOT NULL DEFAULT 'de-CH',
    "date_format" TEXT NOT NULL DEFAULT 'dd.MM.yyyy',
    "online_rates" BOOLEAN NOT NULL DEFAULT true,
    "coingecko_key" TEXT,
    "etherscan_key" TEXT,
    "coingecko_ids" TEXT NOT NULL DEFAULT '{}',
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_settings_number_format" CHECK ("number_format" IN ('de-CH')),
    CONSTRAINT "user_settings_date_format" CHECK ("date_format" IN ('dd.MM.yyyy')),
    CONSTRAINT "user_settings_canton" CHECK ("canton" = '' OR ("canton" GLOB '[A-Z][A-Z]')),
    CONSTRAINT "user_settings_coingecko_ids_json" CHECK (json_valid("coingecko_ids")),
    CONSTRAINT "user_settings_keys_sealed" CHECK (("coingecko_key" IS NULL OR "coingecko_key" LIKE 'enc:v1:%') AND ("etherscan_key" IS NULL OR "etherscan_key" LIKE 'enc:v1:%'))
);

-- CreateTable
CREATE TABLE "project_rate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_rate_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_rate_kind" CHECK ("kind" IN ('price', 'fx')),
    CONSTRAINT "project_rate_currency" CHECK ("currency" IN ('CHF', 'USD')),
    CONSTRAINT "project_rate_source" CHECK ("source" IN ('manual', 'estv', 'binance', 'coingecko', 'ecb')),
    CONSTRAINT "project_rate_date" CHECK ("date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    CONSTRAINT "project_rate_asset_not_blank" CHECK (length(trim("asset")) > 0),
    CONSTRAINT "project_rate_value_decimal" CHECK ("value" <> '' AND "value" NOT GLOB '*[^0-9.-]*')
);

-- CreateTable
CREATE TABLE "calculation_snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "engine_version" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "records" TEXT NOT NULL,
    "wealth_chf" TEXT NOT NULL,
    "income_chf" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calculation_snapshot_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calculation_snapshot_result_json" CHECK (json_valid("result") AND json_valid("records")),
    CONSTRAINT "calculation_snapshot_input_hash" CHECK (length("input_hash") = 64)
);

-- CreateTable
CREATE TABLE "correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" DATETIME,
    CONSTRAINT "correction_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "correction_type" CHECK ("type" IN ('price_override', 'reclassify', 'manual_booking', 'manual_holding')),
    CONSTRAINT "correction_data_json" CHECK (json_valid("data")),
    CONSTRAINT "correction_reason_not_blank" CHECK (length(trim("reason")) > 0)
);

-- CreateTable
CREATE TABLE "open_item_state" (
    "project_id" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("project_id", "item_key"),
    CONSTRAINT "open_item_state_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "open_item_state_key_not_blank" CHECK (length("item_key") > 0)
);

-- CreateTable
CREATE TABLE "project_export" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "size" INTEGER NOT NULL,
    "snapshot_id" TEXT,
    "wealth_chf" TEXT NOT NULL,
    "income_chf" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_export_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_export_kind" CHECK ("kind" IN ('simple_pdf', 'simple_xlsx', 'detailed_pdf', 'detailed_xlsx')),
    CONSTRAINT "project_export_size" CHECK ("size" > 0 AND "size" = length("bytes"))
);

-- CreateIndex
CREATE UNIQUE INDEX "project_rate_project_id_kind_asset_currency_date_source_key" ON "project_rate"("project_id", "kind", "asset", "currency", "date", "source");

-- CreateIndex
CREATE INDEX "calculation_snapshot_project_id_created_at_idx" ON "calculation_snapshot"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "correction_project_id_created_at_idx" ON "correction"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_export_project_id_created_at_idx" ON "project_export"("project_id", "created_at");

