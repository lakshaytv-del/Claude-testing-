# RBI Circular Radar: pipeline logic

This folder holds the Radar's feed handling and rule-based scoring, written as plain Node with no dependencies. It makes no network or Claude API calls. Those parts come in the weekend 2 build.

```
npm test        # or: node --test radar.test.mjs
```

| File | What it holds |
| --- | --- |
| `radar.mjs` | Feed parser, Id extraction, IST dates, dedupe, Id gap check, backfill title guard, scoring rubric (applicability × topic × severity), hard rules, model/code score reconcile, cite checker |
| `fixture.mjs` | The 10 items in RBI's Notifications RSS on 14 Nov 2026 (Ids 13743–13752), plus two positive controls |
| `radar.test.mjs` | 13 tests (`node:test`) |

## How the fixture was built

The fixture was not built from a saved copy of the feed. It was put together from the facts the build spec recorded on 14 Nov 2026:

- Id range and dates
- the Domestic Money Transfer title and timestamp
- the 17:30 / 17:10 times that are out of Id order
- 3 UAPA updates, 1 cyber Master Direction for payment operators, 3 items with no addressee line

Other titles and the body text are stand-ins written to match those facts. Each item's `provenance` field says which is which. Swap in a real feed snapshot once rbi.org.in can be reached.
