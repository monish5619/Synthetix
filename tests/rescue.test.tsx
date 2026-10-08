import { renderToStaticMarkup } from 'react-dom/server';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alertHeadline, dealReason, policyExplanation, unreadCount } from '../src/alerts';
import { DealCard } from '../src/pages/MarketplacePage';
import { createApp } from '../server/app';
import { openDatabase, type Db } from '../server/db';
import { seedDemoShipment } from '../server/seed';
import type { MarketplaceRow } from '../server/views';

let db: Db;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;
let id: string;

beforeAll(async () => {
  db = openDatabase(':memory:');
  id = seedDemoShipment(db);
  server = createApp(db, { allowedOrigins: [], demoMode: true }).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
});

const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const listing = async () => ((await (await fetch(`${base}/api/marketplace`)).json()) as { listings: MarketplaceRow[] }).listings.find((l) => l.shipmentId === id)!;
const alerts = async () => ((await (await fetch(`${base}/api/alerts`)).json()) as { alerts: Array<{ shipmentId: string; acknowledgedAt: string | null }> }).alerts.filter((a) => a.shipmentId === id);
const claimsRows = () => (db.prepare('SELECT COUNT(*) n FROM listing_claims').get() as { n: number }).n;

describe('spoilage, markdown, listing, alert, rescue', () => {
  it('the spike automatically reprices the listing and raises an alert (policy unchanged)', async () => {
    await post(`/api/shipments/${id}/reset`);
    const before = await listing();
    expect(before.discountPct).toBe(0);
    expect(await alerts()).toHaveLength(0);

    await post(`/api/shipments/${id}/simulate-spike`);
    const after = await listing();
    expect(after).toMatchObject({ riskLevel: 'CRITICAL', discountPct: 35, currentPricePerKg: 65, originalPricePerKg: 100, listingStatus: 'LIQUIDATION' });
    expect(after.baselineShelfLifeHours).toBe(120);
    expect(await alerts()).toHaveLength(1);
  });

  it('claim: decreases stock atomically, locks the price, writes an audit event', async () => {
    const l = await listing();
    const res = await post(`/api/listings/${l.listingId}/claim`, { quantityKg: 100 });
    expect(res.status).toBe(201);
    const { claim } = await res.json();
    expect(claim).toMatchObject({ quantityKg: 100, pricePerKg: 65, discountPct: 35, totalValue: 6500 });
    const after = await listing();
    expect(after.availableKg).toBe(l.availableKg - 100);
    expect(after.claimedKg).toBe(100);
    expect(after.lotKg).toBe(l.lotKg);
    const audit = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE event_type = 'LISTING_CLAIMED' AND shipment_id = ?").get(id) as { n: number };
    expect(audit.n).toBe(1);
  });

  it('refuses more than what is left, and writes nothing', async () => {
    const l = await listing();
    const rows = claimsRows();
    const res = await post(`/api/listings/${l.listingId}/claim`, { quantityKg: l.availableKg + 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('INSUFFICIENT_STOCK');
    expect(claimsRows()).toBe(rows);
    expect((await listing()).availableKg).toBe(l.availableKg);
  });

  it.each([[0], [-5], ['ten'], [null]])('rejects quantity %j with 400', async (q) => {
    const l = await listing();
    const rows = claimsRows();
    expect((await post(`/api/listings/${l.listingId}/claim`, { quantityKg: q })).status).toBe(400);
    expect(claimsRows()).toBe(rows);
  });

  it('rejects a malformed and an unknown listing id', async () => {
    expect((await post('/api/listings/not-an-id/claim')).status).toBe(400);
    expect((await post('/api/listings/123e4567-e89b-12d3-a456-426614174000/claim')).status).toBe(404);
  });

  it('is idempotent with an Idempotency-Key: a repeat does not claim twice', async () => {
    const l = await listing();
    const key = { 'Idempotency-Key': 'claim-test-key-0001' };
    const a = await post(`/api/listings/${l.listingId}/claim`, { quantityKg: 10 }, key);
    const b = await post(`/api/listings/${l.listingId}/claim`, { quantityKg: 10 }, key);
    expect(a.status).toBe(201);
    expect((await b.json()).claim.claimId).toBe((await a.json()).claim.claimId);
    expect((await listing()).claimedKg).toBe(l.claimedKg + 10);
  });

  it('claiming the rest sells the listing out; a further claim is refused with SOLD_OUT', async () => {
    const l = await listing();
    expect((await post(`/api/listings/${l.listingId}/claim`)).status).toBe(201);
    expect((await listing()).availableKg).toBe(0);
    const again = await post(`/api/listings/${l.listingId}/claim`);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('SOLD_OUT');
  });

  it('claims keep the price they were made at, and reset clears the demo rescue', async () => {
    const locked = db.prepare('SELECT price_per_kg p FROM listing_claims WHERE shipment_id = ? ORDER BY created_at LIMIT 1').get(id) as { p: number };
    expect(locked.p).toBe(65);
    await post(`/api/shipments/${id}/reset`);
    const fresh = await listing();
    expect(fresh.claimedKg).toBe(0);
    expect(fresh.discountPct).toBe(0);
    expect(await alerts()).toHaveLength(0);
  });
});

describe('deal card and notification text', () => {
  const row = (over: Partial<MarketplaceRow> = {}): MarketplaceRow => ({
    listingId: 'l',
    shipmentId: 's',
    code: 'AS-1042',
    produce: 'Premium Tomatoes',
    origin: 'a',
    destination: 'b',
    remainingHours: 17.65,
    riskLevel: 'CRITICAL',
    originalPricePerKg: 100,
    currentPricePerKg: 65,
    discountPct: 35,
    listingStatus: 'LIQUIDATION',
    availableKg: 500,
    lotKg: 500,
    claimedKg: 0,
    baselineShelfLifeHours: 120,
    urgency: 'IMMEDIATE',
    updatedAt: '',
    ...over,
  });
  const card = (l: MarketplaceRow) => renderToStaticMarkup(<DealCard listing={l} busy={false} onClaim={() => {}} />);

  it('shows commodity, strike-through original, current price, reason chip and the Rescue action', () => {
    const m = card(row());
    expect(m).toContain('Premium Tomatoes');
    expect(m).toContain('<s ');
    expect(m).toContain('₹100');
    expect(m).toContain('₹65');
    expect(m).toContain('35% markdown • Critical shelf life');
    expect(m).toContain('Rescue deal');
    expect(m).toContain('CRITICAL');
  });
  it('does not repeat the markdown figures: the percentage appears once on the card', () => {
    expect(card(row()).match(/35%/g)).toHaveLength(1);
  });
  it('a normal listing says Claim and shows no strike-through', () => {
    const m = card(row({ discountPct: 0, currentPricePerKg: 100, riskLevel: 'NORMAL' }));
    expect(m).toContain('Claim');
    expect(m).not.toContain('<s ');
    expect(m).toContain('Full price • Healthy shelf life');
  });
  it('a sold-out listing says RESCUED and has no button', () => {
    const m = card(row({ availableKg: 0, claimedKg: 500 }));
    expect(m).toContain('RESCUED');
    expect(m).not.toContain('<button');
  });
  it('headline, unread count and the policy sentence come from stored fields', () => {
    expect(alertHeadline({ severity: 'CRITICAL', markdownPct: 35 })).toBe('Critical shelf life detected — markdown applied.');
    expect(unreadCount([{ acknowledgedAt: null }, { acknowledgedAt: 'x' }])).toBe(1);
    expect(dealReason(25, 'HIGH')).toBe('25% markdown • High risk shelf life');
    expect(policyExplanation()).toContain('Critical 35%');
  });
});
