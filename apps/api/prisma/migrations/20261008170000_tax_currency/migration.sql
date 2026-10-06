-- Tax currency per project (F4.1a): every amount of a project is valued in its tax currency
-- (ISO 4217, default from the country: CH → CHF). Existing projects stay CHF.
--
-- project_rate and user_rate are redefined only to widen their `currency` CHECK from
-- ('CHF', 'USD') to any ISO 4217 code (3 upper-case letters) — prices and exchange rates in EUR,
-- GBP, … (SQLite cannot alter a CHECK). Every other column, constraint and index is copied
-- unchanged from 20261007120000_calculation_rates_exports (+ `note` from
-- 20261008100000_estv_kursliste) and 20261008110000_dashboard_carryover.
-- calculation.persistence.integration.spec.ts and persistence.integration.spec.ts test them.

-- AlterTable
ALTER TABLE "project" ADD COLUMN "tax_currency" TEXT NOT NULL DEFAULT 'CHF' CONSTRAINT "project_tax_currency" CHECK (length("tax_currency") = 3 AND "tax_currency" = upper("tax_currency") AND "tax_currency" NOT GLOB '*[^A-Z]*');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_project_rate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "project_rate_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_rate_kind" CHECK ("kind" IN ('price', 'fx')),
    CONSTRAINT "project_rate_currency" CHECK (length("currency") = 3 AND "currency" NOT GLOB '*[^A-Z]*'),
    CONSTRAINT "project_rate_source" CHECK ("source" IN ('manual', 'estv', 'binance', 'coingecko', 'ecb')),
    CONSTRAINT "project_rate_date" CHECK ("date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    CONSTRAINT "project_rate_asset_not_blank" CHECK (length(trim("asset")) > 0),
    CONSTRAINT "project_rate_value_decimal" CHECK ("value" <> '' AND "value" NOT GLOB '*[^0-9.-]*')
);
INSERT INTO "new_project_rate" ("id", "project_id", "kind", "asset", "currency", "date", "value", "source", "fetched_at", "note") SELECT "id", "project_id", "kind", "asset", "currency", "date", "value", "source", "fetched_at", "note" FROM "project_rate";
DROP TABLE "project_rate";
ALTER TABLE "new_project_rate" RENAME TO "project_rate";
CREATE UNIQUE INDEX "project_rate_project_id_kind_asset_currency_date_source_key" ON "project_rate"("project_id", "kind", "asset", "currency", "date", "source");
CREATE TABLE "new_user_rate" (
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
    CONSTRAINT "user_rate_currency" CHECK (length("currency") = 3 AND "currency" NOT GLOB '*[^A-Z]*'),
    CONSTRAINT "user_rate_source" CHECK ("source" IN ('binance', 'coingecko', 'ecb')),
    CONSTRAINT "user_rate_date" CHECK ("date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    CONSTRAINT "user_rate_asset_not_blank" CHECK (length(trim("asset")) > 0),
    CONSTRAINT "user_rate_value_decimal" CHECK ("value" <> '' AND "value" NOT GLOB '*[^0-9.-]*')
);
INSERT INTO "new_user_rate" ("id", "user_id", "kind", "asset", "currency", "date", "value", "source", "fetched_at") SELECT "id", "user_id", "kind", "asset", "currency", "date", "value", "source", "fetched_at" FROM "user_rate";
DROP TABLE "user_rate";
ALTER TABLE "new_user_rate" RENAME TO "user_rate";
CREATE UNIQUE INDEX "user_rate_user_id_kind_asset_currency_date_source_key" ON "user_rate"("user_id", "kind", "asset", "currency", "date", "source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
