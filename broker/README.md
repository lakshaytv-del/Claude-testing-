# Tarang: paper-trading stock broker

A browser stock broking app for practice trading on a simulated NSE feed. It has no dependencies and no backend. Open it from any static server; account state is saved in the browser's `localStorage`.

```
npm run serve      # python3 -m http.server 8080, then open http://localhost:8080
npm test           # 13 engine and market tests (node:test)
```

## What it does

- **Watchlist** of 12 large-cap NSE stocks with live-updating prices, day change and search.
- **Quote view**: intraday chart over the 09:15–15:30 session with previous close, OHLC, volume and 5-level market depth.
- **Order ticket**: Buy/Sell, CNC (delivery) or MIS (intraday at 5× leverage), Market, Limit or SL-M stop orders. It shows order value, margin required and a charges breakdown before you place the order.
- **Positions** (MIS) with unrealised and realised P&L and one-click square off. Intraday shorts are allowed.
- **Holdings** (CNC) with average cost, invested and current value, P&L and day change.
- **Orders** with cancel for open orders, plus a **Trades** log with charges and realised P&L per fill.
- **Funds**: available margin, cash, funds blocked by open orders, add virtual funds, reset account.

A new account starts with ₹5,00,000 and a few example trades so every tab has content.

## Rules the engine enforces

| Rule | Detail |
| --- | --- |
| Tick size | Prices round to ₹0.05 |
| Margin | CNC needs full value; MIS needs 1/5. Closing a position needs no new margin |
| Short selling | Only intraday (MIS). CNC sells are capped at holdings minus pending sells |
| Open orders | Block their margin until filled or cancelled |
| Limit fills | Buy fills when LTP ≤ limit, sell when LTP ≥ limit, at the LTP |
| SL-M | Buy trigger must be above LTP, sell trigger below; fills at market once crossed |
| Charges | Brokerage ₹0 delivery, min(₹20, 0.03%) intraday; STT 0.1% delivery both sides, 0.025% intraday sell; exchange 0.00297%; SEBI ₹10/crore; stamp 0.015% delivery buy, 0.003% intraday buy; GST 18% on brokerage + exchange + SEBI |

Rates are approximate and for practice only.

## Files

| File | What it holds |
| --- | --- |
| `engine.mjs` | `Broker` class: validation, margin, order matching, fills, P&L, charges, JSON save/restore |
| `market.mjs` | Seeded random-walk price feed, the stock list, synthetic market depth |
| `app-deps.mjs` | Re-exports both for the page |
| `index.html` | The trading screen (plain HTML, CSS and an ES module) |
| `engine.test.mjs` | Tests for charges, fills, margin, shorts, limit and stop orders, cancel, persistence |

## Not included

Real market data, a real exchange or broker connection, user login, F&O, and end-of-day MIS auto square-off. Connecting to a live broker API (Kite Connect, Upstox, etc.) would replace `market.mjs` with a quote stream and route `Broker.place` to the broker's order endpoint.
