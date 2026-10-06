-- Internal check report (F10.2a): two more export kinds. SQLite cannot alter a CHECK, so the
-- table is redefined the way Prisma does it; every other CHECK is copied unchanged.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_project_export" (
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
    CONSTRAINT "project_export_kind" CHECK ("kind" IN ('simple_pdf', 'simple_xlsx', 'detailed_pdf', 'detailed_xlsx', 'internal_report_pdf', 'internal_report_xlsx')),
    CONSTRAINT "project_export_size" CHECK ("size" > 0 AND "size" = length("bytes"))
);
INSERT INTO "new_project_export" ("id", "project_id", "kind", "file_name", "media_type", "bytes", "size", "snapshot_id", "wealth_chf", "income_chf", "created_at") SELECT "id", "project_id", "kind", "file_name", "media_type", "bytes", "size", "snapshot_id", "wealth_chf", "income_chf", "created_at" FROM "project_export";
DROP TABLE "project_export";
ALTER TABLE "new_project_export" RENAME TO "project_export";
CREATE INDEX "project_export_project_id_created_at_idx" ON "project_export"("project_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
