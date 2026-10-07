-- F5.7a: a file can be deactivated per project — it stays stored, downloadable and previewable,
-- but the calculation, the dashboard, the F5.8 hints, the checks and the exports ignore it. The
-- flag lives on project_file (the same stored file in another project is unaffected).
-- `ADD COLUMN` — no redefinition, every other CHECK of project_file stays as it is. CHECKs are
-- hand-written (see CLAUDE.md, Database); persistence.integration.spec.ts tests them.

-- AlterTable
ALTER TABLE "project_file" ADD COLUMN "disabled_at" DATETIME;
ALTER TABLE "project_file" ADD COLUMN "disabled_note" TEXT
    CONSTRAINT "project_file_disabled_note" CHECK ("disabled_note" IS NULL OR ("disabled_at" IS NOT NULL AND length("disabled_note") <= 500));
