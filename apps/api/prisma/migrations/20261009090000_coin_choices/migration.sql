-- The coin a user chose per ticker (F7.4, bug "OPN priced as another coin"): provider-aware
-- instead of CoinGecko-only. `user_settings.coingecko_ids` (JSON symbol → CoinGecko id) becomes
-- `coin_choices` (JSON symbol → { "provider", "id", "name", "symbol" }); every stored id is carried
-- over as a CoinGecko choice without a name (`parseCoinChoices` reads both shapes anyway).
-- `coin_dismissed` = the tickers whose shared-code warning the user settled ("Passt so").
--
-- user_settings is redefined (SQLite cannot drop a column a CHECK refers to): every other column
-- and constraint is copied unchanged from 20261008190000_user_locale; the JSON CHECK now also
-- requires an object. New table coin_market: the provider's top coins by market cap,
-- deployment-wide. calculation.persistence.integration.spec.ts tests the CHECKs.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL DEFAULT '',
    "canton" TEXT NOT NULL DEFAULT '',
    "advisor_name" TEXT NOT NULL DEFAULT '',
    "advisor_email" TEXT NOT NULL DEFAULT '',
    "locale" TEXT,
    "number_format" TEXT NOT NULL DEFAULT 'de-CH',
    "date_format" TEXT NOT NULL DEFAULT 'dd.MM.yyyy',
    "online_rates" BOOLEAN NOT NULL DEFAULT true,
    "coingecko_key" TEXT,
    "etherscan_key" TEXT,
    "coin_choices" TEXT NOT NULL DEFAULT '{}',
    "coin_dismissed" TEXT NOT NULL DEFAULT '[]',
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_settings_locale" CHECK ("locale" IS NULL OR "locale" IN ('de-CH', 'en')),
    CONSTRAINT "user_settings_number_format" CHECK ("number_format" IN ('de-CH', 'en')),
    CONSTRAINT "user_settings_date_format" CHECK ("date_format" IN ('dd.MM.yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy')),
    CONSTRAINT "user_settings_canton" CHECK ("canton" = '' OR ("canton" GLOB '[A-Z][A-Z]')),
    CONSTRAINT "user_settings_coin_choices_json" CHECK (json_valid("coin_choices") AND json_type("coin_choices") = 'object'),
    CONSTRAINT "user_settings_coin_dismissed_json" CHECK (json_valid("coin_dismissed") AND json_type("coin_dismissed") = 'array'),
    CONSTRAINT "user_settings_keys_sealed" CHECK (("coingecko_key" IS NULL OR "coingecko_key" LIKE 'enc:v1:%') AND ("etherscan_key" IS NULL OR "etherscan_key" LIKE 'enc:v1:%'))
);
INSERT INTO "new_user_settings" ("user_id", "display_name", "canton", "advisor_name", "advisor_email", "locale", "number_format", "date_format", "online_rates", "coingecko_key", "etherscan_key", "coin_choices", "updated_at")
SELECT "user_id", "display_name", "canton", "advisor_name", "advisor_email", "locale", "number_format", "date_format", "online_rates", "coingecko_key", "etherscan_key",
    COALESCE(
        (SELECT json_group_object(upper("key"), json_object('provider', 'coingecko', 'id', "value", 'name', NULL, 'symbol', NULL))
           FROM json_each(CASE WHEN json_type("coingecko_ids") = 'object' THEN "coingecko_ids" ELSE '{}' END)
          WHERE "type" = 'text'),
        '{}'),
    "updated_at"
FROM "user_settings";
DROP TABLE "user_settings";
ALTER TABLE "new_user_settings" RENAME TO "user_settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "coin_market" (
    "provider" TEXT NOT NULL,
    "coin_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market_cap_rank" INTEGER NOT NULL,
    "price_usd" TEXT,
    "fetched_at" DATETIME NOT NULL,

    PRIMARY KEY ("provider", "coin_id"),
    CONSTRAINT "coin_market_provider" CHECK ("provider" IN ('coingecko')),
    CONSTRAINT "coin_market_symbol" CHECK (length("symbol") BETWEEN 1 AND 40 AND "symbol" = upper("symbol")),
    CONSTRAINT "coin_market_name" CHECK (length("name") BETWEEN 1 AND 200),
    CONSTRAINT "coin_market_rank" CHECK ("market_cap_rank" >= 1),
    CONSTRAINT "coin_market_price" CHECK ("price_usd" IS NULL OR "price_usd" GLOB '[0-9]*')
);

-- CreateIndex
CREATE INDEX "coin_market_provider_symbol_idx" ON "coin_market"("provider", "symbol");
