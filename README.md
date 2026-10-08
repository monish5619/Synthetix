# AgroSense

**Predictive cold-chain intelligence for perishable produce.**

AgroSense monitors a refrigerated shipment, recalculates the remaining shelf life from simulated telemetry, and reprices the produce for local retailers before it spoils. The whole system runs in software: telemetry is simulated in the app and passed through the ingest API. No sensors or hardware are involved.

## The workflow

1. The shipment starts at **120 h** of shelf life, **LOW** risk, and the marketplace price is **₹100/kg**.
2. **Simulate ambient temperature spike** sends a real `POST` from the browser to `/api/shipments/:id/telemetry`.
3. The server validates the event, stores it, and recalculates degradation.
4. Shelf life drops to about **18 h**, risk becomes **CRITICAL**, and a liquidation recommendation is created.
5. The listing reprices to about **₹66/kg** (34% off). A retailer alert and audit entries are written.
6. Everything is persisted to SQLite, so a browser refresh shows the same state.

## The model

It is deterministic and does not use an LLM or ML. It is a Q10-style equivalent-ageing model:

```
thermal multiplier   = Q10 ^ ((T − Tref) / 10)              Q10 = 2.5, Tref = 4 °C
humidity multiplier  = 1 + 0.01 × max(0, RH − 60)
ageing rate          = thermal × humidity
damage              += interval_hours × ageing rate          (reference hours spent)
remaining shelf life = (120 − damage) ÷ current ageing rate  (hours at current conditions)
cover (margin)       = remaining shelf life ÷ remaining transit hours
risk                 = critical < 1.00 · high < 1.25 · moderate < 2.00 · low ≥ 2.00
```

Liquidation triggers at HIGH or CRITICAL risk. The markdown is `10 + 50 × (1 − cover)`, capped at 60%. Discounts only deepen, so a later normal reading does not raise the price back.

The UI's "Degradation chain" panel shows each step with its live inputs.

## Stack

- **Server:** Node.js with Express 5, TypeScript run by `tsx`
- **Database:** SQLite through Node's built-in `node:sqlite`. There are no native build steps.
- **Frontend:** React 19 with Vite
- **Tests:** Vitest. The model math and the full API workflow are covered.

## Run it

Requires Node 22.13 or newer (tested on Node 24).

```bash
npm install
npm run dev        # http://localhost:8787 (API and Vite in one process)
npm test           # model + API tests against an in-memory database
npm run typecheck
npm run build      # typecheck + production bundle in dist/
npm start          # production: serves dist/ and the API
```

Set `PORT` or `DATABASE_PATH` to override the defaults. The database defaults to `data/agrosense.db` and is git-ignored.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/health` | Liveness plus a live database check |
| GET | `/api/shipments` | Persisted shipments with current summary |
| GET | `/api/shipments/:id` | Current state: shipment, assessment, listing, recommendations, alerts, audit |
| GET | `/api/shipments/:id/telemetry` | Every persisted telemetry event for the shipment, oldest first |
| POST | `/api/telemetry` | Ingest a reading: `{ shipmentId, temperature, humidity, transitDuration }` |
| POST | `/api/shipments/:id/reset` | Demo only. Restores the demo shipment to its initial state, same id |

Telemetry rules: `shipmentId` is required and must be a known id. `temperature` is a finite number from −40 to 60 °C. `humidity` is a finite number from 0 to 100 %. `transitDuration` is a finite number from 0 to 24 h, meaning hours since the previous reading. Unknown fields are rejected. A reading is persisted only if the whole pipeline succeeds.

Errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Telemetry request is invalid.", "details": ["humidity must be between 0 and 100."] } }
```

| Status | Code | When |
| ------ | ---- | ---- |
| 400 | `VALIDATION_ERROR` | Field missing, wrong type, out of range, or unknown |
| 400 | `MALFORMED_JSON` | Body is not valid JSON |
| 400 | `INVALID_ID` | Path id is not a valid id |
| 403 | `RESET_NOT_ALLOWED` | Reset requested for a shipment other than the demo |
| 404 | `NOT_FOUND` | Unknown shipment |
| 404 | `ROUTE_NOT_FOUND` | Unknown API route |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10 KB |
| 500 | `INTERNAL_ERROR` | Anything unexpected. The message is generic. |

Stack traces, SQL, database paths, and secrets never appear in responses. Only the error class is logged server-side.

## Security notes

- Secrets and database paths are read from environment variables on the server only. No server code is imported by the client bundle, and only `import type` references cross the boundary.
- Internal errors return a generic 500 message. Only the error name is logged.
- All inputs are validated before any write.

## Layout

```
server/   Express app, degradation model, ingest pipeline, SQLite schema and seed
shared/   Telemetry presets used by both the UI and tests
src/      React control tower (App.tsx, styles.css, api client)
tests/    Vitest suites for the model and the API
```
