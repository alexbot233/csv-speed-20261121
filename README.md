# csv-speed-20261121

A fast, drop-in replacement for make.fun's csv-reader 1.0.0, entered in the
[Read broken CSV files faster](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
competition. `solve.js` exports `run(input)` that returns exactly the same
answer as csv-reader 1.0.0 for every case — including all broken-row error
semantics (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`,
`long_row`) — but reads the text with `charCodeAt` boundary scanning and
minimal string allocation, roughly 3× faster than the reference.

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/alexbot233/csv-speed-20261121/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/alexbot233/csv-speed-20261121/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

## Run

```
node main.ts
```

The harness reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`),
answers each with `run` from `./solve.js`, and writes `/output/answers.json`
(or `$MAKEFUN_OUTPUT_DIR`).
