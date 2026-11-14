// Fixture: the 10 items in RBI's Notifications RSS as of 14 Nov 2026 (Ids 13743–13752).
//
// PROVENANCE. The live feed could not be re-fetched when this file was rebuilt
// (rbi.org.in is blocked from the build sandbox and from web fetch). Facts the
// build spec recorded from the 14 Nov read are used as-is and marked `spec`:
//   - Id range 13743–13752, dates 23 Oct – 11 Nov 2026
//   - 13752 = Reserve Bank of India (Domestic Money Transfer) Directions, 2026, Wed 11 Nov 2026 17:00:00
//   - 13744 stamped 17:30, 13745 stamped 17:10 (Id order != time order)
//   - 3 items are UAPA sanctions-list updates
//   - 1 item is a cyber Master Direction for payment system operators
//   - 3 items have no addressee line and open "Please refer to …"
// Everything else (other titles, bodies, exact dates) is a `stand-in` written to
// match those facts. Replace with a saved snapshot of the real feed when available.

const RE = 'All Regulated Entities';

export const LIVE_ITEMS = [
  {
    id: 13743, provenance: 'stand-in (date 23 Oct from spec)',
    title: 'Implementation of Section 51A of UAPA, 1967: Updates to UNSC’s 1267/ 1989 ISIL (Da’esh) & Al-Qaida Sanctions List: Amendments in 1 Entry',
    pubDate: 'Thu, 23 Oct 2026 18:00:00', addressee: RE,
    body: 'Please refer to paragraph 52 of the Master Direction on Know Your Customer (KYC), 2016 regarding the procedure for implementation of Section 51A of UAPA. The UNSC has amended one entry in its Sanctions List.',
  },
  {
    id: 13744, provenance: 'stand-in (17:30 stamp from spec)',
    title: 'Reserve Bank of India (Commercial Banks – Credit Risk Management) Amendment Directions, 2026',
    pubDate: 'Fri, 31 Oct 2026 17:30:00', addressee: null,
    body: 'Please refer to Chapter IV of the Reserve Bank of India (Commercial Banks – Credit Risk Management) Directions, 2025. On a review, it has been decided to amend paragraph 41.',
  },
  {
    id: 13745, provenance: 'stand-in (17:10 stamp from spec)',
    title: 'Reserve Bank of India (Small Finance Banks – Concentration Risk Management) Amendment Directions, 2026',
    pubDate: 'Fri, 31 Oct 2026 17:10:00', addressee: null,
    body: 'Please refer to Chapter IV of the Reserve Bank of India (Small Finance Banks – Concentration Risk Management) Directions, 2025. It has been decided to amend the limits in paragraph 18.',
  },
  {
    id: 13746, provenance: 'stand-in',
    title: 'Implementation of Section 51A of UAPA, 1967: Updates to UNSC’s 1718 Sanctions List: Addition of 2 Entries',
    pubDate: 'Mon, 03 Nov 2026 18:15:00', addressee: RE,
    body: 'Please refer to the Master Direction on Know Your Customer (KYC), 2016. The UNSC Committee has added two entries to its Sanctions List.',
  },
  {
    id: 13747, provenance: 'stand-in',
    title: 'Reserve Bank of India (Regional Rural Banks – Interest Rate on Deposits) Amendment Directions, 2026',
    pubDate: 'Tue, 04 Nov 2026 17:00:00', addressee: null,
    body: 'Please refer to Chapter IV of the Reserve Bank of India (Regional Rural Banks – Interest Rate on Deposits) Directions, 2025. Paragraph 9 is amended.',
  },
  {
    id: 13748, provenance: 'stand-in (cyber MD for payment operators from spec)',
    title: 'Master Direction on Cyber Resilience and Digital Payment Security Controls for Payment System Operators, 2026',
    pubDate: 'Wed, 05 Nov 2026 16:45:00', addressee: 'All authorised non-bank Payment System Operators',
    body: 'These Directions set out cyber resilience and digital payment security controls for authorised non-bank Payment System Operators.',
  },
  {
    id: 13749, provenance: 'stand-in',
    title: 'Foreign Exchange Management (Export of Goods & Services) (Amendment) Regulations, 2026',
    pubDate: 'Thu, 06 Nov 2026 19:00:00', addressee: 'All Category-I Authorised Dealer Banks',
    body: 'Attention of Authorised Dealer Category-I (AD Category-I) banks is invited to Foreign Exchange Management (Export of Goods & Services) Regulations under FEMA, 1999.',
  },
  {
    id: 13750, provenance: 'stand-in',
    title: 'Implementation of Section 51A of UAPA, 1967: Updates to UNSC’s 1267/ 1989 ISIL (Da’esh) & Al-Qaida Sanctions List: Deletion of 1 Entry',
    pubDate: 'Fri, 07 Nov 2026 18:30:00', addressee: RE,
    body: 'Please refer to the Master Direction on Know Your Customer (KYC), 2016. The UNSC has removed one entry from its Sanctions List.',
  },
  {
    id: 13751, provenance: 'stand-in',
    title: 'Reserve Bank of India (Commercial Banks – Liquidity Coverage Ratio) Directions, 2026',
    pubDate: 'Mon, 10 Nov 2026 17:00:00', addressee: 'All Commercial Banks (excluding Small Finance Banks, Payments Banks, Local Area Banks and Regional Rural Banks)',
    body: 'These Directions revise the run-off factors used in computing the Liquidity Coverage Ratio for commercial banks.',
  },
  {
    id: 13752, provenance: 'spec (title, date); stand-in (body)',
    title: 'Reserve Bank of India (Domestic Money Transfer) Directions, 2026',
    pubDate: 'Wed, 11 Nov 2026 17:00:00', addressee: 'All Scheduled Commercial Banks',
    body: 'These Directions govern domestic money transfer services offered by banks, including cash payout and the role of business correspondents.',
  },
];

