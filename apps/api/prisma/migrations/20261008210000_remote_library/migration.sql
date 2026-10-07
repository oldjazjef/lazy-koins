-- F5.18: the desktop app can be linked to the mapping library of a web deployment (its public,
-- read-only endpoint). New table remote_library_settings (one row per user, cascade; no row =
-- not linked) and import_mapping.library_server = the server a copy was taken from (NULL = this
-- deployment's own library). `ADD COLUMN` — no redefinition, every other CHECK stays as it is.
-- CHECKs are hand-written (see CLAUDE.md, Database); remote-library.persistence.integration.spec.ts
-- tests them.

-- CreateTable
CREATE TABLE "remote_library_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "suggestions" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "remote_library_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "remote_library_settings_url" CHECK ("url" = '' OR (length("url") <= 300 AND ("url" LIKE 'https://_%' OR "url" LIKE 'http://_%') AND "url" NOT LIKE '%/' AND "url" NOT LIKE '%?%' AND "url" NOT LIKE '%#%')),
    CONSTRAINT "remote_library_settings_enabled_needs_url" CHECK ("enabled" = false OR "url" <> '')
);

-- AlterTable
ALTER TABLE "import_mapping" ADD COLUMN "library_server" TEXT
    CONSTRAINT "import_mapping_library_server" CHECK ("library_server" IS NULL OR ("library_id" IS NOT NULL AND length("library_server") <= 300 AND ("library_server" LIKE 'https://_%' OR "library_server" LIKE 'http://_%')));
