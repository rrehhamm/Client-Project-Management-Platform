-- D-35: new notification defaults. Phase 4 saved every event whenever a person saved
-- their settings, so the stored rows do not show which events they actually changed.
-- Keep a stored value only when it is a real choice:
--   * it differs from the old default ('email'), or
--   * the audit log shows the person switching that event to 'email' themselves.
-- Everything else is removed, so it follows the new defaults.
UPDATE "users" u
SET "notification_prefs" = (
  SELECT jsonb_object_agg(e.key, e.value)
  FROM jsonb_each_text(u."notification_prefs") AS e(key, value)
  WHERE e.value <> 'email'
     OR EXISTS (
       SELECT 1 FROM "activity_logs" a
       WHERE a."action" = 'user.notification_prefs_changed'
         AND a."entity_id" = u."id"
         AND a."after" ->> e.key = 'email'
         AND COALESCE(a."before" ->> e.key, '') <> 'email'
     )
)
WHERE u."notification_prefs" IS NOT NULL;
