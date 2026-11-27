-- Business profile, durable locations, and automated accounting posting.
-- Apply after migrations 001-005. Safe to run repeatedly.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS tax_identifier text,
  ADD COLUMN IF NOT EXISTS logo_url text;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Lagos';

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- A source transaction can create only one journal in an organisation.
-- This is the database-level idempotency boundary for posting/retries.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_unique
  ON journal_entries (organization_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS journal_entries_org_location_date
  ON journal_entries (organization_id, location_id, occurred_at DESC, id);

CREATE UNIQUE INDEX IF NOT EXISTS locations_org_code_unique
  ON locations (organization_id, upper(code))
  WHERE code IS NOT NULL AND btrim(code) <> '';

-- Posted journal entries must have at least two lines and balance exactly.
-- Deferred checks allow the parent and its lines to be inserted in one transaction.
CREATE OR REPLACE FUNCTION verge_assert_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_entry_id uuid;
  debit_total numeric;
  credit_total numeric;
  line_count integer;
  entry_status text;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    IF TG_OP = 'DELETE' THEN
      target_entry_id := OLD.id;
    ELSE
      target_entry_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      target_entry_id := OLD.journal_entry_id;
    ELSE
      target_entry_id := NEW.journal_entry_id;
    END IF;
  END IF;

  SELECT status INTO entry_status
    FROM journal_entries WHERE id = target_entry_id;

  IF NOT FOUND OR entry_status <> 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit_minor), 0),
         COALESCE(SUM(credit_minor), 0),
         COUNT(*)
    INTO debit_total, credit_total, line_count
    FROM journal_lines
   WHERE journal_entry_id = target_entry_id;

  IF line_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal_entry_not_balanced'
      USING ERRCODE = '23514',
            DETAIL = format('entry=%s lines=%s debit=%s credit=%s',
              target_entry_id, line_count, debit_total, credit_total);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balanced
AFTER INSERT OR UPDATE ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verge_assert_journal_balanced();

DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verge_assert_journal_balanced();


-- Provision the standard chart for organisations that already exist.
INSERT INTO ledger_accounts (id,organization_id,code,name,account_class,normal_balance,active)
SELECT gen_random_uuid(), o.id, seed.code, seed.name, seed.account_class, seed.normal_balance, true
FROM organizations o
CROSS JOIN (VALUES
  ('1000','Cash','asset','debit'),
  ('1010','Bank','asset','debit'),
  ('1100','Accounts Receivable','asset','debit'),
  ('1200','Inventory','asset','debit'),
  ('1210','Inventory in Transit','asset','debit'),
  ('2000','Accounts Payable','liability','credit'),
  ('3000','Owner Equity','equity','credit'),
  ('4000','Sales Revenue','revenue','credit'),
  ('5000','Cost of Goods Sold','expense','debit'),
  ('6000','Operating Expenses','expense','debit')
) AS seed(code,name,account_class,normal_balance)
ON CONFLICT (organization_id,code) DO NOTHING;
