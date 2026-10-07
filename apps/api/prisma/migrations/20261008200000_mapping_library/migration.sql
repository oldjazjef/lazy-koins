-- F5.15–F5.17: the global mapping library (web only). New tables library_mapping (published
-- specs, soft delete) and library_rating (1–5 stars per user and entry); the aggregate
-- (rating_count, rating_sum) is maintained by triggers in the same transaction as the rating
-- change — also when a rating goes with its user (cascade).
--
-- import_mapping is redefined only to widen its origin CHECK to `library` and to add the
-- reference of a copy (library_id + library_version, no FK: the copy stays when the entry goes);
-- every other column, constraint and index is copied unchanged from
-- 20261006120000_files_and_mappings. CHECKs are hand-written (see CLAUDE.md, Database);
-- library.persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "library_mapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT,
    "source_mapping_id" TEXT,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "description" TEXT,
    "spec" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "library_mapping_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_mapping_name_not_blank" CHECK (length(trim("name")) > 0 AND length("name") <= 120),
    CONSTRAINT "library_mapping_platform_not_blank" CHECK (length(trim("platform")) > 0 AND length("platform") <= 40),
    CONSTRAINT "library_mapping_author_name" CHECK ("author_name" IS NULL OR (length(trim("author_name")) > 0 AND length("author_name") <= 40)),
    CONSTRAINT "library_mapping_description" CHECK ("description" IS NULL OR length("description") <= 1000),
    CONSTRAINT "library_mapping_spec_json" CHECK (json_valid("spec") AND json_type("spec") = 'object' AND length("spec") <= 65536),
    CONSTRAINT "library_mapping_fingerprint" CHECK (length("fingerprint") > 0),
    CONSTRAINT "library_mapping_version" CHECK ("version" >= 1),
    CONSTRAINT "library_mapping_rating" CHECK ("rating_count" >= 0 AND "rating_sum" >= "rating_count" AND "rating_sum" <= 5 * "rating_count"),
    CONSTRAINT "library_mapping_usage" CHECK ("usage_count" >= 0)
);

-- CreateTable
CREATE TABLE "library_rating" (
    "library_mapping_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("library_mapping_id", "user_id"),
    CONSTRAINT "library_rating_library_mapping_id_fkey" FOREIGN KEY ("library_mapping_id") REFERENCES "library_mapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_rating_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_rating_stars" CHECK ("stars" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE INDEX "library_mapping_fingerprint_idx" ON "library_mapping"("fingerprint");

-- CreateIndex
CREATE INDEX "library_mapping_author_id_published_at_idx" ON "library_mapping"("author_id", "published_at");

-- CreateIndex
CREATE INDEX "library_rating_user_id_idx" ON "library_rating"("user_id");

-- The rating aggregate, recomputed from the rows in the same statement's transaction.
CREATE TRIGGER "library_rating_after_insert" AFTER INSERT ON "library_rating" BEGIN
    UPDATE "library_mapping"
    SET "rating_count" = (SELECT count(*) FROM "library_rating" WHERE "library_mapping_id" = NEW."library_mapping_id"),
        "rating_sum" = (SELECT coalesce(sum("stars"), 0) FROM "library_rating" WHERE "library_mapping_id" = NEW."library_mapping_id")
    WHERE "id" = NEW."library_mapping_id";
END;

CREATE TRIGGER "library_rating_after_update" AFTER UPDATE ON "library_rating" BEGIN
    UPDATE "library_mapping"
    SET "rating_count" = (SELECT count(*) FROM "library_rating" WHERE "library_mapping_id" = NEW."library_mapping_id"),
        "rating_sum" = (SELECT coalesce(sum("stars"), 0) FROM "library_rating" WHERE "library_mapping_id" = NEW."library_mapping_id")
    WHERE "id" = NEW."library_mapping_id";
END;

CREATE TRIGGER "library_rating_after_delete" AFTER DELETE ON "library_rating" BEGIN
    UPDATE "library_mapping"
    SET "rating_count" = (SELECT count(*) FROM "library_rating" WHERE "library_mapping_id" = OLD."library_mapping_id"),
        "rating_sum" = (SELECT coalesce(sum("stars"), 0) FROM "library_rating" WHERE "library_mapping_id" = OLD."library_mapping_id")
    WHERE "id" = OLD."library_mapping_id";
END;

-- RedefineTables (import_mapping: origin CHECK widened, library reference added)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_import_mapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "library_id" TEXT,
    "library_version" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "import_mapping_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "import_mapping_origin" CHECK ("origin" IN ('ai', 'manual', 'copied', 'library')),
    CONSTRAINT "import_mapping_version" CHECK ("version" >= 1),
    CONSTRAINT "import_mapping_name_not_blank" CHECK (length(trim("name")) > 0),
    CONSTRAINT "import_mapping_platform_not_blank" CHECK (length(trim("platform")) > 0),
    CONSTRAINT "import_mapping_spec_json" CHECK (json_valid("spec")),
    CONSTRAINT "import_mapping_library_ref" CHECK (("origin" = 'library') = ("library_id" IS NOT NULL) AND ("library_id" IS NULL) = ("library_version" IS NULL) AND ("library_version" IS NULL OR "library_version" >= 1))
);
INSERT INTO "new_import_mapping" ("id", "owner_id", "name", "platform", "spec", "fingerprint", "version", "origin", "created_at", "updated_at") SELECT "id", "owner_id", "name", "platform", "spec", "fingerprint", "version", "origin", "created_at", "updated_at" FROM "import_mapping";
DROP TABLE "import_mapping";
ALTER TABLE "new_import_mapping" RENAME TO "import_mapping";
CREATE INDEX "import_mapping_owner_id_idx" ON "import_mapping"("owner_id");
CREATE INDEX "import_mapping_owner_id_library_id_idx" ON "import_mapping"("owner_id", "library_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
