import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeed, extractRbiId, parsePubDateIST, selectNew, findGap, backfillMatches, backfillTitleMatches,
  parseListing, parseNotificationPage, applicability, scoreItem, reconcileScore, checkCites, THRESHOLD,
} from './radar.mjs';
import { LIVE_FEED_XML, LISTING_HTML, PAGE, SYNTHETIC_RBC, buildFeed } from './fixture.mjs';

const items = parseFeed(LIVE_FEED_XML);
const byId = (id) => items.find((i) => i.rbiId === id);
const listing = parseListing(LISTING_HTML);
const dld = parseNotificationPage(PAGE[12848]);
const UAPA = [13747, 13748, 13749];

test('live feed: 10 items, contiguous Ids 13743–13752, IST dates, refs with dept infix', () => {
  assert.equal(items.length, 10);
  assert.deepEqual(items.map((i) => i.rbiId).sort(), Array.from({ length: 10 }, (_, k) => 13743 + k));
  const dmt = byId(13752);
  assert.equal(dmt.title, 'Reserve Bank of India (Domestic Money Transfer) Directions, 2026');
  assert.equal(dmt.pubDate, '2026-11-11T17:00:00+05:30');
  assert.equal(dmt.ref, 'RBI/DPSS/2026-27/476');
  assert.equal(byId(13751).ref, 'RBI/DPSS/2026-27/475', 'not the 2019 ref cited further down the body');
  assert.equal(byId(13749).ref, 'RBI/2026-27/303');
  assert.equal(byId(13750).ref, null, 'FEMA notifications carry no RBI ref');
  for (const i of items) assert.ok(!/&[a-z]+;/i.test(i.bodyText.slice(0, 2000)), `${i.rbiId} has undecoded entities`);
});

test('rbi_id extraction handles &amp;, raw &, Scripts/scripts and junk', () => {
  assert.equal(extractRbiId('https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13752&amp;Mode=0'), 13752);
  assert.equal(extractRbiId('https://www.rbi.org.in/Scripts/NotificationUser.aspx?Mode=0&Id=13751'), 13751);
  assert.equal(extractRbiId('https://www.rbi.org.in/Scripts/NotificationUser.aspx?id=13750'), 13750);
  assert.equal(extractRbiId('https://www.rbi.org.in/Scripts/NotificationUser.aspx'), null);
  assert.equal(parsePubDateIST('Wed, 11 Nov 2026 17:00:00'), '2026-11-11T17:00:00+05:30');
  assert.equal(parsePubDateIST(null), null);
});

test('dedupe: second run on the live feed finds 0 new items', () => {
  const first = selectNew(items, []);
  assert.equal(first.length, 10);
  assert.equal(selectNew(items, first.map((i) => i.rbiId)).length, 0);
  assert.equal(selectNew([...items, items[0]], []).length, 10);
});

test('watermark is the Id, not pubDate: live 13744 (17:30) is stamped after 13745 (17:10)', () => {
  assert.equal(byId(13744).pubDate, '2026-10-23T17:30:00+05:30');
  assert.equal(byId(13745).pubDate, '2026-10-23T17:10:00+05:30');
  const fresh = selectNew(items, [13743, 13744]).map((i) => i.rbiId);
  assert.equal(fresh[0], 13745);
  // pubDate and the date printed on the circular can differ too.
  assert.equal(byId(13746).pubDate.slice(0, 10), '2026-10-27');
  assert.equal(byId(13746).circularDate, '2026-10-26');
});

test('gap check lists Ids that fell out of the 10-item feed', () => {
  const feedIds = items.map((i) => i.rbiId);
  assert.deepEqual(findGap(feedIds, 13742), []);
  assert.deepEqual(findGap(feedIds, 13739), [13740, 13741, 13742]);
  assert.deepEqual(findGap(feedIds, 13750), []);
  assert.deepEqual(findGap(feedIds, null), []);
});

test('listing page: 13 rows (Ids 13740–13752), each with date and PDF; covers a gap of up to 3', () => {
  assert.equal(listing.length, 13);
  const ids = listing.map((r) => r.rbiId).sort((a, b) => a - b);
  assert.equal(ids[0], 13740);
  assert.equal(ids.at(-1), 13752);
  for (const r of listing) {
    assert.match(r.date, /^[A-Z][a-z]{2} \d{2}, \d{4}$/);
    assert.match(r.pdf, /^https:\/\/rbidocs\.rbi\.org\.in\/rdocs\/notification\/PDFs\/\w+\.PDF$/i);
  }
  for (const id of findGap(items.map((i) => i.rbiId), 13739)) assert.ok(ids.includes(id), `${id} not on listing`);
});

