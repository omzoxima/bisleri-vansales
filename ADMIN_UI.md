# Admin UI — Drizzle Studio

A browser-based grid over the Postgres database, running locally against the live Azure DB.

```bash
cd backend
npm run db:studio
```

Opens `https://local.drizzle.studio` (UI assets load from Drizzle's site, but it talks to your local process on `localhost:4983` — table data never leaves this machine except to/from Azure).

---

## ⚠️ After editing any row, also bump `updated_at`

Devices pull master data via `POST /sync/masters`, filtered on `updated_at > since` (`src/masters/masters.service.ts:36`). The `updated_at` auto-bump (`src/db/schema.ts:21-25`) is a Drizzle ORM hook — it only fires for writes made through the ORM (`db.update()`), not for the raw `UPDATE` statements Studio issues.

**So: whenever you edit a value in Studio, also set that row's `updated_at` cell to the current time before saving — otherwise the change is invisible to the app and no rider's phone will ever pull it.**

Inserts don't need this — `DEFAULT now()` covers new rows automatically.

---

## Safe to hand-edit

Master data the app only ever *reads* via `/sync/masters` — nothing else in the system computes or derives these:

`branches`, `routes`, `warehouses`, `vans`, `users`, `customer_groups`, `customers`, `items`, `hsn_masters`, `item_batches`, `price_lists` / `price_list_lines`, `discount_headers` / `discount_lines`, `scheme_headers` / `scheme_applicability` / `scheme_order_items` / `scheme_offer_items`, `user_route_map`, `user_van_map`

## Do NOT hand-edit

Ledgers, derived counters, and idempotency state — hand-editing these desyncs them from data the backend maintains transactionally:

- `stock_ledger`, `van_stock` — `van_stock.current` is derived from the signed movements in `stock_ledger`; editing one without the other desyncs inventory.
- `invoices`, `invoice_series_blocks` — changing `lastUsedSeq` breaks offline invoice numbering and can produce duplicate invoice numbers.
- `sync_events` — idempotency keys already consumed by devices; deleting/editing one can let a replayed event apply twice.
- `orders` / `order_lines`, `payments`, `settlements` / `settlement_variances`, `erp_jobs`

**Unique constraints that will error (not warn) on a bad insert:** `day_trips` (one row per `userId` + `tripDate`), `settlements` (one row per `dayTripId`), and the `local_uuid` unique on `visits` / `orders` / `invoices` / `payments`.

---

## Two commands to never run against this DB

`.env` now points `DATABASE_URL` at the live Azure database, not a local sandbox. Both of these are one tab-complete away from `db:studio`:

- **`npm run db:seed`** — deletes every row from 45 tables (`src/db/seed.ts:39-52`) before inserting demo data.
- **`npm run db:migrate`** — not a migration runner; it's `drizzle-kit push`, which can drop columns/tables to force the DB to match `schema.ts`.

---

## If Studio fails to connect with an SSL/certificate error

`drizzle.config.ts` doesn't set an explicit `ssl` option (unlike the runtime client in `src/db/client.ts:18-20`, which special-cases Azure). Add:

```ts
dbCredentials: {
  url: process.env.DATABASE_URL ?? '…',
  ssl: { rejectUnauthorized: false },
},
```

(Not needed as of this writing — Studio connected without it.)
