// Tarang trading engine: orders, fills, margin, charges, positions.
// Pure logic, no DOM. Shared by the browser app and the tests.

export const TICK = 0.05;          // NSE equity tick size, in rupees
export const MIS_LEVERAGE = 5;     // intraday margin: 20% of order value
export const PRODUCTS = ['CNC', 'MIS'];
export const ORDER_TYPES = ['MARKET', 'LIMIT', 'SL-M'];

export const roundTick = (p) => Math.round(p / TICK) * TICK;
const r2 = (x) => Math.round(x * 100) / 100;

// Statutory and broker charges for one executed order, modelled on a
// discount broker's equity schedule. Rates are approximate and simulated.
export function computeCharges({ side, product, qty, price }) {
  const turnover = qty * price;
  const delivery = product === 'CNC';
  const brokerage = delivery ? 0 : Math.min(20, turnover * 0.0003);
  const stt = delivery ? turnover * 0.001 : side === 'SELL' ? turnover * 0.00025 : 0;
  const exchange = turnover * 0.0000297;
  const sebi = turnover * 0.000001;              // ₹10 per crore
  const stamp = side === 'BUY' ? turnover * (delivery ? 0.00015 : 0.00003) : 0;
  const gst = 0.18 * (brokerage + exchange + sebi);
  const parts = { brokerage, stt, exchange, sebi, stamp, gst };
  for (const k in parts) parts[k] = r2(parts[k]);
  const total = r2(Object.values(parts).reduce((a, b) => a + b, 0));
  return { ...parts, total, turnover: r2(turnover) };
}

const leverage = (product) => (product === 'MIS' ? MIS_LEVERAGE : 1);
const key = (symbol, product) => `${symbol}|${product}`;

export class Broker {
  constructor({ cash = 500000, now = () => Date.now() } = {}) {
    this.cash = cash;          // includes funds blocked by open orders
    this.deposited = cash;
    this.positions = {};       // key -> { symbol, product, qty (signed), avg, realized }
    this.orders = [];          // newest first
    this.trades = [];
    this.seq = 0;
    this.now = now;
  }

  position(symbol, product) {
    return this.positions[key(symbol, product)] || { symbol, product, qty: 0, avg: 0, realized: 0 };
  }

  get blocked() {
    return r2(this.orders.filter((o) => o.status === 'OPEN').reduce((s, o) => s + o.blocked, 0));
  }

  get available() {
    return r2(this.cash - this.blocked);
  }

  // Margin an order needs: only the part that opens or adds to a position.
  marginFor({ symbol, side, qty, product }, price) {
    const pos = this.position(symbol, product);
    const dir = side === 'BUY' ? 1 : -1;
    const closing = Math.sign(pos.qty) === -dir ? Math.min(Math.abs(pos.qty), qty) : 0;
    const opening = qty - closing;
    const charges = computeCharges({ side, product, qty, price }).total;
    return r2((opening * price) / leverage(product) + charges);
  }

  // Validate and place. Returns { ok, order?, error? }.
  place(req, ltp) {
    const o = {
      symbol: req.symbol,
      side: req.side,
      qty: Math.floor(Number(req.qty)),
      type: req.type || 'MARKET',
      product: req.product || 'CNC',
      price: req.price != null && req.price !== '' ? roundTick(Number(req.price)) : null,
      trigger: req.trigger != null && req.trigger !== '' ? roundTick(Number(req.trigger)) : null,
    };
    if (!['BUY', 'SELL'].includes(o.side)) return { ok: false, error: 'Choose Buy or Sell.' };
    if (!PRODUCTS.includes(o.product)) return { ok: false, error: 'Choose CNC or MIS.' };
    if (!ORDER_TYPES.includes(o.type)) return { ok: false, error: 'Unknown order type.' };
    if (!(o.qty >= 1)) return { ok: false, error: 'Quantity must be at least 1 share.' };
    if (o.type === 'LIMIT' && !(o.price > 0)) return { ok: false, error: 'Enter a limit price above ₹0.' };
    if (o.type === 'SL-M') {
      if (!(o.trigger > 0)) return { ok: false, error: 'Enter a trigger price above ₹0.' };
      if (o.side === 'BUY' && o.trigger <= ltp) return { ok: false, error: `A buy stop must trigger above the last price (₹${ltp.toFixed(2)}).` };
      if (o.side === 'SELL' && o.trigger >= ltp) return { ok: false, error: `A sell stop must trigger below the last price (₹${ltp.toFixed(2)}).` };
    }

    if (o.product === 'CNC' && o.side === 'SELL') {
      const held = this.position(o.symbol, 'CNC').qty;
      const pendingSells = this.orders
        .filter((x) => x.status === 'OPEN' && x.symbol === o.symbol && x.product === 'CNC' && x.side === 'SELL')
        .reduce((s, x) => s + x.qty, 0);
      if (o.qty > held - pendingSells) {
        return { ok: false, error: `You can sell up to ${Math.max(0, held - pendingSells)} ${o.symbol} from holdings. Use MIS to short intraday.` };
      }
    }

    const refPrice = o.type === 'LIMIT' ? o.price : o.type === 'SL-M' ? o.trigger : ltp;
    const need = this.marginFor(o, refPrice);
    if (need > this.available) {
      return { ok: false, error: `Needs ₹${need.toFixed(2)} margin; ₹${this.available.toFixed(2)} available.` };
    }

    const order = { ...o, id: `T${String(++this.seq).padStart(5, '0')}`, status: 'OPEN', placedAt: this.now(), blocked: need, fillPrice: null, filledAt: null };
    this.orders.unshift(order);
    this.tryFill(order, ltp);
    return { ok: true, order };
  }

