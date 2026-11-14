import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeed, extractRbiId, parsePubDateIST, selectNew, findGap, backfillTitleMatches,
  applicability, scoreItem, reconcileScore, checkCites, THRESHOLD,
} from './radar.mjs';
import { LIVE_FEED_XML, DIGITAL_LENDING, SYNTHETIC_RBC, buildFeed } from './fixture.mjs';

const items = parseFeed(LIVE_FEED_XML);
const byId = (id) => items.find((i) => i.rbiId === id);
const parseOne = (fx) => parseFeed(buildFeed([fx]))[0];

test('parses all 10 feed items with Id, IST date, ref and addressee', () => {
  assert.equal(items.length, 10);
  assert.deepEqual(items.map((i) => i.rbiId).sort(), Array.from({ length: 10 }, (_, k) => 13743 + k));
  const dmt = byId(13752);
  assert.equal(dmt.title, 'Reserve Bank of India (Domestic Money Transfer) Directions, 2026');
  assert.equal(dmt.pubDate, '2026-11-11T17:00:00+05:30');
  assert.match(dmt.ref, /^RBI\/2026-27\/\d+$/);
  assert.equal(dmt.addressee, 'All Scheduled Commercial Banks');
  assert.equal(byId(13744).addressee, null, 'amendment directions have no addressee line');
});

test('rbi_id extraction handles &amp;, raw &, Scripts/scripts and junk', () => {
  assert.equal(extractRbiId('https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13752&amp;Mode=0'), 13752);
  assert.equal(extractRbiId('https://www.rbi.org.in/Scripts/NotificationUser.aspx?Mode=0&Id=13751'), 13751);
  assert.equal(extractRbiId('https://www.rbi.org.in/Scripts/NotificationUser.aspx?id=13750'), 13750);
  assert.equal(extractRbiId('https://www.rbi.org.in/Scripts/NotificationUser.aspx'), null);
  assert.equal(parsePubDateIST('Wed, 11 Nov 2026 17:00:00'), '2026-11-11T17:00:00+05:30');
  assert.equal(parsePubDateIST(null), null);
});

test('dedupe: second run on the same feed finds 0 new items', () => {
  const first = selectNew(items, []);
  assert.equal(first.length, 10);
  const stored = first.map((i) => i.rbiId);
  assert.equal(selectNew(items, stored).length, 0);
  // Duplicate items inside one feed are collapsed too.
  assert.equal(selectNew([...items, items[0]], []).length, 10);
});

test('watermark is the Id, not pubDate (13744 is stamped later than 13745)', () => {
  assert.ok(byId(13744).pubDate > byId(13745).pubDate);
  // Stored up to 13744: a pubDate watermark would skip 13745; the Id rule keeps it.
  const stored = [13743, 13744];
  const fresh = selectNew(items, stored).map((i) => i.rbiId);
  assert.ok(fresh.includes(13745));
  assert.equal(fresh[0], 13745);
});

test('gap check lists Ids that fell out of the 10-item feed', () => {
  const feedIds = items.map((i) => i.rbiId);
  assert.deepEqual(findGap(feedIds, 13742), []);
  assert.deepEqual(findGap(feedIds, 13739), [13740, 13741, 13742]);
  assert.deepEqual(findGap(feedIds, 13750), [], 'overlap is not a gap');
  assert.deepEqual(findGap(feedIds, null), [], 'first run has no watermark');
});

test('backfill stores a fetched circular only if its title matches the listing row', () => {
  const listing = 'Reserve Bank of India (Domestic Money Transfer) Directions, 2026';
  assert.ok(backfillTitleMatches(listing, 'Reserve Bank of India (Domestic Money Transfer) Directions, 2026'));
  assert.ok(backfillTitleMatches(listing, 'Reserve Bank of India (Domestic Money Transfer) Directions,  2026 '));
  // The failure seen live: fetching one Id returned a different circular.
  assert.ok(!backfillTitleMatches(listing, 'Reserve Bank of India (Digital Lending) Directions, 2025'));
  assert.ok(!backfillTitleMatches('', ''));
});

