# THE VERGE Developer API

The Developer API is designed for business websites, storefronts and approved integrations that need controlled access to THE VERGE business data.

## Authentication

Use a workspace API credential in the HTTP Authorization header:

`Authorization: Bearer vga_live_...`

The secret is shown only once when created. Store it outside source control and rotate/revoke it when exposure is suspected.

## Workspace selection

API requests identify the target workspace with:

`organizationId=<workspace-id>`

The credential itself is bound to one organization. A credential cannot be used to read another organization.

## Current endpoint

### Inventory catalogue

`GET /api/v1/inventory?organizationId=<id>`

Optional query parameters:

- `locationId` — include stock for one active location
- `search` — search product name or SKU
- `barcode` — exact barcode lookup
- `page` — 1-based page number
- `limit` — maximum 100 records

Example response shape:

```json
{
  "data": [
    {
      "id": "product-id",
      "sku": "SKU-1001",
      "barcode": "1234567890",
      "name": "Example product",
      "unit": "piece",
      "standardCostMinor": 125000,
      "retailPriceMinor": 150000,
      "stock": 8
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "returned": 1,
    "nextPage": null
  }
}
```

Money values are integer minor units. For NGN, `150000` means ₦1,500.00.

## Scopes

Current credential scopes:

- `inventory.read`
- `inventory.write`
- `sales.read`
- `sales.write`
- `customers.read`
- `customers.write`
- `finance.read`
- `finance.write`
- `webhooks.manage`

The inventory catalogue requires `inventory.read`.

## Security rules

Credentials:
- are organization-bound
- are hashed at rest
- can expire
- can be revoked
- are rate limited
- are audited when created/revoked
- do not expose database credentials

Do not put an API secret in browser JavaScript for a public storefront. A server-side integration should call THE VERGE and pass only the response data needed by the storefront.

## Compatibility

The endpoint is intentionally versioned under `/api/v1`. Breaking API changes should use a new version rather than silently changing existing response contracts.
