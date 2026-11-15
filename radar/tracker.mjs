// Build the circular tracker page from the live RBI site.
// Fetches the Notifications RSS and listing page, backfills listing rows the feed
// no longer carries (by Id, guarded on title + PDF link), walks further down by Id
// until circulars fall outside the window, scores everything, and writes:
//   report/circular-tracker.html   standalone page (open in any browser)
//   report/tracker-data.json       the data behind it
// Usage: NODE_USE_ENV_PROXY=1 node tracker.mjs [--days 30]   (env var only needed behind a proxy)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseFeed, parseListing, parseNotificationPage, backfillMatches, scoreItem, THRESHOLD } from './radar.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const BASE = 'https://www.rbi.org.in/Scripts/';
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 30;

async function get(url, tries = 3) {
  for (let n = 1; ; n++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (n >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
    }
  }
}

const istToday = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const cutoff = new Date(Date.parse(istToday) - (days - 1) * 86400e3).toISOString().slice(0, 10);
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const listingDate = (d) => (d ? `${d.slice(8)}-${MON[d.slice(0, 3)]}-${d.slice(4, 6)}` : null);

const [xml, html] = await Promise.all([get('https://rbi.org.in/notifications_rss.xml'), get(BASE + 'NotificationUser.aspx')]);
const feed = parseFeed(xml);
const rows = parseListing(html);
const rowById = new Map(rows.map((r) => [r.rbiId, r]));
const log = [];

const items = feed.map((i) => ({ ...i, source: 'feed', pdf: rowById.get(i.rbiId)?.pdf ?? null, published: listingDate(rowById.get(i.rbiId)?.date) ?? i.pubDate?.slice(0, 10) }));
const have = new Set(items.map((i) => i.rbiId));

// Listing rows the feed has dropped: fetch by Id, store only if title + PDF match.
for (const row of rows) {
  if (have.has(row.rbiId)) continue;
  const page = parseNotificationPage(await get(`${BASE}NotificationUser.aspx?Id=${row.rbiId}&Mode=0`));
  if (!backfillMatches(row, page)) { log.push(`skip ${row.rbiId}: page does not match listing row`); continue; }
  items.push({ ...page, rbiId: row.rbiId, source: 'listing', published: listingDate(row.date) });
  have.add(row.rbiId);
}

// Below the listing: walk down by Id until a circular is older than the window (max 40 fetches).
let id = Math.min(...have) - 1;
for (let n = 0; n < 40; n++, id--) {
  const page = parseNotificationPage(await get(`${BASE}NotificationUser.aspx?Id=${id}&Mode=0`));
  if (!page.title || !page.circularDate) { log.push(`skip ${id}: no circular on page`); continue; }
  if (page.circularDate < cutoff) break;
  items.push({ ...page, rbiId: id, source: 'by-id', published: page.circularDate });
}

const inWindow = items.filter((i) => (i.circularDate || i.published) >= cutoff).sort((a, b) => b.rbiId - a.rbiId);
const data = {
  generatedAt: new Date().toISOString(),
  today: istToday,
  cutoff,
  days,
  threshold: THRESHOLD,
  feedIds: feed.map((i) => i.rbiId),
  log,
  circulars: inWindow.map((i) => {
    const s = scoreItem(i);
    return {
      id: i.rbiId, title: i.title, ref: i.ref, date: i.circularDate || i.published, published: i.published,
      addressee: i.addressee, link: `${BASE}NotificationUser.aspx?Id=${i.rbiId}&Mode=0`, pdf: i.pdf, source: i.source,
      score: s.score, alert: s.alert, hardRule: s.hardRule, gate: s.gate.multiplier, gateSource: s.gate.source,
      topic: s.topic.tag, weight: s.topic.weight, severity: s.severity,
    };
  }),
};

mkdirSync(new URL('./report/', import.meta.url), { recursive: true });
writeFileSync(new URL('./report/tracker-data.json', import.meta.url), JSON.stringify(data, null, 2));
const page = readFileSync(new URL('./tracker.template.html', import.meta.url), 'utf8')
  .replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'));
writeFileSync(new URL('./report/circular-tracker.body.html', import.meta.url), page);
writeFileSync(
  new URL('./report/circular-tracker.html', import.meta.url),
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page}\n</html>\n`,
);
console.log(`${data.circulars.length} circulars from ${cutoff} to ${istToday}; ${data.circulars.filter((c) => c.alert).length} need action`);
for (const l of log) console.log(l);
