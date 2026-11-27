-- Efficient keyset pagination for the offline expense sync feed.
-- Safe to apply after db/migrations/002_auth_and_sync.sql.
CREATE INDEX IF NOT EXISTS expenses_org_created_id_idx
  ON expenses (organization_id, created_at, id);

CREATE INDEX IF NOT EXISTS expenses_org_location_created_id_idx
  ON expenses (organization_id, location_id, created_at, id);
