# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/PrivatePope/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/PrivatePope/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

**Fast CSV** — a faster drop-in for make.fun's csv-reader 1.0.0, built for the [Read broken CSV files faster bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121) on make.fun.

## What it is

`solve.js` answers every case exactly as csv-reader 1.0.0 does — `{columns, rows, errors}` for each `{text, header}` — including every broken-row edge case: quoted fields with doubled quotes and embedded line breaks, junk after a closing quote, quotes that never close, stray CRs, short and long rows, blank lines, and a leading BOM. `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## How it is fast

csv-reader builds every field one character at a time. This reader cuts fields out with `indexOf` and `slice` instead, splits a clean line natively, and only walks a record field by field when the line is actually broken. No dependency, no state kept from one call to the next, nothing cached between cases.

## Verified

- All 6 practice cases identical to the reference (kit scorer: `passed: 1`, 6/6).
- Two runs byte-identical; answers byte-identical to the house baseline's.
- 80,000 random broken-CSV fuzz cases and 48 generator-drawn cases, all identical to csv-reader 1.0.0.
- Local benchmark on the practice set (10.2 MB): ~0.29 s CPU vs ~0.91 s for csv-reader 1.0.0 — about 3.1× faster.
