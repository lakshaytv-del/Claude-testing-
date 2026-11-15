// Live smoke test against rbi.org.in: fetch the RSS and listing page, parse,
// check Ids and the listing overlap, and score every item.
// Usage: node live-check.mjs [--json] [--save <dir>]

import { writeFileSync, mkdirSync } from 'node:fs';
import { parseFeed, parseListing, findGap, scoreItem, THRESHOLD } from './radar.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const FEED = 'https://rbi.org.in/notifications_rss.xml';
const LISTING = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx';

async function get(url, tries = 3) {
  for (let n = 1; ; n++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (n >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
    }
  }
}

const args = process.argv.slice(2);
const [xml, html] = await Promise.all([get(FEED), get(LISTING)]);
const saveAt = args.indexOf('--save');
if (saveAt >= 0) {
  const dir = args[saveAt + 1];
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/rss.xml`, xml);
  writeFileSync(`${dir}/listing.html`, html);
}

const items = parseFeed(xml);
const rows = parseListing(html);
const ids = items.map((i) => i.rbiId).sort((a, b) => a - b);
const listingIds = new Set(rows.map((r) => r.rbiId));
const contiguous = ids.every((id, k) => k === 0 || id === ids[k - 1] + 1);
const scored = items.map((i) => ({ id: i.rbiId, title: i.title, pubDate: i.pubDate, ref: i.ref, addressee: i.addressee, ...scoreItem(i) }));
const report = {
  fetchedAt: new Date().toISOString(),
  feed: { items: items.length, minId: ids[0], maxId: ids.at(-1), contiguous },
  listing: { rows: rows.length, minId: Math.min(...listingIds), allFeedIdsListed: ids.every((id) => listingIds.has(id)), backfillReach: ids[0] - Math.min(...listingIds) },
  gapIfLastSeen: { [ids[0] - 4]: findGap(ids, ids[0] - 4) },
  alerts: scored.filter((s) => s.alert).length,
  scored,
};

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Feed: ${report.feed.items} items, Ids ${report.feed.minId}–${report.feed.maxId}, contiguous: ${contiguous}`);
  console.log(`Listing: ${rows.length} rows, all feed Ids listed: ${report.listing.allFeedIdsListed}, can backfill ${report.listing.backfillReach} Ids below the feed`);
  for (const s of scored) console.log(`${s.id}  ${String(s.score).padStart(3)}  ${s.alert ? 'ALERT' : 'skip '}  ${s.title.slice(0, 90)}`);
  console.log(`${report.alerts} alert(s) at threshold ${THRESHOLD}`);
}
