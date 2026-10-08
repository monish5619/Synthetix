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
| GET | `/api/shipment` | Demo shipment state (seeds on first call) |
| GET | `/api/shipments/:id` | Full state for a shipment |
| POST | `/api/shipments/:id/telemetry` | Ingest a reading: `{ temperatureC, humidityPct, intervalHours, source? }` |
| POST | `/api/shipments/:id/reset` | Restore the initial state, keeping the same id |
| GET | `/api/health` | Liveness check |

Telemetry validation: temperature −40 to 60 °C, humidity 0 to 100%, interval above 0 and up to 24 h. Malformed JSON gets a 400, and bodies over 10 KB get a 413. Each telemetry event runs in a single database transaction, so a failure leaves no partial state.

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
