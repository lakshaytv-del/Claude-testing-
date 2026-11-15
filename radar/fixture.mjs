// Fixtures: real pages saved from rbi.org.in on 15 Nov 2026, plus one synthetic control.
//
//   fixtures/rss-2026-11-15.xml         Notifications RSS (10 items, Ids 13743–13752)
//   fixtures/listing-2026-11-15.html    Notifications listing page (13 rows, Ids 13740–13752)
//   fixtures/notification-13742.html    NotificationUser.aspx?Id=13742 (just below the feed window)
//   fixtures/notification-13748.html    NotificationUser.aspx?Id=13748 (same title as 13742)
//   fixtures/notification-12848.html    NotificationUser.aspx?Id=12848 (Digital Lending Directions, 2025)

import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

export const LIVE_FEED_XML = read('rss-2026-11-15.xml');
export const LISTING_HTML = read('listing-2026-11-15.html');
export const PAGE = {
  13742: read('notification-13742.html'),
  13748: read('notification-13748.html'),
  12848: read('notification-12848.html'),
};

// Synthetic positive control: an NBFC conduct amendment with no addressee line.
export const SYNTHETIC_RBC = {
  id: 99001,
  title: 'Reserve Bank of India (Non-Banking Financial Companies – Responsible Business Conduct) Amendment Directions, 2026',
  pubDate: 'Fri, 13 Nov 2026 17:00:00',
  body: 'RBI/2026-27/999<br/>DoR.MCS.REC.1/01.01.001/2026-27<br/>November 13, 2026<br/>Reserve Bank of India (Non-Banking Financial Companies – Responsible Business Conduct) Amendment Directions, 2026<br/>Please refer to Chapter III of the Directions.',
};

/** Build a one-item feed in RBI's format, for synthetic and edge cases. */
export function buildFeed(items) {
  const xml = items
    .map(
      (i) => `<item><title><![CDATA[${i.title}]]></title><description><![CDATA[${i.body}]]></description>` +
        `<link>https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=${i.id}&amp;Mode=0</link><pubDate>${i.pubDate}</pubDate></item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>NOTIFICATIONS FROM RBI</title>${xml}</channel></rss>`;
}
