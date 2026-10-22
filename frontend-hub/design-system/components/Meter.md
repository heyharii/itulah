# Meter

A Meter draws one proportion on a 6px track, such as a balance left or a budget spent: use it beside its figure on a dashboard or in a sheet summary, never in a table row.

## Pieces

| Piece | Looks | Use it for |
| --- | --- | --- |
| `Meter` | A 6px track in `soft-2`, fully round, as wide as its row (48px at least), the fill in the tone's colour | The proportion in a sheet summary or a dashboard tile |
| `Progress` | A label (88px, 15px `ink`), a Meter, then the figure (52px, right-aligned, 15px at 600) or a `detail`, 10px apart | One station's "how much of this job is done" row: lines picked of lines owed |
| `Dial` | A 16px ring, 2.5px stroke on a `soft-2` track, no label | The same proportion round, beside a figure on a dashboard |

## Tones

The fill is a state's dot colour, never its word colour, and the caller chooses the tone.

| `tone` | Fill | Today |
| --- | --- | --- |
| `accent` | `accent` | Default. A budget spent up to 70%; a cap not yet reached |
| `ok` | `ok` | A voucher balance with a quarter or more left |
| `warn` | `warn` | A budget past 70%; a balance under a quarter |
| `bad` | `bad` | A budget past 90%; a cap passed; a balance at nothing |

## Rules

- Numbers, never bars, in a table. A row says its figure; a bar beside it is a second thing to read. Meters are for dashboards and sheet summaries.
- A Meter stands beside its figure ("52% of Rp 40.000.000"), never alone.
- `value` is 0 to 1 and clamped: 1.4 draws a full track, 0 an empty one. `Progress` draws an empty track when `of` is 0.
- A Meter is spoken as a percentage. Give it `label` ("Left of face value") or `labelledBy`; `Progress` hands over its own. A Dial is `aria-hidden`.
- One height, 6px. Width comes from the row (`min-w-0 flex-1`).
- The comment in `meter.tsx` says the fill comes from the `fill-*` family and the one in `progress.tsx` offers an `info` tone; the code draws `accent`, `ok`, `warn` and `bad` from the dot colours.
- `Progress` is the row for a column of Meters, so the label, the track and the figure line up across screens.

## Retired

- A Dial in a table cell: `inventory/pools.tsx:370`. Print the number.
- Tracks drawn by hand at 4, 6 and 8px: `commercial/overview.tsx:1079`, `master/payment-templates.tsx:161`, `procurement/supplier-returns.tsx:230`, `system/health.tsx:483`. One proportion is a `Meter` at 6px; a track in several colours has no kit piece yet.
- `Progress` has no callers today; screens lay a Meter out by hand (`finance/parts.tsx` in `RankedBars`, `commercial/overview.tsx:977`).

## What you provide

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `number` | `Meter`, `Dial`: 0 to 1. `Progress`: how much is done |
| `of` | `number` | `Progress` only: out of how much |
| `tone` | `"accent" \| "ok" \| "warn" \| "bad"` | Default `accent` |
| `label` | `string` | `Meter`: what it measures, for a screen reader. `Progress`: the visible label (`ReactNode`) |
| `labelledBy` | `string` | `Meter`: the id of a visible label that already says it |
| `detail` | `ReactNode` | `Progress`: said instead of the percentage. The column is 52px, so a figure of a few characters |
| `className` | `string` | `Meter`, `Dial`, `Progress`: width and layout only |

Source: `frontend-hub/src/components/ui/meter.tsx` (`Meter`, `Dial`), `progress.tsx`.
