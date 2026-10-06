-- Dashboard rate cache (F11.4) and carry-over between projects (F4.4, F4.4a, F10.8). As in the
-- earlier migrations, the CHECK constraints at the end of each CREATE TABLE are hand-added;
-- carryover.persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "user_rate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_rate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_rate_kind" CHECK ("kind" IN ('price', 'fx')),
    CONSTRAINT "user_rate_currency" CHECK ("currency" IN ('CHF', 'USD')),
    CONSTRAINT "user_rate_source" CHECK ("source" IN ('binance', 'coingecko', 'ecb')),
    CONSTRAINT "user_rate_date" CHECK ("date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    CONSTRAINT "user_rate_asset_not_blank" CHECK (length(trim("asset")) > 0),
    CONSTRAINT "user_rate_value_decimal" CHECK ("value" <> '' AND "value" NOT GLOB '*[^0-9.-]*')
);

-- CreateTable
CREATE TABLE "project_carryover" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "source_project_id" TEXT,
    "source_project_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_carryover_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_carryover_kind" CHECK ("kind" IN ('project', 'file', 'correction', 'open_item', 'notes')),
    CONSTRAINT "project_carryover_data_json" CHECK (json_valid("data"))
);

-- CreateIndex
CREATE UNIQUE INDEX "user_rate_user_id_kind_asset_currency_date_source_key" ON "user_rate"("user_id", "kind", "asset", "currency", "date", "source");

-- CreateIndex
CREATE INDEX "project_carryover_project_id_idx" ON "project_carryover"("project_id");
