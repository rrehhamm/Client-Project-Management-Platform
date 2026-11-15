-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminded_before_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminded_due_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "client_contacts" ADD COLUMN     "anonymised_at" TIMESTAMPTZ(3),
ADD COLUMN     "notification_prefs" JSONB;

-- CreateTable
CREATE TABLE "approval_pins" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "body" TEXT NOT NULL,
    "author_user_id" UUID,
    "author_contact_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "approval_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_pins_approval_request_id_number_key" ON "approval_pins"("approval_request_id", "number");

-- AddForeignKey
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_author_contact_id_fkey" FOREIGN KEY ("author_contact_id") REFERENCES "client_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- FR-APP-02: pins sit inside the page (0–1 on each axis) and are numbered from 1
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_position" CHECK ("x" >= 0 AND "x" <= 1 AND "y" >= 0 AND "y" <= 1 AND "page" >= 1 AND "number" >= 1);
ALTER TABLE "approval_pins" ADD CONSTRAINT "approval_pins_one_author" CHECK (num_nonnulls("author_user_id", "author_contact_id") = 1);
