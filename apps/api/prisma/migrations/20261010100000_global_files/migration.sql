-- F5.21–F5.24 (Wunsch 08.10.2026): files are global per user, projects select them.
--
-- How a file is read (status, mapping, platform, period, counts, coverage) moves from
-- `project_file` to `stored_file`: one reading per file, used by every project that selects it.
-- `project_file` keeps only the selection (display name, origin in the project, added, F5.7a
-- deactivation). Stored files are no longer deleted with their last project (F5.23).
--
-- F5.24 — no result changes: the reading of the NEWEST project (tax year, then added, then id)
-- becomes the file's; every project keeps its selection and deactivation. When the projects read
-- the same file differently, the owner gets one notification per file (`files.readingConflict`).
--
-- Both tables are redefined (SQLite cannot drop or move columns); every CHECK and index is copied
-- from the earlier migrations, the origin CHECK of project_file gains `selected`, and
-- stored_file gets the analysis CHECKs that project_file had.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- One notification per file whose projects disagree (before the readings are merged).
INSERT INTO "notification" ("id", "user_id", "project_id", "kind", "topic", "title_key", "params", "action", "created_at", "occurred_at")
SELECT
  lower(hex(randomblob(16))),
  "sf"."owner_id",
  NULL,
  'info',
  'files.readingConflict:' || "sf"."id",
  'notifications.title.files.readingConflict',
  json_object('name', "sf"."original_name"),
  json_object('labelKey', 'notifications.action.toGlobalFiles', 'route', '/app/files'),
  strftime('%Y-%m-%dT%H:%M:%S.000+00:00', 'now'),
  strftime('%Y-%m-%dT%H:%M:%S.000+00:00', 'now')
FROM "stored_file" AS "sf"
WHERE (
  SELECT COUNT(DISTINCT "pf"."status" || ':' || coalesce("pf"."mapping_id", ''))
  FROM "project_file" AS "pf"
  WHERE "pf"."file_id" = "sf"."id"
) > 1;

CREATE TABLE "new_stored_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "size" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'needs_mapping',
    "importer_id" TEXT,
    "mapping_id" TEXT,
    "platform" TEXT,
    "period_from" TEXT,
    "period_to" TEXT,
    "booking_count" INTEGER NOT NULL DEFAULT 0,
    "holding_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "coverage" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'uploaded',
    CONSTRAINT "stored_file_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stored_file_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "import_mapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "stored_file_sha256_hex" CHECK (length("sha256") = 64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
    CONSTRAINT "stored_file_kind" CHECK ("kind" IN ('csv', 'xlsx', 'pdf')),
    CONSTRAINT "stored_file_size" CHECK ("size" > 0 AND "size" = length("bytes")),
    CONSTRAINT "stored_file_original_name_not_blank" CHECK (length(trim("original_name")) > 0),
    CONSTRAINT "stored_file_status" CHECK ("status" IN ('standard', 'mapped', 'needs_mapping', 'evidence_only')),
    CONSTRAINT "stored_file_mapped_has_mapping" CHECK ("status" <> 'mapped' OR "mapping_id" IS NOT NULL),
    CONSTRAINT "stored_file_counts" CHECK ("booking_count" >= 0 AND "holding_count" >= 0 AND "error_count" >= 0),
    CONSTRAINT "stored_file_period" CHECK ("period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to"),
    CONSTRAINT "stored_file_coverage_json" CHECK (json_valid("coverage")),
    CONSTRAINT "stored_file_source" CHECK ("source" = 'uploaded' OR "source" LIKE 'derived_from:_%' OR "source" LIKE 'wallet:_%')
);

INSERT INTO "new_stored_file" (
  "id", "owner_id", "sha256", "bytes", "size", "media_type", "kind", "original_name", "created_at",
  "status", "importer_id", "mapping_id", "platform", "period_from", "period_to",
  "booking_count", "holding_count", "error_count", "coverage", "source"
)
SELECT
  "sf"."id", "sf"."owner_id", "sf"."sha256", "sf"."bytes", "sf"."size", "sf"."media_type", "sf"."kind",
  "sf"."original_name", "sf"."created_at",
  coalesce("pf"."status", 'needs_mapping'), "pf"."importer_id", "pf"."mapping_id", "pf"."platform",
  "pf"."period_from", "pf"."period_to",
  coalesce("pf"."booking_count", 0), coalesce("pf"."holding_count", 0), coalesce("pf"."error_count", 0),
  coalesce("pf"."coverage", '[]'),
  coalesce(
    (SELECT "w"."origin" FROM "project_file" AS "w"
      WHERE "w"."file_id" = "sf"."id" AND "w"."origin" LIKE 'wallet:_%'
      ORDER BY "w"."added_at", "w"."id" LIMIT 1),
    (SELECT 'derived_from:' || "src"."file_id" FROM "project_file" AS "d"
      JOIN "project_file" AS "src" ON "src"."id" = substr("d"."origin", length('derived_from:') + 1)
      WHERE "d"."file_id" = "sf"."id" AND "d"."origin" LIKE 'derived_from:_%'
      ORDER BY "d"."added_at", "d"."id" LIMIT 1),
    'uploaded'
  )
FROM "stored_file" AS "sf"
LEFT JOIN "project_file" AS "pf" ON "pf"."id" = (
  SELECT "x"."id" FROM "project_file" AS "x"
  JOIN "project" AS "p" ON "p"."id" = "x"."project_id"
  WHERE "x"."file_id" = "sf"."id"
  ORDER BY "p"."tax_year" DESC, "x"."added_at" DESC, "x"."id" DESC
  LIMIT 1
);

CREATE TABLE "new_project_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'uploaded',
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" DATETIME,
    "disabled_note" TEXT,
    CONSTRAINT "project_file_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_file_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_file_origin" CHECK ("origin" = 'uploaded' OR "origin" = 'selected' OR "origin" LIKE 'from_project:_%' OR "origin" LIKE 'derived_from:_%' OR "origin" LIKE 'wallet:_%'),
    CONSTRAINT "project_file_display_name_not_blank" CHECK (length(trim("display_name")) > 0),
    CONSTRAINT "project_file_disabled_note" CHECK ("disabled_note" IS NULL OR ("disabled_at" IS NOT NULL AND length("disabled_note") <= 500))
);

INSERT INTO "new_project_file" ("id", "project_id", "file_id", "display_name", "origin", "added_at", "disabled_at", "disabled_note")
SELECT "id", "project_id", "file_id", "display_name", "origin", "added_at", "disabled_at", "disabled_note"
FROM "project_file";

DROP TABLE "project_file";
DROP TABLE "stored_file";
ALTER TABLE "new_stored_file" RENAME TO "stored_file";
ALTER TABLE "new_project_file" RENAME TO "project_file";

CREATE UNIQUE INDEX "stored_file_owner_id_sha256_key" ON "stored_file"("owner_id", "sha256");
CREATE INDEX "stored_file_mapping_id_idx" ON "stored_file"("mapping_id");
CREATE INDEX "project_file_file_id_idx" ON "project_file"("file_id");
CREATE UNIQUE INDEX "project_file_project_id_file_id_key" ON "project_file"("project_id", "file_id");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
