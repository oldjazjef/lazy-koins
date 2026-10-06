-- Mail to the Treuhänder (F11.10, F10.6a) and the "An Treuhänder gesendet" status (F4.7): the
-- mailer per user (password sealed), the user's own text template per language, the send log per
-- project and the sent state per project. New tables only — no existing table is redefined.
--
-- The CHECK constraints are hand-added inside each CREATE TABLE, as in the earlier migrations;
-- mail.persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "mail_settings" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 587,
    "security" TEXT NOT NULL DEFAULT 'starttls',
    "username" TEXT NOT NULL DEFAULT '',
    "password_cipher" TEXT,
    "password_hint" TEXT,
    "from_name" TEXT NOT NULL DEFAULT '',
    "from_address" TEXT NOT NULL DEFAULT '',
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_settings_security" CHECK ("security" IN ('tls', 'starttls', 'none')),
    CONSTRAINT "mail_settings_port" CHECK ("port" BETWEEN 1 AND 65535),
    CONSTRAINT "mail_settings_password_sealed" CHECK ("password_cipher" IS NULL OR "password_cipher" LIKE 'enc:v1:%'),
    CONSTRAINT "mail_settings_password_hint" CHECK ("password_hint" IS NULL OR length("password_hint") <= 8)
);

-- CreateTable
CREATE TABLE "mail_template" (
    "user_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "language"),
    CONSTRAINT "mail_template_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_template_language" CHECK ("language" IN ('de-CH')),
    CONSTRAINT "mail_template_subject" CHECK (length("subject") BETWEEN 1 AND 300),
    CONSTRAINT "mail_template_body" CHECK (length("body") BETWEEN 1 AND 20000)
);

-- CreateTable
CREATE TABLE "mail_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "cc_address" TEXT,
    "subject" TEXT NOT NULL,
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "message_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_log_status" CHECK ("status" IN ('sent', 'failed')),
    CONSTRAINT "mail_log_attachments" CHECK (json_valid("attachments") AND json_type("attachments") = 'array'),
    CONSTRAINT "mail_log_failed_has_error" CHECK ("status" = 'sent' OR "error" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "project_sent_state" (
    "project_id" TEXT NOT NULL PRIMARY KEY,
    "sent_to_advisor_at" DATETIME NOT NULL,
    "sent_to" TEXT NOT NULL DEFAULT '',
    "sent_via" TEXT NOT NULL,
    "sent_note" TEXT NOT NULL DEFAULT '',
    "sent_exports" TEXT NOT NULL DEFAULT '[]',
    "mail_log_id" TEXT,
    "snapshot_hash" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "project_sent_state_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_sent_state_via" CHECK ("sent_via" IN ('mail', 'post', 'personal', 'other')),
    CONSTRAINT "project_sent_state_exports" CHECK (json_valid("sent_exports") AND json_type("sent_exports") = 'array'),
    CONSTRAINT "project_sent_state_note" CHECK (length("sent_note") <= 2000)
);

-- CreateIndex
CREATE INDEX "mail_log_project_id_created_at_idx" ON "mail_log"("project_id", "created_at");