  cancel(id) {
    const o = this.orders.find((x) => x.id === id);
    if (!o || o.status !== 'OPEN') return false;
    o.status = 'CANCELLED';
    o.blocked = 0;
    return true;
  }

  // Feed a new last traded price. Returns orders filled on this tick.
  tick(symbol, ltp) {
    const filled = [];
    for (const o of [...this.orders].reverse()) {
      if (o.status === 'OPEN' && o.symbol === symbol && this.tryFill(o, ltp)) filled.push(o);
    }
    return filled;
  }

  tryFill(o, ltp) {
    let go = false;
    if (o.type === 'MARKET') go = true;
    else if (o.type === 'LIMIT') go = o.side === 'BUY' ? ltp <= o.price : ltp >= o.price;
    else if (o.type === 'SL-M') go = o.side === 'BUY' ? ltp >= o.trigger : ltp <= o.trigger;
    if (!go) return false;

    // CNC sells can't exceed what is held at fill time.
    if (o.product === 'CNC' && o.side === 'SELL' && o.qty > this.position(o.symbol, 'CNC').qty) {
      o.status = 'REJECTED'; o.blocked = 0; o.reason = 'Holdings changed before the order filled.';
      return false;
    }
    o.blocked = 0;
    const need = this.marginFor(o, ltp);
    if (need > this.available) {
      o.status = 'REJECTED'; o.reason = 'Not enough margin at fill price.';
      return false;
    }
    this.applyFill(o, ltp);
    return true;
  }

  applyFill(o, price) {
    const lev = leverage(o.product);
    const k = key(o.symbol, o.product);
    const pos = this.positions[k] || { symbol: o.symbol, product: o.product, qty: 0, avg: 0, realized: 0 };
    const dir = o.side === 'BUY' ? 1 : -1;
    let qty = o.qty;
    let realized = 0;

    if (pos.qty !== 0 && Math.sign(pos.qty) === -dir) {
      const close = Math.min(Math.abs(pos.qty), qty);
      realized = close * (price - pos.avg) * Math.sign(pos.qty);
      this.cash += (close * pos.avg) / lev + realized;   // release margin, book P&L
      pos.qty += close * dir;
      qty -= close;
      if (pos.qty === 0) pos.avg = 0;
    }
    if (qty > 0) {
      const newQty = Math.abs(pos.qty) + qty;
      pos.avg = (Math.abs(pos.qty) * pos.avg + qty * price) / newQty;
      pos.qty += qty * dir;
      this.cash -= (qty * price) / lev;
    }

    const charges = computeCharges({ side: o.side, product: o.product, qty: o.qty, price });
    this.cash = r2(this.cash - charges.total);
    pos.realized = r2(pos.realized + realized - charges.total);
    this.positions[k] = pos;

    o.status = 'COMPLETE';
    o.fillPrice = price;
    o.filledAt = this.now();
    o.charges = charges.total;
    this.trades.unshift({ orderId: o.id, symbol: o.symbol, side: o.side, product: o.product, qty: o.qty, price, charges: charges.total, realized: r2(realized), at: o.filledAt });
  }

  // Close an open position at the given price with a market order.
  squareOff(symbol, product, ltp) {
    const pos = this.position(symbol, product);
    if (!pos.qty) return { ok: false, error: 'No open position.' };
    return this.place({ symbol, product, side: pos.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(pos.qty), type: 'MARKET' }, ltp);
  }

  addFunds(amount) {
    const a = r2(Number(amount));
    if (!(a > 0)) return false;
    this.cash = r2(this.cash + a);
    this.deposited = r2(this.deposited + a);
    return true;
  }

  // Valuation at current prices. prices: { SYMBOL: ltp }
  summary(prices) {
    let invested = 0, current = 0, unrealized = 0, marginUsed = 0, realized = 0;
    const rows = Object.values(this.positions).map((p) => {
      const ltp = prices[p.symbol] ?? p.avg;
      const pnl = r2(p.qty * (ltp - p.avg));
      realized += p.realized;
      if (p.qty !== 0) {
        const lev = leverage(p.product);
        marginUsed += (Math.abs(p.qty) * p.avg) / lev;
        unrealized += pnl;
        if (p.product === 'CNC') { invested += p.qty * p.avg; current += p.qty * ltp; }
      }
      return { ...p, ltp, pnl, value: r2(p.qty * ltp) };
    });
    const equity = r2(this.cash + marginUsed + unrealized);
    return {
      rows,
      cash: r2(this.cash),
      available: this.available,
      blocked: this.blocked,
      marginUsed: r2(marginUsed),
      invested: r2(invested),
      current: r2(current),
      unrealized: r2(unrealized),
      realized: r2(realized),
      equity,
      totalPnl: r2(equity - this.deposited),
    };
  }

  toJSON() {
    const { cash, deposited, positions, orders, trades, seq } = this;
    return { cash, deposited, positions, orders, trades, seq };
  }

  static fromJSON(data, opts) {
    const b = new Broker(opts);
    Object.assign(b, data);
    return b;
  }
}
