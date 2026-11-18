import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broker, computeCharges, roundTick } from './engine.mjs';
import { Market } from './market.mjs';

const near = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('delivery charges: no brokerage, 0.1% STT, stamp duty on buy only', () => {
  const buy = computeCharges({ side: 'BUY', product: 'CNC', qty: 100, price: 1000 });
  assert.equal(buy.brokerage, 0);
  assert.equal(buy.stt, 100);
  assert.equal(buy.stamp, 15);
  const sell = computeCharges({ side: 'SELL', product: 'CNC', qty: 100, price: 1000 });
  assert.equal(sell.stamp, 0);
  assert.equal(sell.stt, 100);
});

test('intraday brokerage is capped at ₹20 and STT applies on sell only', () => {
  const big = computeCharges({ side: 'BUY', product: 'MIS', qty: 1000, price: 1000 });
  assert.equal(big.brokerage, 20);
  assert.equal(big.stt, 0);
  const small = computeCharges({ side: 'SELL', product: 'MIS', qty: 10, price: 100 });
  assert.equal(small.brokerage, 0.3);
  assert.equal(small.stt, 0.25);
});

test('prices round to the ₹0.05 tick', () => {
  near(roundTick(101.03), 101.05, 1e-9);
  near(roundTick(101.02), 101.0, 1e-9);
});

test('CNC market buy debits full value plus charges and creates a holding', () => {
  const b = new Broker({ cash: 100000 });
  const r = b.place({ symbol: 'ITC', side: 'BUY', qty: 10, type: 'MARKET', product: 'CNC' }, 400);
  assert.ok(r.ok);
  assert.equal(r.order.status, 'COMPLETE');
  const ch = computeCharges({ side: 'BUY', product: 'CNC', qty: 10, price: 400 }).total;
  near(b.cash, 100000 - 4000 - ch);
  assert.equal(b.position('ITC', 'CNC').qty, 10);
});

test('round trip books realized P&L net of charges and equity reconciles', () => {
  const b = new Broker({ cash: 100000 });
  b.place({ symbol: 'ITC', side: 'BUY', qty: 10, type: 'MARKET', product: 'CNC' }, 400);
  b.place({ symbol: 'ITC', side: 'SELL', qty: 10, type: 'MARKET', product: 'CNC' }, 420);
  const c1 = computeCharges({ side: 'BUY', product: 'CNC', qty: 10, price: 400 }).total;
  const c2 = computeCharges({ side: 'SELL', product: 'CNC', qty: 10, price: 420 }).total;
  near(b.cash, 100000 + 200 - c1 - c2);
  near(b.position('ITC', 'CNC').realized, 200 - c1 - c2);
  const s = b.summary({ ITC: 420 });
  near(s.totalPnl, 200 - c1 - c2);
});

test('cannot sell more CNC shares than held', () => {
  const b = new Broker({ cash: 100000 });
  b.place({ symbol: 'TCS', side: 'BUY', qty: 2, type: 'MARKET', product: 'CNC' }, 3000);
  const r = b.place({ symbol: 'TCS', side: 'SELL', qty: 3, type: 'MARKET', product: 'CNC' }, 3000);
  assert.equal(r.ok, false);
  assert.match(r.error, /up to 2/);
});

test('MIS blocks 20% margin and allows intraday shorts', () => {
  const b = new Broker({ cash: 100000 });
  const r = b.place({ symbol: 'SBIN', side: 'SELL', qty: 100, type: 'MARKET', product: 'MIS' }, 900);
  assert.ok(r.ok);
  const s = b.summary({ SBIN: 900 });
  near(s.marginUsed, 18000);
  assert.equal(b.position('SBIN', 'MIS').qty, -100);
  // price falls: short is in profit
  near(b.summary({ SBIN: 880 }).unrealized, 2000);
  const sq = b.squareOff('SBIN', 'MIS', 880);
  assert.ok(sq.ok);
  assert.equal(b.position('SBIN', 'MIS').qty, 0);
  near(b.summary({ SBIN: 880 }).marginUsed, 0);
});

test('rejects orders beyond available margin', () => {
  const b = new Broker({ cash: 10000 });
  const r = b.place({ symbol: 'MARUTI', side: 'BUY', qty: 1, type: 'MARKET', product: 'CNC' }, 15000);
  assert.equal(r.ok, false);
  assert.match(r.error, /margin/);
  // but MIS at 5x fits
  assert.ok(b.place({ symbol: 'MARUTI', side: 'BUY', qty: 1, type: 'MARKET', product: 'MIS' }, 15000).ok);
});

test('limit buy waits, blocks funds, then fills when price crosses', () => {
  const b = new Broker({ cash: 100000 });
  const r = b.place({ symbol: 'INFY', side: 'BUY', qty: 10, type: 'LIMIT', price: 1500, product: 'CNC' }, 1520);
  assert.equal(r.order.status, 'OPEN');
  assert.ok(b.blocked > 15000);
  assert.ok(b.available < 85000);
  assert.equal(b.tick('INFY', 1505).length, 0);
  const filled = b.tick('INFY', 1499.5);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].fillPrice, 1499.5);
  assert.equal(b.blocked, 0);
});

test('cancel releases blocked funds', () => {
  const b = new Broker({ cash: 100000 });
  const { order } = b.place({ symbol: 'INFY', side: 'BUY', qty: 10, type: 'LIMIT', price: 1500, product: 'CNC' }, 1520);
  assert.ok(b.cancel(order.id));
  assert.equal(b.available, 100000);
  assert.equal(b.cancel(order.id), false);
});

test('SL-M sell triggers below the last price', () => {
  const b = new Broker({ cash: 100000 });
  b.place({ symbol: 'LT', side: 'BUY', qty: 5, type: 'MARKET', product: 'CNC' }, 4000);
  const bad = b.place({ symbol: 'LT', side: 'SELL', qty: 5, type: 'SL-M', trigger: 4050, product: 'CNC' }, 4000);
  assert.equal(bad.ok, false);
  const { order } = b.place({ symbol: 'LT', side: 'SELL', qty: 5, type: 'SL-M', trigger: 3900, product: 'CNC' }, 4000);
  assert.equal(order.status, 'OPEN');
  b.tick('LT', 3950);
  assert.equal(order.status, 'OPEN');
  b.tick('LT', 3895);
  assert.equal(order.status, 'COMPLETE');
  assert.equal(b.position('LT', 'CNC').qty, 0);
});

test('state survives a JSON round trip', () => {
  const b = new Broker({ cash: 50000 });
  b.place({ symbol: 'ITC', side: 'BUY', qty: 3, type: 'MARKET', product: 'CNC' }, 400);
  const c = Broker.fromJSON(JSON.parse(JSON.stringify(b)));
  assert.equal(c.position('ITC', 'CNC').qty, 3);
  assert.equal(c.cash, b.cash);
});

test('seeded market is repeatable, on tick, and restores from saved state', () => {
  const a = new Market({ seed: 3 }), b = new Market({ seed: 3 });
  assert.deepEqual(a.prices(), b.prices());
  for (const p of Object.values(a.step())) near(p, roundTick(p), 1e-6);
  const c = new Market({ state: JSON.parse(JSON.stringify(a)) });
  assert.deepEqual(c.prices(), a.prices());
  assert.equal(a.depth('TCS').bids.length, 5);
});
