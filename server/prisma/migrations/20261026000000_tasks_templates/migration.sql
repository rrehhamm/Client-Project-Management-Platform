-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "duplicated_from_id" UUID,
ADD COLUMN     "source_template_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_normalized" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "billing_type" "BillingType" NOT NULL DEFAULT 'Fixed',
    "source_project_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_milestones" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "due_offset_days" INTEGER NOT NULL,
    "amount" BIGINT,
    "visibility" "Visibility" NOT NULL DEFAULT 'Internal',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "template_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_milestone_id" UUID,
    "parent_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'Normal',
    "visibility" "Visibility" NOT NULL DEFAULT 'Internal',
    "estimate_minutes" INTEGER,
    "is_billable" BOOLEAN,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_offset_days" INTEGER,
    "due_offset_days" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "checklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "predecessor_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "template_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_checklist_items_task_id_sort_order_idx" ON "task_checklist_items"("task_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_workspace_id_name_normalized_key" ON "project_templates"("workspace_id", "name_normalized");

-- CreateIndex
CREATE INDEX "template_milestones_template_id_idx" ON "template_milestones"("template_id");

-- CreateIndex
CREATE INDEX "template_tasks_template_id_idx" ON "template_tasks"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_members_template_id_user_id_key" ON "template_members"("template_id", "user_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "project_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_milestones" ADD CONSTRAINT "template_milestones_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_template_milestone_id_fkey" FOREIGN KEY ("template_milestone_id") REFERENCES "template_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "template_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_members" ADD CONSTRAINT "template_members_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "project_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Phase 3)
-- Filter tasks by label (FR-TSK-02)
CREATE INDEX "tasks_labels_gin" ON "tasks" USING GIN ("labels");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_labels_max_10" CHECK (cardinality(labels) <= 10);
ALTER TABLE "project_templates"
  ADD CONSTRAINT "project_templates_name_normalized" CHECK (name_normalized = lower(btrim(name)));
