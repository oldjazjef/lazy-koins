-- Files (F5) and mapping specs: stored_file (original bytes, content-addressed per owner),
-- import_mapping (declarative mapping specs) and project_file (a stored file in one project).
--
-- As in the init migration, the CHECK constraints at the end of each CREATE TABLE are hand-added
-- (Prisma cannot express them; SQLite cannot add them later). If a later change makes Prisma
-- redefine one of these tables, copy them into that migration's new CREATE TABLE.
-- persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "stored_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "size" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stored_file_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stored_file_sha256_hex" CHECK (length("sha256") = 64 AND "sha256" NOT GLOB '*[^0-9a-f]*'),
    CONSTRAINT "stored_file_kind" CHECK ("kind" IN ('csv', 'xlsx', 'pdf')),
    CONSTRAINT "stored_file_size" CHECK ("size" > 0 AND "size" = length("bytes")),
    CONSTRAINT "stored_file_original_name_not_blank" CHECK (length(trim("original_name")) > 0)
);

-- CreateTable
CREATE TABLE "import_mapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "import_mapping_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "import_mapping_origin" CHECK ("origin" IN ('ai', 'manual', 'copied')),
    CONSTRAINT "import_mapping_version" CHECK ("version" >= 1),
    CONSTRAINT "import_mapping_name_not_blank" CHECK (length(trim("name")) > 0),
    CONSTRAINT "import_mapping_platform_not_blank" CHECK (length(trim("platform")) > 0),
    CONSTRAINT "import_mapping_spec_json" CHECK (json_valid("spec"))
);

-- CreateTable
CREATE TABLE "project_file" (
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
    CONSTRAINT "project_file_origin" CHECK ("origin" = 'uploaded' OR "origin" LIKE 'from_project:_%'),
    CONSTRAINT "project_file_counts" CHECK ("booking_count" >= 0 AND "holding_count" >= 0 AND "error_count" >= 0),
    CONSTRAINT "project_file_period" CHECK ("period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to"),
    CONSTRAINT "project_file_coverage_json" CHECK (json_valid("coverage")),
    CONSTRAINT "project_file_display_name_not_blank" CHECK (length(trim("display_name")) > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_owner_id_sha256_key" ON "stored_file"("owner_id", "sha256");

-- CreateIndex
CREATE INDEX "import_mapping_owner_id_idx" ON "import_mapping"("owner_id");

-- CreateIndex
CREATE INDEX "project_file_file_id_idx" ON "project_file"("file_id");

-- CreateIndex
CREATE INDEX "project_file_mapping_id_idx" ON "project_file"("mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_file_project_id_file_id_key" ON "project_file"("project_id", "file_id");
