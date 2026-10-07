-- Setup wizard (F11.0s) and PIN lock (F11.0p): the wizard's progress per user and the PIN of a
-- user — only its slow salted hash, the wrong-attempt counter and the auto-lock time. New tables
-- only — no existing table is redefined.
--
-- The CHECK constraints are hand-added inside each CREATE TABLE, as in the earlier migrations;
-- setup.persistence.integration.spec.ts tests them.

-- CreateTable
CREATE TABLE "setup_progress" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "steps" TEXT NOT NULL DEFAULT '{}',
    "current_step" TEXT NOT NULL DEFAULT 'profile',
    "completed_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "setup_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "setup_progress_steps_json" CHECK (json_valid("steps") AND json_type("steps") = 'object'),
    CONSTRAINT "setup_progress_current_step" CHECK ("current_step" IN ('profile', 'advisor', 'ai', 'rates', 'wallets', 'mail', 'storage', 'pin', 'summary'))
);

-- CreateTable
CREATE TABLE "user_pin" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "pin_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" DATETIME,
    "relogin_required_at" DATETIME,
    "auto_lock_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_pin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_pin_hash" CHECK ("pin_hash" LIKE 'scrypt$%' AND length("pin_hash") <= 200),
    CONSTRAINT "user_pin_failed_attempts" CHECK ("failed_attempts" >= 0),
    CONSTRAINT "user_pin_auto_lock" CHECK ("auto_lock_minutes" BETWEEN 1 AND 240)
);
