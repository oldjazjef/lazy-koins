-- F11.11–F11.13: the notification centre — one row per user and topic (dedupe), new table only.
-- CHECKs are hand-written (see CLAUDE.md, Database).

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "kind" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title_key" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "action" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurred_at" DATETIME NOT NULL,
    "read_at" DATETIME,
    "resolved_at" DATETIME,
    "dismissed_at" DATETIME,
    CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_kind" CHECK ("kind" IN ('error', 'action', 'info', 'success')),
    CONSTRAINT "notification_topic_length" CHECK (length("topic") > 0 AND length("topic") <= 300),
    CONSTRAINT "notification_title_key" CHECK ("title_key" LIKE 'notifications.%' AND length("title_key") <= 200),
    CONSTRAINT "notification_params_json" CHECK (json_valid("params") AND json_type("params") = 'object' AND length("params") <= 4000),
    CONSTRAINT "notification_action_json" CHECK ("action" IS NULL OR (json_valid("action") AND json_type("action") = 'object' AND length("action") <= 2000))
);

-- CreateIndex
CREATE INDEX "notification_user_id_occurred_at_idx" ON "notification"("user_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_id_topic_key" ON "notification"("user_id", "topic");
