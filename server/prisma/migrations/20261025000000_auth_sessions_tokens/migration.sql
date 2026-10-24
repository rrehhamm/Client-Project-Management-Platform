-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('Invite', 'PasswordReset', 'EmailChange');

-- AlterTable
ALTER TABLE "activity_logs" ALTER COLUMN "entity_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "client_contacts" ADD COLUMN     "timezone" VARCHAR(64);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "contact_id" UUID,
    "refresh_jti_hash" CHAR(64) NOT NULL,
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(40),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID,
    "contact_id" UUID,
    "new_email" VARCHAR(254),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_throttles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_contact_id_revoked_at_idx" ON "sessions"("contact_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_purpose_idx" ON "auth_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "auth_tokens_contact_id_purpose_idx" ON "auth_tokens"("contact_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "login_throttles_email_key" ON "login_throttles"("email");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_throttles" ADD CONSTRAINT "login_throttles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written guards (Phase 1)
-- ---------------------------------------------------------------------------

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_one_principal" CHECK (num_nonnulls(user_id, contact_id) = 1),
  ADD CONSTRAINT "sessions_contacts_never_remembered" CHECK (contact_id IS NULL OR remember_me = false);

ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_one_principal" CHECK (num_nonnulls(user_id, contact_id) = 1),
  ADD CONSTRAINT "auth_tokens_new_email_only_for_email_change" CHECK (
    (purpose = 'EmailChange' AND new_email IS NOT NULL AND new_email = lower(btrim(new_email)))
    OR (purpose <> 'EmailChange' AND new_email IS NULL));

ALTER TABLE "login_throttles"
  ADD CONSTRAINT "login_throttles_email_normalized" CHECK (email <> '' AND email = lower(btrim(email))),
  ADD CONSTRAINT "login_throttles_failed_count_non_negative" CHECK (failed_count >= 0);
