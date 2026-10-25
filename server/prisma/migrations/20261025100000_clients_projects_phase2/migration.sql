-- AlterTable
ALTER TABLE "client_contacts" ADD COLUMN     "commercial_authority" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "code_prefix_locked_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "archived_by" UUID,
ADD COLUMN     "deleted_by" UUID;

-- Backfill existing data
-- D-16: primary contacts hold commercial authority by default
UPDATE "client_contacts" SET "commercial_authority" = true WHERE "is_primary" = true;
-- D-02: clients that already have projects have a locked prefix
UPDATE "clients" c SET "code_prefix_locked_at" = now()
WHERE EXISTS (SELECT 1 FROM "projects" p WHERE p."client_id" = c."id");

-- Archived is a flag on Completed or Cancelled projects only (BRD 16.1)
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_archived_only_when_closed"
  CHECK (archived_at IS NULL OR status IN ('Completed', 'Cancelled'));
