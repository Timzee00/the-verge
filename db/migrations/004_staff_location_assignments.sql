-- Explicit location scope for every non-owner organization membership.
-- The application API validates that each assigned location belongs to the same organization.
CREATE TABLE IF NOT EXISTS membership_locations (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_locations_pkey PRIMARY KEY (organization_id, user_id, location_id),
  CONSTRAINT membership_locations_membership_fk
    FOREIGN KEY (organization_id, user_id)
    REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS membership_locations_location_idx
  ON membership_locations (organization_id, location_id, user_id);
