-- Init migration for SQLite.
--
-- The CHECK constraints at the end of each CREATE TABLE are hand-added: Prisma cannot express them,
-- and SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, so they must live inside the table definition.
-- Prisma is blind to them (`migrate diff --from-migrations --to-schema` still reports no
-- difference). CAUTION: when a later schema change makes Prisma *redefine* a table (SQLite's
-- copy-and-rename for most column changes), the generated migration recreates the table WITHOUT
-- these CHECKs — copy them into that migration's new CREATE TABLE by hand. The integration suite
-- tests them and fails if they go missing.

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identity_uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "sign_in_provider" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_identity_uid_not_blank" CHECK (length("identity_uid") > 0)
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'CH',
    "canton" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_status" CHECK ("status" IN ('in_progress', 'reviewed', 'closed')),
    CONSTRAINT "project_country" CHECK ("country" IN ('CH')),
    CONSTRAINT "project_canton_code" CHECK (length("canton") = 2 AND "canton" = upper("canton")),
    CONSTRAINT "project_tax_year" CHECK ("tax_year" BETWEEN 2009 AND 2100),
    CONSTRAINT "project_name_not_blank" CHECK (length(trim("name")) > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identity_uid_key" ON "user"("identity_uid");

-- CreateIndex
CREATE INDEX "project_owner_id_tax_year_idx" ON "project"("owner_id", "tax_year");
