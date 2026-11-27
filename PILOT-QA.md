# The Verge — Pilot QA Checklist

Use a fresh browser profile/device for first-run testing.

## Workspace
- [ ] Create a workspace with a real test business name.
- [ ] Select an industry.
- [ ] Create the first branch/location.
- [ ] Refresh the browser and confirm the workspace remains selected.

## Inventory
- [ ] Register a product with name, barcode, cost, selling price and quantity.
- [ ] Confirm received quantity is visible locally.
- [ ] Register another product.
- [ ] Confirm product prices remain unchanged after a sale.

## Sales
- [ ] Sell a product while online.
- [ ] Turn the device offline and sell another product.
- [ ] Confirm the local pending queue increases.
- [ ] Confirm insufficient stock is rejected.

## Personal finance
- [ ] Add an expense while online.
- [ ] Add an expense while offline.
- [ ] Confirm the transaction remains after reload.

## Data portability
- [ ] Download account data.
- [ ] Confirm the file contains only intended local test data.

## Report defects
Record device, browser, exact steps, expected result, actual result, and whether the device was online/offline.


## Staff and location access
- [ ] Add a cashier and assign only Branch A.
- [ ] Sign in as the cashier and confirm only Branch A is selectable.
- [ ] Confirm a sale in Branch B is rejected by the server even if a request is manually submitted.
- [ ] Add inventory staff and assign Branch A.
- [ ] Confirm stock receiving works in Branch A and is rejected for Branch B.
- [ ] Change the staff member's assigned locations while they are signed in; reconnect and confirm the local cache refreshes to the new scope.
- [ ] Deactivate the staff member and confirm background sync no longer accepts writes.

## Inventory staff
- [ ] Search products by name, SKU and barcode.
- [ ] Receive a positive whole-number quantity and confirm the stock event and outbox row are created atomically.
- [ ] Attempt zero, negative and fractional quantities; all must be rejected.
- [ ] Import a spreadsheet with valid, duplicate and invalid rows; confirm invalid rows cannot be imported.
- [ ] Import while another local action is creating an outbox row; confirm device sequence numbers remain unique.

## Accountant and business expenses
- [ ] Record an expense online and confirm it appears in the server-backed ledger after sync.
- [ ] Record an expense offline, reload the application, reconnect and confirm it syncs exactly once.
- [ ] Reject empty categories/descriptions, invalid amounts, unsupported payment methods and inactive/unassigned locations.
- [ ] Switch between assigned branches and confirm totals and recent records change to the selected location.
- [ ] Confirm cashiers and inventory staff cannot pull expense records.
- [ ] Confirm expenses do not appear as posted journal entries until a balanced posting workflow exists.

## Sync reliability and isolation
- [ ] Trigger multiple sync attempts at once; only one background sync run should execute per app instance.
- [ ] Confirm failed operations respect next-attempt backoff.
- [ ] Replay a successful device/sequence pair and confirm the server deduplicates it.
- [ ] Attempt cross-organisation product, customer, expense and inventory identifiers; all must be rejected.
- [ ] Attempt a destructive inventory movement that would take stock below zero; the server must reject it under concurrent checkout load.
- [ ] Verify the migration indexes are present after applying migration 005 in Preview.
