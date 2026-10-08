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
- **Tests:** Vitest. See "Architecture" for what is covered.

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

Hash routes, one page each. The Control Tower opens with the product thesis, then a shipment story: produce healthy, thermal event, shelf life collapses, risk rises, business decision, marketplace reprices, retailer can act. Every stage lights only when a stored record shows it happened. The journey strip draws the route to scale, coloured by the temperature recorded across each stretch. Other pages: `#/marketplace` listings, `#/telemetry` history and the operational event timeline, `#/alerts` spoilage alerts. Secondary screens poll every 4 seconds, so a spike on the Control Tower reaches them without a reload.

## Configuration and security

Configuration comes from environment variables, read once at startup by `server/env.ts`. A bad value stops the server with a message naming the variable, but never its value. Copy [.env.example](.env.example) to `.env` for local settings. `.env` is git-ignored, so real values never reach the repository.

| Variable | Scope | Purpose |
| -------- | ----- | ------- |
| `NODE_ENV` | server | `development`, `production`, or `test` |
| `PORT` | server | Listen port, 1 to 65535 |
| `DATABASE_PATH` | server | SQLite file. The path is never sent to the browser |
| `ALLOWED_ORIGINS` | server | Exact origins allowed to call the API cross-origin. Empty means same-origin. No wildcards. HTTPS only in production |
| `DEMO_MODE` | server | Enables the scripted demo endpoints. Defaults to off in production |
| `VITE_API_BASE_URL` | build, **public** | Optional separate API origin for the UI. Embedded in the bundle, so it must never hold a secret |

Secrets and database credentials belong only in server-side variables. Anything prefixed `VITE_` is public, because Vite embeds it in the browser bundle. The production bundle was checked for server-only identifiers (`DATABASE_PATH`, `ALLOWED_ORIGINS`, `DEMO_MODE`, `node:sqlite`, `process.env`) and for localhost references. None were found.

**Browser security**

- The API is same-origin by default. CORS allows only exact origins listed in `ALLOWED_ORIGINS`, with no credentials. Requests from any other origin receive no CORS headers, so the browser blocks them.
- Production pages send a Content-Security-Policy that limits scripts to the same origin and forbids framing.
- Every API response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store`. Live operational data is never cached.

**Input validation**

- Shipment ids must be well-formed UUIDs. Unknown fields are rejected.
- Temperature must be a finite number from −40 to 60 °C. Humidity must be a finite number from 0 to 100 %. Transit duration must be a finite number from 0 to 24 h. NaN, Infinity, and negative values are refused.
- Prices must be finite, above 0, and at most 100 000 ₹/kg. Markdowns must be whole numbers from 0 to 60 %. The liquidation engine checks these itself, so bad values cannot reach the marketplace.
- Idempotency keys must be 8 to 128 safe characters. A request body is limited to 10 KB.

**Errors**

Every error returns `{ "error": { "code", "message", "details?" } }`. Stack traces, SQL, file paths, and internal messages are never sent to the browser or the log. The log records only the error class.

| Situation | Status | Code |
| --- | --- | --- |
| Invalid request | 400 | `VALIDATION_ERROR`, `MALFORMED_JSON`, `INVALID_ID` |
| Unknown shipment | 404 | `NOT_FOUND` |
| Demo control in production | 403 | `DEMO_DISABLED` |
| Key reused for a different request | 409 | `IDEMPOTENCY_CONFLICT` |
| Database unavailable | 503 | `DATABASE_UNAVAILABLE` |
| Model or engine failure | 500 | `MODEL_FAILURE`, with nothing saved |
| Anything unexpected | 500 | `INTERNAL_ERROR` |

**Data integrity**

- Each telemetry write runs in one transaction. A failure at any step rolls back every row. A failed model run leaves no partial state.
- A request with an `Idempotency-Key` header is recorded at most once. A retry with the same key and body returns the original result and writes nothing new. A reused key with a different body is refused.
- The audit trail records every step: `TELEMETRY_RECEIVED`, `SHELF_LIFE_RECALCULATED`, `RISK_ESCALATED`, `LIQUIDATION_RECOMMENDED`, `MARKETPLACE_UPDATED`, `RETAILER_ALERT_GENERATED`.

**Database connection**

The browser never connects to the database. Only the server opens it, using a path from its own environment. The database is opened with foreign keys enforced, and it is closed cleanly on shutdown.

## Layout

```
server/   Express app, degradation model, ingest pipeline, SQLite schema and seed
shared/   Telemetry presets used by both the UI and tests
src/      React control tower: App.tsx (state and actions), components/ (Masthead, Hero, ActionBar, Timeline, Liquidation, Explain, Activity), hooks.ts, styles.css
tests/    Vitest suites for the model and the API
```

## Three-minute judge demo

1. `npm run build && npm run dev`, then open http://localhost:8787 (demo mode is on by default outside production).
2. On the **Control Tower**, click **RUN 3-MIN JUDGE DEMO**. A 7-step tracker runs on the real backend; each headline is copied from a server response:
   1. **Reset**: the demo shipment returns to 120 h, NORMAL.
   2. **Normal shipment**: 120.0 h · NORMAL, read from the database.
   3. **Spike**: 30 °C, 85% RH. The server previews first (nothing saved), then commits through the telemetry pipeline. Temperature ×10.83, humidity ×1.50, +102.35 h ageing.
   4. **Shelf life collapses**: 17.7 h · CRITICAL.
   5. **Automatic markdown**: 35% off, ₹100 → ₹65/kg.
   6. **Deal and alert**: the listing is repriced and a retailer alert exists (delivery is simulated: no SMS or WhatsApp provider).
   7. **Rescue**: the retailer claims the stock; the quantity drops atomically and the card says RESCUED.
3. Refresh the page: the state is on the server, not in the browser. Check **Marketplace**, **Alerts** (and the bell), **Telemetry** and **Fleet**.
4. Open **Why did shelf life drop?** on the Control Tower for the model's working with the stored values, or the **Telemetry simulator** to preview and commit your own readings.

If a step cannot be confirmed by the server (no markdown, no listing, no alert) the tracker turns that step red and stops. It never shows success it did not get.

## Architecture

```
Browser (React)  ──HTTP──▶  Express API  ──▶  ingest pipeline (one SQLite transaction)
   ▲  SSE "changed" nudge       │               telemetry event → degradation model → snapshot
   └────────────────────────────┘               → risk → liquidation → listing → alert → audit
```

- The **model, risk bands and markdown policy** live only in `server/` and are deterministic (see above). The UI never recomputes them: it renders stored rows or `POST /api/shipments/:id/preview`, which runs the same functions read-only.
- **Writes** go through one pipeline transaction, so a reading is stored in full or not at all. Browser demo routes (`simulate`, `preview`, `reset`) are gated by `DEMO_MODE`; `POST /api/telemetry` needs the `X-Ingest-Key`, which the browser never holds.
- **Claims** (`POST /api/listings/:id/claim`) check and decrease stock in one transaction and are idempotent with an `Idempotency-Key`. There is no login yet; role-based auth is deferred.
- **`GET /api/stream`** (server-sent events) only says "something changed"; clients refetch from the normal API, and everything still works by polling if the stream is down.
- **Fleet** shipments are seeded only in demo mode, through the real pipeline.

Run the tests with `npm test` (332 tests: model, pipeline, API, security, preview, claims, demo runner, UI states).
