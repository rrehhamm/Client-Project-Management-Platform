-- Database-level guards for rules Prisma's schema language cannot express.
-- The API enforces every rule first, with friendly errors. These are a backstop
-- so that bad data cannot get in through a bug, a script or a manual query.

-- ---------------------------------------------------------------------------
-- Login emails (BR-AUTH-04, BR-ROLE-05, FR-CON-01; approved: unique platform-wide)
-- ---------------------------------------------------------------------------

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized" CHECK (email <> '' AND email = lower(btrim(email)));
ALTER TABLE "client_contacts"
  ADD CONSTRAINT "client_contacts_email_normalized" CHECK (email <> '' AND email = lower(btrim(email)));

-- Each table already has a unique index on email. This trigger stops the same
-- email existing in both tables. The advisory lock serialises concurrent inserts
-- of the same email so two transactions cannot both pass the check.
CREATE FUNCTION enforce_login_email_unique() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('login_email:' || NEW.email, 0));
  IF TG_TABLE_NAME = 'users' THEN
    IF EXISTS (SELECT 1 FROM client_contacts WHERE email = NEW.email) THEN
      RAISE EXCEPTION 'Email is already used by a client contact'
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'login_email_unique';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM users WHERE email = NEW.email) THEN
      RAISE EXCEPTION 'Email is already used by an internal user'
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'login_email_unique';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_login_email_unique"
  BEFORE INSERT OR UPDATE OF email ON "users"
  FOR EACH ROW EXECUTE FUNCTION enforce_login_email_unique();
CREATE TRIGGER "client_contacts_login_email_unique"
  BEFORE INSERT OR UPDATE OF email ON "client_contacts"
  FOR EACH ROW EXECUTE FUNCTION enforce_login_email_unique();

-- ---------------------------------------------------------------------------
-- Activity log is append-only (BR-ACT-01)
-- ---------------------------------------------------------------------------

CREATE FUNCTION reject_activity_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_logs is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "activity_logs_append_only"
  BEFORE UPDATE OR DELETE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION reject_activity_log_change();

-- ---------------------------------------------------------------------------
-- Workspace and clients
-- ---------------------------------------------------------------------------

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_week_start_day_range" CHECK (week_start_day BETWEEN 0 AND 6),
  ADD CONSTRAINT "workspaces_currency_format" CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "workspaces_next_numbers_positive" CHECK (next_invoice_number >= 1 AND next_proposal_number >= 1);

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_name_normalized" CHECK (name_normalized = lower(btrim(name))),
  ADD CONSTRAINT "clients_name_length" CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  ADD CONSTRAINT "clients_code_prefix_format" CHECK (code_prefix ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "clients_currency_format" CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "clients_next_project_number_positive" CHECK (next_project_number >= 1),
  ADD CONSTRAINT "clients_payment_terms_non_negative" CHECK (payment_terms_days >= 0);

-- ---------------------------------------------------------------------------
-- Projects, members, tasks
-- ---------------------------------------------------------------------------

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_name_normalized" CHECK (name_normalized = lower(btrim(name))),
  ADD CONSTRAINT "projects_name_length" CHECK (char_length(btrim(name)) BETWEEN 2 AND 150),
  -- BR-PRJ-02
  ADD CONSTRAINT "projects_due_after_start" CHECK (due_date IS NULL OR due_date >= start_date),
  ADD CONSTRAINT "projects_progress_range" CHECK (progress_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT "projects_budget_non_negative" CHECK (
    (budget_amount IS NULL OR budget_amount >= 0) AND (budget_minutes IS NULL OR budget_minutes >= 0));

-- A member row is either an internal user with a project role,
-- or a client contact with a portal level.
ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_user_xor_contact" CHECK (
    (user_id IS NOT NULL AND contact_id IS NULL AND project_role IS NOT NULL AND portal_level IS NULL)
    OR
    (user_id IS NULL AND contact_id IS NOT NULL AND portal_level IS NOT NULL AND project_role IS NULL));

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_not_own_parent" CHECK (parent_task_id IS NULL OR parent_task_id <> id),
  -- BR-TSK-01
  ADD CONSTRAINT "tasks_due_after_start" CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
  -- FR-TSK-02: estimates in 0.25 h steps
  ADD CONSTRAINT "tasks_estimate_quarter_hours" CHECK (
    estimate_minutes IS NULL OR (estimate_minutes >= 0 AND estimate_minutes % 15 = 0)),
  ADD CONSTRAINT "tasks_title_length" CHECK (char_length(btrim(title)) BETWEEN 1 AND 255);

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_not_self" CHECK (predecessor_id <> successor_id);

-- ---------------------------------------------------------------------------
-- Exactly-one-actor columns
-- ---------------------------------------------------------------------------

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_one_author" CHECK (num_nonnulls(author_user_id, author_contact_id) = 1);
ALTER TABLE "mentions"
  ADD CONSTRAINT "mentions_one_target" CHECK (num_nonnulls(user_id, contact_id) = 1);
ALTER TABLE "followers"
  ADD CONSTRAINT "followers_one_follower" CHECK (num_nonnulls(user_id, contact_id) = 1);
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_one_recipient" CHECK (num_nonnulls(user_id, contact_id) = 1);
ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_one_signer" CHECK (num_nonnulls(signer_user_id, signer_contact_id) = 1);

-- ---------------------------------------------------------------------------
-- Files and approvals
-- ---------------------------------------------------------------------------

ALTER TABLE "file_versions"
  ADD CONSTRAINT "file_versions_one_uploader" CHECK (num_nonnulls(uploaded_by_user_id, uploaded_by_contact_id) = 1),
  ADD CONSTRAINT "file_versions_version_positive" CHECK (version_no >= 1),
  ADD CONSTRAINT "file_versions_size_non_negative" CHECK (size_bytes >= 0);

ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_one_subject" CHECK (num_nonnulls(file_version_id, task_id) = 1);

-- ---------------------------------------------------------------------------
-- Time and money
-- ---------------------------------------------------------------------------

-- BR-TIME-01: one entry is > 0 and <= 24 h
ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_duration_range" CHECK (duration_minutes BETWEEN 1 AND 1440);

-- BR-INV-03: payment amount > 0
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK (amount > 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_due_after_issue" CHECK (due_date >= issue_date),
  ADD CONSTRAINT "invoices_currency_format" CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "proposal_lines"
  ADD CONSTRAINT "proposal_lines_tax_rate_range" CHECK (tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_tax_rate_range" CHECK (tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_deposit_range" CHECK (deposit_pct_bp IS NULL OR deposit_pct_bp BETWEEN 0 AND 10000);