// Positive controls. The Digital Lending Directions title, Id, ref and the
// para 3 applicability scope are from the spec; the body text is abridged.
export const DIGITAL_LENDING = {
  id: 12848, provenance: 'spec (title, Id, ref, para 3 scope); body abridged',
  title: 'Reserve Bank of India (Digital Lending) Directions, 2025',
  pubDate: 'Thu, 08 May 2025 18:00:00', addressee: null,
  ref: 'RBI/2025-26/36',
  body:
    'RBI/2025-26/36 DoR.STR.REC.19/21.07.001/2025-26 May 08, 2025\n' +
    '1. Short title and commencement. These Directions shall come into force with immediate effect, except paragraph 6 which shall come into effect from November 1, 2025 and paragraph 17 from June 15, 2025.\n' +
    '3. Applicability. These Directions shall be applicable to: (a) Commercial Banks; (b) Primary (Urban) Co-operative Banks, State Co-operative Banks, Central Co-operative Banks; (c) Non-Banking Financial Companies (including Housing Finance Companies); and (d) All-India Financial Institutions.\n' +
    '5(v). Details of the recovery agent shall be communicated to the borrower before contact.\n' +
    '9. All loan servicing and repayments shall be executed directly in the bank account of the RE.',
};

export const SYNTHETIC_RBC = {
  id: 99001, provenance: 'synthetic title (positive control)',
  title: 'Reserve Bank of India (Non-Banking Financial Companies – Responsible Business Conduct) Amendment Directions, 2026',
  pubDate: 'Fri, 13 Nov 2026 17:00:00', addressee: null,
  body: 'Please refer to Chapter III of the Reserve Bank of India (Non-Banking Financial Companies – Responsible Business Conduct) Directions, 2025.',
};

function itemXml(i) {
  const head = i.ref ? '' : `RBI/2026-27/${i.id - 13450}\nDoR.XXX.REC.${i.id % 100}/01.01.001/2026-27\n`;
  const addr = i.addressee ? `<p>${i.addressee}</p>` : '';
  const body = `<p>${head.replace(/\n/g, '<br/>')}</p>${addr}<p>Madam / Dear Sir,</p><p>${i.body}</p><p>Yours faithfully,</p>`;
  return `<item>
  <title><![CDATA[${i.title}]]></title>
  <link>https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=${i.id}&amp;Mode=0</link>
  <pubDate>${i.pubDate}</pubDate>
  <description><![CDATA[${body}]]></description>
</item>`;
}

export function buildFeed(items) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>RBI Notifications</title>
${items.map(itemXml).join('\n')}
</channel></rss>`;
}

// Feed order is newest first, as RBI serves it.
export const LIVE_FEED_XML = buildFeed([...LIVE_ITEMS].reverse());
