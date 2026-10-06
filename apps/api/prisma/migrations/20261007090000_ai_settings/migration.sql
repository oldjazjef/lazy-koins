-- AI plugin (F5.13, F5.14): per-user settings in their own table, and project files the AI
-- converted from a PDF (origin `derived_from:<project file id>`).
--
-- The CHECK constraints are hand-added, as in the earlier migrations. project_file is redefined
-- only to widen its `origin` CHECK (SQLite cannot alter a CHECK); every other column, constraint
-- and index is copied unchanged from 20261006120000_files_and_mappings.
-- persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "ai_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'openai_compatible',
    "base_url" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "api_key_cipher" TEXT,
    "api_key_hint" TEXT,
    "consent_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "ai_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_settings_provider" CHECK ("provider" IN ('openai_compatible', 'anthropic')),
    CONSTRAINT "ai_settings_key_sealed" CHECK ("api_key_cipher" IS NULL OR "api_key_cipher" LIKE 'enc:v1:%'),
    CONSTRAINT "ai_settings_key_hint" CHECK ("api_key_hint" IS NULL OR length("api_key_hint") <= 8)
);

-- RedefineTables (project_file: origin CHECK widened)
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
    CONSTRAINT "project_file_origin" CHECK ("origin" = 'uploaded' OR "origin" LIKE 'from_project:_%' OR "origin" LIKE 'derived_from:_%'),
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
