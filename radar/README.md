# RBI Circular Radar: pipeline logic

This folder holds the Radar's feed handling and rule-based scoring, written as plain Node with no dependencies. It makes no network or Claude API calls. Those parts come in the weekend 2 build.

```
npm test                                   # 15 tests on saved RBI snapshots
NODE_USE_ENV_PROXY=1 node live-check.mjs   # fetch rbi.org.in now and score today's feed
```

`NODE_USE_ENV_PROXY=1` is only needed behind an HTTPS proxy (Node 22.21+).

| File | What it holds |
| --- | --- |
| `radar.mjs` | Feed parser, Id extraction, IST dates, addressee block, ref and date, dedupe, Id gap check, listing and notification page parsers, backfill guard (title + PDF link), scoring rubric, hard rules, model/code score reconcile, cite checker |
| `fixture.mjs` | Loads the saved snapshots; one synthetic test circular that must alert |
| `fixtures/` | Real pages from rbi.org.in, 15 Nov 2026: RSS feed, listing page, notifications 13742, 13748, 12848 |
| `radar.test.mjs` | 15 tests (`node:test`) |
| `live-check.mjs` | Live run: fetch, parse, check Ids against the listing, score |
| `report/radar-test-run.html` | HTML report of the last run |

## Findings from the live site (15 Nov 2026)

- The addressee is a multi-line block between the date and the salutation, not one line starting "All".
- Reference numbers can include a department code: `RBI/DPSS/2026-27/476`.
- UAPA sanctions updates reuse titles word for word, so backfill has to match the PDF link as well as the title.
- The listing page reaches only 3 Ids below the feed. A larger gap needs the month archive.
