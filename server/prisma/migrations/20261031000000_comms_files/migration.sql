-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('Pending', 'Clean', 'Infected', 'Failed');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "parent_comment_id" UUID;

-- AlterTable
ALTER TABLE "file_versions" ADD COLUMN     "original_name" VARCHAR(255) NOT NULL,
ADD COLUMN     "scan_status" "ScanStatus" NOT NULL DEFAULT 'Pending',
ADD COLUMN     "scanned_at" TIMESTAMPTZ(3),
ADD COLUMN     "sha256" CHAR(64);

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "folder_id" UUID;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_error" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notification_prefs" JSONB;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "storage_used_bytes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "file_folders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_normalized" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "file_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_attachments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "comment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_folders_project_id_name_normalized_key" ON "file_folders"("project_id", "name_normalized");

-- CreateIndex
CREATE INDEX "comment_attachments_file_id_idx" ON "comment_attachments"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "comment_attachments_comment_id_file_id_key" ON "comment_attachments"("comment_id", "file_id");

-- CreateIndex
CREATE INDEX "comments_parent_comment_id_idx" ON "comments"("parent_comment_id");

-- CreateIndex
CREATE INDEX "files_folder_id_idx" ON "files"("folder_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "file_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BR-FILE-03: the usage counter can never go below zero
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_storage_used_nonnegative" CHECK ("storage_used_bytes" >= 0);


-- FR-SRCH-01: name search with ILIKE '%term%' uses trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "clients_name_trgm" ON "clients" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "client_contacts_name_trgm" ON "client_contacts" USING GIN ("full_name" gin_trgm_ops);
CREATE INDEX "client_contacts_email_trgm" ON "client_contacts" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "projects_name_trgm" ON "projects" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "tasks_title_trgm" ON "tasks" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "files_name_trgm" ON "files" USING GIN ("name" gin_trgm_ops);