test('backfill: a title match accepts the wrong circular; title + PDF link does not', () => {
  const row = listing.find((r) => r.rbiId === 13742);
  const right = parseNotificationPage(PAGE[13742]);
  const wrong = parseNotificationPage(PAGE[13748]);
  assert.equal(right.ref, 'RBI/2026-27/296');
  assert.equal(wrong.ref, 'RBI/2026-27/302');
  assert.equal(backfillTitleMatches(row.title, wrong.title), true, 'UAPA titles repeat word for word');
  assert.equal(backfillMatches(row, wrong), false);
  assert.equal(backfillMatches(row, right), true);
});

test('addressee is the multi-line block between date and salutation; 3 of 10 have none', () => {
  for (const id of UAPA) assert.match(byId(id).addressee, /Non-Banking Financial Companies/);
  assert.match(byId(13751).addressee, /Authorised Non-bank Payment System Operators/);
  const none = items.filter((i) => !i.addressee).map((i) => i.rbiId).sort();
  assert.deepEqual(none, [13743, 13744, 13750]);
});

test('applicability: addressee, then title entity, then the Applicability para (not the index)', () => {
  assert.deepEqual([applicability(byId(13749)).multiplier, applicability(byId(13749)).source], [1.0, 'addressee']);
  assert.deepEqual([applicability(byId(13744)).multiplier, applicability(byId(13744)).source], [0.1, 'title']);
  assert.equal(applicability(byId(13751)).multiplier, 0.3);
  const a = applicability(dld);
  assert.equal(a.source, 'applicability_para');
  assert.equal(a.multiplier, 1.0);
  assert.match(a.evidence, /^Applicability\s+These Directions shall be applicable/);
});

test('live scores: nothing reaches 60, no hard rule fires, UAPA updates top out at 35', () => {
  const scored = items.map((i) => ({ id: i.rbiId, ...scoreItem(i) }));
  for (const s of scored) {
    assert.ok(s.score < THRESHOLD, `${s.id} scored ${s.score}`);
    assert.equal(s.alert, false);
    assert.equal(s.hardRule, false);
  }
  for (const id of UAPA) assert.equal(scored.find((s) => s.id === id).score, 35);
  assert.equal(Math.max(...scored.map((s) => s.score)), 35);
  assert.equal(scored.find((s) => s.id === 13751).score, 14, 'cyber MD = 0.3 x 30 x 1.6');
});

test('positive controls: real Digital Lending Directions 96, synthetic RBC amendment 72', () => {
  assert.equal(dld.title, 'Reserve Bank of India (Digital Lending) Directions, 2025');
  assert.equal(dld.ref, 'RBI/2025-26/36');
  const d = scoreItem(dld);
  assert.deepEqual([d.score, d.hardRule, d.alert], [96, true, true]);
  const rbc = scoreItem(parseFeed(buildFeed([SYNTHETIC_RBC]))[0]);
  assert.deepEqual([rbc.score, rbc.hardRule, rbc.alert], [72, true, true]);
});

test('hard rules read the title only: live UAPA bodies cite the KYC Directions', () => {
  for (const id of UAPA) {
    assert.match(byId(id).bodyText, /Know Your Customer/);
    assert.equal(scoreItem(byId(id)).hardRule, false);
  }
});

test('spec worked example: KYC amendment to all REs = 65 and alerts', () => {
  const kyc = parseFeed(buildFeed([{
    id: 99002, title: 'Reserve Bank of India (Know Your Customer) Amendment Directions, 2026', pubDate: 'Fri, 13 Nov 2026 17:00:00',
    body: 'RBI/2026-27/998<br/>November 13, 2026<br/>All Regulated Entities<br/>Madam / Dear Sir,<br/>Please refer to paragraph 38.',
  }]))[0];
  const k = scoreItem(kyc);
  assert.deepEqual([k.score, k.alert], [65, true]);
});

test('model score mismatch over 5 points is logged and the code score wins', () => {
  const logs = [];
  assert.deepEqual(reconcileScore(80, 72, (e) => logs.push(e)), { score: 72, mismatch: true });
  assert.deepEqual(reconcileScore(75, 72, (e) => logs.push(e)), { score: 72, mismatch: false });
  assert.equal(logs.length, 1);
});

test('cite checker on the real Digital Lending text', () => {
  const good = { effective_dates: [{ para: 'para 6' }, { para: 'para 17' }], checklist: [{ para: 'Due diligence requirements with respect to LSPs' }] };
  assert.deepEqual(checkCites(good, dld.bodyText), { ok: true, missing: [] });
  assert.deepEqual(checkCites({ checklist: [{ para: 'para 42(b)' }] }, dld.bodyText), { ok: false, missing: ['para 42(b)'] });
});
