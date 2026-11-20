-- D-45: per-user appearance setting (System / Light / Dark) for staff and client contacts.
-- AlterTable
ALTER TABLE "client_contacts" ADD COLUMN     "appearance" VARCHAR(10) NOT NULL DEFAULT 'system';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "appearance" VARCHAR(10) NOT NULL DEFAULT 'system';

-- D-45: only the three appearance values are allowed (hand-written).
ALTER TABLE "users" ADD CONSTRAINT "users_appearance_check" CHECK ("appearance" IN ('system', 'light', 'dark'));
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_appearance_check" CHECK ("appearance" IN ('system', 'light', 'dark'));
