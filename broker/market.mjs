// Simulated NSE-style price feed. Seeded geometric Brownian motion so
// runs are repeatable in tests. Prices are invented, not live quotes.
import { roundTick } from './engine.mjs';

export const UNIVERSE = [
  { symbol: 'RELIANCE',   name: 'Reliance Industries',      sector: 'Energy',     price: 1412.6, vol: 0.22 },
  { symbol: 'TCS',        name: 'Tata Consultancy Services', sector: 'IT',        price: 3168.4, vol: 0.20 },
  { symbol: 'HDFCBANK',   name: 'HDFC Bank',                sector: 'Banks',      price: 1001.35, vol: 0.18 },
  { symbol: 'INFY',       name: 'Infosys',                  sector: 'IT',         price: 1521.9, vol: 0.24 },
  { symbol: 'ICICIBANK',  name: 'ICICI Bank',               sector: 'Banks',      price: 1388.15, vol: 0.20 },
  { symbol: 'SBIN',       name: 'State Bank of India',      sector: 'Banks',      price: 942.7, vol: 0.26 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel',            sector: 'Telecom',    price: 2054.3, vol: 0.21 },
  { symbol: 'ITC',        name: 'ITC',                      sector: 'FMCG',       price: 408.95, vol: 0.17 },
  { symbol: 'LT',         name: 'Larsen & Toubro',          sector: 'Capital goods', price: 3987.5, vol: 0.23 },
  { symbol: 'MARUTI',     name: 'Maruti Suzuki',            sector: 'Auto',       price: 15840.0, vol: 0.25 },
  { symbol: 'SUNPHARMA',  name: 'Sun Pharmaceutical',       sector: 'Pharma',     price: 1702.25, vol: 0.22 },
  { symbol: 'TATASTEEL',  name: 'Tata Steel',               sector: 'Metals',     price: 171.4, vol: 0.32 },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TICK_FLOOR = 0.05;

// One tick ≈ one simulated minute of a 375-minute NSE session.
const DT = 1 / (252 * 375);

export class Market {
  constructor({ seed = 7, universe = UNIVERSE, history = 180, state = null } = {}) {
    this.rand = mulberry32(seed);
    this.quotes = {};
    for (const u of universe) {
      const s = state?.[u.symbol];
      const open = s?.open ?? u.price;
      this.quotes[u.symbol] = {
        ...u,
        open,
        prevClose: s?.prevClose ?? roundTick(u.price * (1 + (this.rand() - 0.5) * 0.02)),
        ltp: s?.ltp ?? open,
        high: s?.high ?? open,
        low: s?.low ?? open,
        volume: s?.volume ?? 0,
        series: s?.series ? [...s.series] : [open],
      };
    }
    if (!state) for (let i = 0; i < history; i++) this.step();
  }

  step() {
    for (const q of Object.values(this.quotes)) {
      const shock = gaussian(this.rand) * q.vol * Math.sqrt(DT) * 6; // amplified so the demo moves
      q.ltp = Math.max(TICK_FLOOR, roundTick(q.ltp * Math.exp(shock)));
      q.high = Math.max(q.high, q.ltp);
      q.low = Math.min(q.low, q.ltp);
      q.volume += Math.floor(this.rand() * 4000) + 200;
      q.series.push(q.ltp);
      if (q.series.length > 375) q.series.shift();
    }
    return this.prices();
  }

  prices() {
    return Object.fromEntries(Object.values(this.quotes).map((q) => [q.symbol, q.ltp]));
  }

  // Simple synthetic depth: five levels each side around the last price.
  depth(symbol) {
    const q = this.quotes[symbol];
    const lvl = (i, side) => ({
      price: roundTick(q.ltp + (side === 'bid' ? -1 : 1) * 0.05 * (i + 1) * Math.max(1, Math.round(q.ltp / 1000))),
      qty: 50 + Math.floor(this.rand() * 1500),
      orders: 1 + Math.floor(this.rand() * 30),
    });
    return { bids: [0, 1, 2, 3, 4].map((i) => lvl(i, 'bid')), asks: [0, 1, 2, 3, 4].map((i) => lvl(i, 'ask')) };
  }

  toJSON() {
    return Object.fromEntries(Object.values(this.quotes).map(({ symbol, open, prevClose, ltp, high, low, volume, series }) => [symbol, { open, prevClose, ltp, high, low, volume, series }]));
  }
}

