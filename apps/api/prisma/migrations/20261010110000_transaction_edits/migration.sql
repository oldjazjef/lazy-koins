-- F9.8–F9.11: global transaction edits. A change hangs on the transaction (its stable key, libs/engine
-- `transactionKeys`), not on a project, and applies in every project that reads it (decided
-- 08.10.2026: one truth per transaction). New tables only, plus the F9.11 data migration:
--
-- Every project correction `reclassify` / `exclude_booking` becomes a global edit (changes `{kind}` /
-- `{hidden: true}`, same id, reason and time, source `migrated`, origin = "<project> <year>"). When
-- the projects of one owner disagree about a transaction, the newest project's corrections win
-- (tax year, then project creation); the others are kept as `superseded` so the history shows them.
-- Undone corrections come over as `undone`. Then the migrated corrections are removed from the
-- projects. Price overrides and manual bookings/holdings stay project corrections (F9.1, F9.3).

-- CreateTable
CREATE TABLE "transaction_edit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "tx_key" TEXT NOT NULL,
    "changes" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "origin" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" DATETIME,
    CONSTRAINT "transaction_edit_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transaction_edit_key" CHECK (length("tx_key") BETWEEN 1 AND 300),
    CONSTRAINT "transaction_edit_changes_json" CHECK (json_valid("changes") AND json_type("changes") = 'object'),
    CONSTRAINT "transaction_edit_reason" CHECK (length(trim("reason")) > 0 AND length("reason") <= 1000),
    CONSTRAINT "transaction_edit_source" CHECK ("source" IN ('user', 'ai', 'migrated')),
    CONSTRAINT "transaction_edit_status" CHECK ("status" IN ('active', 'undone', 'superseded')),
    CONSTRAINT "transaction_edit_decided" CHECK ("status" = 'active' OR "decided_at" IS NOT NULL),
    CONSTRAINT "transaction_edit_origin" CHECK ("origin" IS NULL OR length("origin") <= 200)
);

-- CreateTable
CREATE TABLE "transaction_suggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "tx_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "linked_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transaction_suggestion_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transaction_suggestion_key" CHECK (length("tx_key") BETWEEN 1 AND 300),
    CONSTRAINT "transaction_suggestion_kind" CHECK ("kind" IN ('trade', 'deposit', 'withdrawal', 'fee', 'transfer', 'income_interest', 'income_staking', 'income_airdrop', 'income_launchpool', 'income_hardfork', 'loss', 'spam', 'unknown')),
    CONSTRAINT "transaction_suggestion_reason" CHECK (length(trim("reason")) > 0 AND length("reason") <= 1000),
    CONSTRAINT "transaction_suggestion_confidence" CHECK ("confidence" BETWEEN 0 AND 100),
    CONSTRAINT "transaction_suggestion_linked" CHECK ("linked_key" IS NULL OR length("linked_key") BETWEEN 1 AND 300),
    CONSTRAINT "transaction_suggestion_status" CHECK ("status" IN ('open', 'accepted', 'dismissed'))
);

-- CreateIndex
CREATE INDEX "transaction_edit_owner_id_tx_key_idx" ON "transaction_edit"("owner_id", "tx_key");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_suggestion_owner_id_tx_key_key" ON "transaction_suggestion"("owner_id", "tx_key");

-- F9.11: project corrections → global edits.
CREATE TEMP TABLE "lk_migrated" AS
SELECT
    c."id" AS "id",
    p."owner_id" AS "owner_id",
    json_extract(c."data", '$.bookingId') AS "tx_key",
    CASE c."type"
        WHEN 'reclassify' THEN json_object('kind', json_extract(c."data", '$.kind'))
        ELSE json_object('hidden', json('true'))
    END AS "changes",
    substr(c."reason", 1, 1000) AS "reason",
    substr(p."name", 1, 180) || ' ' || p."tax_year" AS "origin",
    c."created_at" AS "created_at",
    c."undone_at" AS "undone_at",
    p."tax_year" AS "tax_year",
    p."created_at" AS "project_created_at",
    p."id" AS "project_id"
FROM "correction" c
JOIN "project" p ON p."id" = c."project_id"
WHERE c."type" IN ('reclassify', 'exclude_booking')
  AND length(coalesce(json_extract(c."data", '$.bookingId'), '')) BETWEEN 1 AND 300;

-- The winning project per transaction: the newest one with an active correction for it.
CREATE TEMP TABLE "lk_winner" AS
SELECT "owner_id", "tx_key", (
    SELECT m2."project_id" FROM "lk_migrated" m2
    WHERE m2."owner_id" = m."owner_id" AND m2."tx_key" = m."tx_key" AND m2."undone_at" IS NULL
    ORDER BY m2."tax_year" DESC, m2."project_created_at" DESC, m2."project_id" DESC
    LIMIT 1
) AS "project_id"
FROM "lk_migrated" m
GROUP BY "owner_id", "tx_key";

INSERT INTO "transaction_edit" ("id", "owner_id", "tx_key", "changes", "reason", "source", "status", "origin", "created_at", "decided_at")
SELECT
    m."id", m."owner_id", m."tx_key", m."changes", m."reason", 'migrated',
    CASE
        WHEN m."undone_at" IS NOT NULL THEN 'undone'
        WHEN m."project_id" = w."project_id" THEN 'active'
        ELSE 'superseded'
    END,
    m."origin", m."created_at",
    CASE
        WHEN m."undone_at" IS NOT NULL THEN m."undone_at"
        WHEN m."project_id" = w."project_id" THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%S.000+00:00', 'now')
    END
FROM "lk_migrated" m
JOIN "lk_winner" w ON w."owner_id" = m."owner_id" AND w."tx_key" = m."tx_key";

DELETE FROM "correction" WHERE "id" IN (SELECT "id" FROM "lk_migrated");

DROP TABLE "lk_winner";
DROP TABLE "lk_migrated";
