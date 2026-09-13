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
