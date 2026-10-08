# AgroSense

**Predictive cold-chain intelligence for perishable produce.**

AgroSense monitors a refrigerated shipment, recalculates the remaining shelf life from simulated telemetry, and reprices the produce for local retailers before it spoils. The whole system runs in software: telemetry is simulated in the app and passed through the ingest API. No sensors or hardware are involved.

## The workflow

1. The shipment starts at **120 h** of shelf life, **NORMAL** risk, and the marketplace price is **₹100/kg**.
2. **Simulate ambient temperature spike** calls `POST /api/shipments/:id/simulate-spike`. The server generates the reading, so the browser sends no values.
3. The server validates the event, stores it, and recalculates degradation.
4. Shelf life drops to **17.65 h** (≈18 h), risk becomes **CRITICAL**, and a liquidation recommendation is created.
5. The listing reprices to **₹65/kg** (35% off). A retailer alert and audit entries are written.
6. Everything is persisted to SQLite, so a browser refresh shows the same state.

## The model

The decision engine is deterministic and explainable. There is no ML and no LLM. Every tunable number lives in [server/config.ts](server/config.ts).

```
temperatureStress      = Q10 ^ ((T − idealTemperature) / 10)          Q10 = 2.5, ideal = 4 °C
humidityFactor         = 1 + humidityPenaltyPerPct × max(0, RH − 60)   0.02 per point
equivalentAgeIncrement = exposureHours × temperatureStress × humidityFactor × calibration
cumulativeEquivalentAge += equivalentAgeIncrement                      calibration = 1.0 (uncalibrated)
remainingHours         = max(0, baselineShelfLife − cumulativeEquivalentAge)   baseline = 120 h
```

Risk bands on remaining hours: **NORMAL** above 72 h, **WATCH** 36–72 h, **HIGH** 18–36 h, **CRITICAL** below 18 h.

Liquidation policy: NORMAL 0%, WATCH 10%, HIGH 25%, CRITICAL 35%. Discounts only deepen. Each recommendation carries the risk level, markdown, original and recommended prices, urgency, a reason built from the model's drivers, and a retailer action.

**Official scenario:** 120 h at 4 °C. A 6.3 h ambient excursion at 30 °C and 85 % RH adds 102.35 h of equivalent ageing (stress 10.83 × humidity 1.50 × 6.3 h), leaving **17.65 h**: CRITICAL, 35% off, ₹100 → ₹65/kg. The coefficients are not tuned. The 6.3 h excursion length is the scenario input, chosen to represent a realistic thermal event that lands at about 18 h.

Every run is stored as a snapshot with its full decomposition, and each step writes an audit event.

## Stack

- **Server:** Node.js with Express 5, TypeScript run by `tsx`
- **Database:** SQLite through Node's built-in `node:sqlite`. There are no native build steps.
- **Frontend:** React 19 with Vite
- **Tests:** Vitest, 59 tests. Model scenarios, the liquidation and alert engine, the official scenario, the primary-action endpoint, and the full API workflow.

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
| GET | `/api/health` | Live check of the telemetry API, database, and both engines, each verified by a known-answer test |
| GET | `/api/shipments` | Persisted shipments with current summary |
| GET | `/api/shipments/:id` | Current state: shipment, assessment, listing, recommendations, alerts, audit |
| GET | `/api/shipments/:id/telemetry` | Every persisted telemetry event for the shipment, oldest first |
| GET | `/api/marketplace` | Every listing: price, markdown, risk, remaining shelf life, urgency. Read from the marketplace table |
| GET | `/api/alerts` | Every spoilage alert, with the recommended action and markdown from the recommendation it belongs to |
| GET | `/api/shipments/:id/telemetry-history` | Each telemetry event joined to the snapshot it produced, classified as normal telemetry or thermal excursion |
| POST | `/api/telemetry` | Ingest an external reading: `{ shipmentId, temperature, humidity, transitDuration }` |
| POST | `/api/shipments/:id/simulate-spike` | Primary demo action. The server generates the thermal event, runs the full pipeline, and returns the complete state |
| POST | `/api/shipments/:id/simulate-normal` | Generates a normal reading through the same pipeline |
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

## Screens

Hash routes, one page each: `#/` Control Tower, `#/marketplace` listings, `#/telemetry` history and the operational event timeline, `#/alerts` spoilage alerts. Secondary screens poll every 4 seconds, so a spike on the Control Tower reaches them without a reload.

## Security notes

- Secrets and database paths are read from environment variables on the server only. No server code is imported by the client bundle, and only `import type` references cross the boundary.
- Internal errors return a generic 500 message. Only the error name is logged.
- All inputs are validated before any write.

## Layout

```
server/   Express app, degradation model, ingest pipeline, SQLite schema and seed
shared/   Telemetry presets used by both the UI and tests
src/      React control tower: App.tsx (state and actions), components/ (Masthead, Hero, ActionBar, Timeline, Liquidation, Explain, Activity), hooks.ts, styles.css
tests/    Vitest suites for the model and the API
```
