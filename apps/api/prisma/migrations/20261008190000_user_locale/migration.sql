-- Language per user (F11.2): German (Switzerland) and English. `user_settings.locale` is the
-- language of the app and the exports — NULL = not chosen yet (the app takes the browser language,
-- the exports German). The number and date format get their English variants.
--
-- user_settings and mail_template are redefined only to widen their CHECKs (SQLite cannot alter
-- a CHECK): number_format 'de-CH' | 'en', date_format 'dd.MM.yyyy' | 'yyyy-MM-dd' | 'dd/MM/yyyy'
-- | 'MM/dd/yyyy', mail_template.language 'de-CH' | 'en', plus the new locale CHECK. Every other
-- column and constraint is copied unchanged from 20261007120000_calculation_rates_exports and
-- 20261008130000_mail. calculation.persistence.integration.spec.ts and
-- mail.persistence.integration.spec.ts test them.

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
    "coingecko_ids" TEXT NOT NULL DEFAULT '{}',
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_settings_locale" CHECK ("locale" IS NULL OR "locale" IN ('de-CH', 'en')),
    CONSTRAINT "user_settings_number_format" CHECK ("number_format" IN ('de-CH', 'en')),
    CONSTRAINT "user_settings_date_format" CHECK ("date_format" IN ('dd.MM.yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy')),
    CONSTRAINT "user_settings_canton" CHECK ("canton" = '' OR ("canton" GLOB '[A-Z][A-Z]')),
    CONSTRAINT "user_settings_coingecko_ids_json" CHECK (json_valid("coingecko_ids")),
    CONSTRAINT "user_settings_keys_sealed" CHECK (("coingecko_key" IS NULL OR "coingecko_key" LIKE 'enc:v1:%') AND ("etherscan_key" IS NULL OR "etherscan_key" LIKE 'enc:v1:%'))
);
INSERT INTO "new_user_settings" ("user_id", "display_name", "canton", "advisor_name", "advisor_email", "number_format", "date_format", "online_rates", "coingecko_key", "etherscan_key", "coingecko_ids", "updated_at") SELECT "user_id", "display_name", "canton", "advisor_name", "advisor_email", "number_format", "date_format", "online_rates", "coingecko_key", "etherscan_key", "coingecko_ids", "updated_at" FROM "user_settings";
DROP TABLE "user_settings";
ALTER TABLE "new_user_settings" RENAME TO "user_settings";
CREATE TABLE "new_mail_template" (
    "user_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "language"),
    CONSTRAINT "mail_template_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_template_language" CHECK ("language" IN ('de-CH', 'en')),
    CONSTRAINT "mail_template_subject" CHECK (length("subject") BETWEEN 1 AND 300),
    CONSTRAINT "mail_template_body" CHECK (length("body") BETWEEN 1 AND 20000)
);
INSERT INTO "new_mail_template" ("user_id", "language", "subject", "body", "updated_at") SELECT "user_id", "language", "subject", "body", "updated_at" FROM "mail_template";
DROP TABLE "mail_template";
ALTER TABLE "new_mail_template" RENAME TO "mail_template";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
