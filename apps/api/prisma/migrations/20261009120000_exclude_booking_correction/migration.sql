-- Transaktionen: a booking can be left out of the calculation with a reason — the correction type
-- `exclude_booking` (`{ type, bookingId }`, undoable like every correction; the file stays as is).
--
-- correction is redefined only to widen its `type` CHECK — SQLite cannot alter a CHECK. Every
-- other column, constraint and index is copied unchanged from
-- 20261007120000_calculation_rates_exports. calculation.persistence.integration.spec.ts tests them.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" DATETIME,
    CONSTRAINT "correction_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "correction_type" CHECK ("type" IN ('price_override', 'reclassify', 'manual_booking', 'manual_holding', 'exclude_booking')),
    CONSTRAINT "correction_data_json" CHECK (json_valid("data")),
    CONSTRAINT "correction_reason_not_blank" CHECK (length(trim("reason")) > 0)
);
INSERT INTO "new_correction" ("id", "project_id", "type", "data", "reason", "created_at", "undone_at") SELECT "id", "project_id", "type", "data", "reason", "created_at", "undone_at" FROM "correction";
DROP TABLE "correction";
ALTER TABLE "new_correction" RENAME TO "correction";
CREATE INDEX "correction_project_id_created_at_idx" ON "correction"("project_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