test('applicability falls back: addressee, then title entity, then Applicability para', () => {
  assert.equal(applicability(byId(13743)).source, 'addressee');
  const sfb = applicability(byId(13745));
  assert.equal(sfb.source, 'title');
  assert.equal(sfb.multiplier, 0.1);
  const dld = applicability(parseOne(DIGITAL_LENDING));
  assert.equal(dld.source, 'applicability_para');
  assert.equal(dld.multiplier, 1.0);
  assert.equal(applicability(byId(13748)).multiplier, 0.3, 'payment system operators only');
});

test('no live item reaches the alert threshold; none fires a hard rule', () => {
  const scored = items.map((i) => ({ id: i.rbiId, title: i.title, ...scoreItem(i) }));
  for (const s of scored) {
    assert.ok(s.score < THRESHOLD, `${s.id} scored ${s.score}`);
    assert.equal(s.alert, false, `${s.id} alerted`);
  }
  assert.equal(scored.find((s) => s.id === 13748).score, 14, 'cyber MD = 0.3 x 30 x 1.6');
  // UAPA list updates: 1.0 (all REs) x 50 (kyc_aml) x 0.7 (list update) = 35.
  for (const id of [13743, 13746, 13750]) assert.equal(scored.find((s) => s.id === id).score, 35);
});

test('positive controls alert: Digital Lending Directions 96, synthetic RBC amendment 72', () => {
  const dld = scoreItem(parseOne(DIGITAL_LENDING));
  assert.equal(dld.score, 96);
  assert.equal(dld.hardRule, true);
  assert.equal(dld.alert, true);
  const rbc = scoreItem(parseOne(SYNTHETIC_RBC));
  assert.equal(rbc.score, 72);
  assert.equal(rbc.hardRule, true);
  assert.equal(rbc.alert, true);
});

test('hard rules read the title only: a KYC mention in the body does not fire', () => {
  const uapa = byId(13743);
  assert.match(uapa.bodyText, /Know Your Customer/);
  assert.equal(scoreItem(uapa).hardRule, false);
});

test('spec worked examples: KYC amendment to all REs = 65, DMT for banks skips', () => {
  const kyc = parseOne({
    id: 99002, title: 'Reserve Bank of India (Know Your Customer) Amendment Directions, 2026',
    pubDate: 'Fri, 13 Nov 2026 17:00:00', addressee: 'All Regulated Entities', body: 'Please refer to paragraph 38.',
  });
  const k = scoreItem(kyc);
  assert.equal(k.score, 65);
  assert.equal(k.alert, true);
  assert.equal(scoreItem(byId(13752)).score, 2, '0.1 x 10 x 1.6 = 1.6, rounded');
});

test('model score mismatch over 5 points is logged and the code score wins', () => {
  const logs = [];
  assert.deepEqual(reconcileScore(80, 72, (e) => logs.push(e)), { score: 72, mismatch: true });
  assert.equal(logs[0].event, 'score_mismatch');
  assert.deepEqual(reconcileScore(75, 72, (e) => logs.push(e)), { score: 72, mismatch: false });
  assert.equal(logs.length, 1);
});

test('cite checker fails a brief whose para is not in the body', () => {
  const body = parseOne(DIGITAL_LENDING).bodyText;
  const good = { applies_to: { evidence: { para: '3. Applicability' } }, checklist: [{ para: '5(v)' }, { para: '9.' }] };
  assert.deepEqual(checkCites(good, body), { ok: true, missing: [] });
  const bad = { checklist: [{ para: '5(v)' }, { para: '42(b)' }] };
  assert.deepEqual(checkCites(bad, body), { ok: false, missing: ['42(b)'] });
});
