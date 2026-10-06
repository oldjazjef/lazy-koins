-- F7.4a: the ESTV Kursliste (ICTax), downloaded once per deployment, and the label of the
-- automatic ESTV values on a project's rates. CHECKs are hand-written (see CLAUDE.md, Database).

-- AlterTable
ALTER TABLE "project_rate" ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "estv_kursliste" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "export_type" TEXT NOT NULL,
    "export_date" DATETIME NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "downloaded_at" DATETIME NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "crypto_count" INTEGER NOT NULL,
    CONSTRAINT "estv_kursliste_year" CHECK ("year" BETWEEN 2000 AND 2100),
    CONSTRAINT "estv_kursliste_export_type" CHECK ("export_type" LIKE 'THIRD.INIT.%'),
    CONSTRAINT "estv_kursliste_file_hash" CHECK (length(trim("file_hash")) > 0),
    CONSTRAINT "estv_kursliste_counts" CHECK ("entry_count" >= 0 AND "crypto_count" >= 0 AND "crypto_count" <= "entry_count")
);

-- CreateTable
CREATE TABLE "estv_rate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "ictax_id" TEXT,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valor_number" TEXT,
    "isin" TEXT,
    "value" TEXT NOT NULL,
    CONSTRAINT "estv_rate_year_fkey" FOREIGN KEY ("year") REFERENCES "estv_kursliste" ("year") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "estv_rate_kind" CHECK ("kind" IN ('crypto', 'currency', 'fx')),
    CONSTRAINT "estv_rate_symbol_not_blank" CHECK (length(trim("symbol")) > 0),
    CONSTRAINT "estv_rate_value_decimal" CHECK ("value" <> '' AND "value" NOT GLOB '*[^0-9.]*')
);

-- CreateTable
CREATE TABLE "estv_check" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "checked_at" DATETIME NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    CONSTRAINT "estv_check_year" CHECK ("year" BETWEEN 2000 AND 2100),
    CONSTRAINT "estv_check_outcome" CHECK ("outcome" IN ('updated', 'current', 'failed'))
);

-- CreateIndex
CREATE INDEX "estv_rate_year_symbol_idx" ON "estv_rate"("year", "symbol");
