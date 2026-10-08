-- Platform admin (management pages): the admin role, blocking and the last request on the user;
-- moderation of public library entries; an append-only log of every admin action.
-- `ADD COLUMN` only for the existing tables — no redefinition, their other CHECKs stay as they
-- are. CHECKs are hand-written (see CLAUDE.md, Database); admin.persistence.integration.spec.ts
-- tests them.

-- AlterTable
ALTER TABLE "user" ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false
    CONSTRAINT "user_is_platform_admin" CHECK ("is_platform_admin" IN (0, 1));
ALTER TABLE "user" ADD COLUMN "blocked_at" DATETIME;
ALTER TABLE "user" ADD COLUMN "blocked_reason" TEXT
    CONSTRAINT "user_blocked_reason" CHECK ("blocked_reason" IS NULL OR ("blocked_at" IS NOT NULL AND length(trim("blocked_reason")) BETWEEN 1 AND 500));
ALTER TABLE "user" ADD COLUMN "last_seen_at" DATETIME;

-- AlterTable
ALTER TABLE "library_mapping" ADD COLUMN "hidden_at" DATETIME;
ALTER TABLE "library_mapping" ADD COLUMN "hidden_reason" TEXT
    CONSTRAINT "library_mapping_hidden_reason" CHECK ("hidden_reason" IS NULL OR ("hidden_at" IS NOT NULL AND length(trim("hidden_reason")) BETWEEN 1 AND 500));

-- CreateTable
CREATE TABLE "admin_audit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_label" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_action" CHECK ("action" IN ('user.block', 'user.unblock', 'user.grantAdmin', 'user.revokeAdmin', 'user.delete', 'library.hide', 'library.unhide')),
    CONSTRAINT "admin_audit_target_type" CHECK ("target_type" IN ('user', 'library')),
    CONSTRAINT "admin_audit_target_label" CHECK (length("target_label") <= 300),
    CONSTRAINT "admin_audit_reason" CHECK ("reason" IS NULL OR length("reason") <= 500)
);

-- CreateIndex
CREATE INDEX "admin_audit_created_at_idx" ON "admin_audit"("created_at");
