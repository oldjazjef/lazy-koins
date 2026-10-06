-- F5.8 hints: dismissals per project ("Als in Ordnung markieren" / "Ignorieren"), keyed by the
-- hint's stable key. No row = open. CHECKs are hand-written (see CLAUDE.md, Database).

-- CreateTable
CREATE TABLE "project_hint_state" (
    "project_id" TEXT NOT NULL,
    "hint_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("project_id", "hint_key"),
    CONSTRAINT "project_hint_state_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_hint_state_key_not_blank" CHECK (length("hint_key") > 0 AND length("hint_key") <= 600),
    CONSTRAINT "project_hint_state_status" CHECK ("status" IN ('done', 'ignored')),
    CONSTRAINT "project_hint_state_note_length" CHECK (length("note") <= 500)
);
