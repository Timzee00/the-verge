-- Supplier purchasing, receipt traceability, and inter-location stock transfers.
-- Apply after migrations 001-006. All source records remain append-only; orders/transfers
-- are stateful documents and inventory changes are recorded as immutable events.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  tax_identifier text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_unique
  ON suppliers (organization_id, lower(name));
CREATE INDEX IF NOT EXISTS suppliers_org_active_name
  ON suppliers (organization_id, active, name);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('ordered','partially_received','received','cancelled')),
  notes text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  expected_at date,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference)
);
CREATE INDEX IF NOT EXISTS purchase_orders_org_date
  ON purchase_orders (organization_id, ordered_at DESC, id);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier
  ON purchase_orders (organization_id, supplier_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_location_status
  ON purchase_orders (organization_id, location_id, status, ordered_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_id, product_id)
);
CREATE INDEX IF NOT EXISTS purchase_order_items_product
  ON purchase_order_items (product_id, purchase_order_id);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  total_cost_minor bigint NOT NULL CHECK (total_cost_minor >= 0),
  received_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_receipts_order_date
  ON purchase_receipts (purchase_order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS purchase_receipts_org_date
  ON purchase_receipts (organization_id, received_at DESC, id);

CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_id uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_received integer NOT NULL CHECK (quantity_received > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_receipt_id, purchase_order_item_id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference text NOT NULL,
  from_location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  to_location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft','dispatched','received','cancelled')),
  notes text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  dispatched_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  received_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  received_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_location_id <> to_location_id),
  UNIQUE (organization_id, reference)
);
CREATE INDEX IF NOT EXISTS stock_transfers_org_date
  ON stock_transfers (organization_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS stock_transfers_from_status
  ON stock_transfers (organization_id, from_location_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_to_status
  ON stock_transfers (organization_id, to_location_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost_minor bigint NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_transfer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('dispatched','received')),
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, action)
);


-- Ensure existing organisations also have the stock-in-transit asset account.
INSERT INTO ledger_accounts (id,organization_id,code,name,account_class,normal_balance,active)
SELECT gen_random_uuid(),o.id,'1210','Inventory in Transit','asset','debit',true
FROM organizations o
ON CONFLICT (organization_id,code) DO NOTHING;
