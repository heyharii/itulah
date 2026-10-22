# Chart

Chart draws a series over time or a share by place in the hub's own grammar: thin bars and one line in token colours, quiet gridlines, axis words in `mute` at 15px, a legend over the plot and the exact figures in a table under it.

## Pick by job

| The question | Use |
| --- | --- |
| How much, per day or per store | `BarSeries`. `stacked` answers "how much altogether" before "of which how much". |
| Where was this heading over the window (a running balance) | `LineSeries`: one line on a wash, with an optional dashed ghost of the span before. |
| A level and the cost of reaching it, on one axis | `ComboSeries`: bars and a line. |
| Which store is the reason (five at most, the rest as Other) | `BandStack`, always with `BandLegend`. |
| The shape of one row's trade, beside its figure | `Sparkline`. |
| The names of the series | `ChartLegend`, over the plot. |

## Colours

A caller passes a role, never a hue. All of them are tokens.

| Role | Token | For |
| --- | --- | --- |
| Primary series | `accent` | The series being read. It means here what it means on a selected row. |
| Cap | `a-orange` | The one second colour a stacked bar gets. |
| Ghost | `hairline-2` | The span before. Declared first, so in each bucket it stands to the left of the live bar, 18px against 11px; a dashed line in `LineSeries`. |
| Combo bars | `a-violet` | What it cost. The line over them is `accent`. |
| Bands | `a-orange`, `a-blue`, `a-green`, `a-violet`, `a-pink`, in that order | One store per band. The order was checked for colour blindness; do not reorder it. |
| Other | `mute` | The remainder, a neutral and not a sixth hue. |
| By state | `fill-green`, `fill-sky`, `fill-orange` | A bar or area in the good, in-motion or waiting series. |

The `a-*` tokens are for charts and identity tiles only, never chrome.

## Drawing

| Part | Drawn as |
| --- | --- |
| Frame | Full width, 220px high by default, margins of 4px. The text is 15px and inherits. |
| Gridlines | Horizontal only, 1px `hairline`, dashed 2 3. No vertical lines. |
| Axes | The category axis has a `hairline-2` line and words in `mute`, no ticks. The value axis is 56px wide, words only, in the compact form ("25 M"). |
| Bars | 11px wide at most (the ghost 18px), each centred in its share of the bucket, top corners 3px, nothing animates. |
| Line | 1.5px in `accent`. `LineSeries` is a smooth line on a wash of `accent` from 18% to 1%; `ComboSeries` joins its points with straight segments and a 2px dot each. |
| Tooltip | On hover: 8px radius, 1px `hairline`, `canvas`, `shadow-pop`. The bucket in full at 500, then a 5px dot, the series name in `body` and its exact figure at 500 in `ink`. A stack adds a hairline and a total. |
| Legend | Over the plot: a 5px dot and the name in `body`, 12px apart, wrapping. |
| Bands | A 2px gap of the surface between bands, never a stroke; only the top band is rounded; 22px wide at most. |
| `Sparkline` | 28px high, scaled to its own row from zero. A 1.5px line: no axis, no grid, no tooltip, no numbers. |

## Rules

- Say the figure. The axis only says roughly how tall a bar is: the exact figure is in the tooltip and in the table under the chart.
- Colour never carries a name alone. The legend is not optional on a stack, and a table carries every figure.
- Nothing in a chart is under 15px.
- One second colour for a stacked bar; past five stores, the rest is Other.
- A `Sparkline` is the one mark that fits a table cell, beside its figure. It is not a progress bar.
- Dates on an axis are the short form ("17 Oct"); the tooltip says the day in full, with its year.

## Retired

- A progress bar in a table cell in place of the figure. Write the number; a `Sparkline` may stand beside it.
- A hue chosen by a screen, or a band order of its own. The bands come from `lib/chart-bands.ts`.
- The chart library's own tooltip, legend and colours. The kit draws them.

## What you provide

| Component | Prop | Notes |
| --- | --- | --- |
| `BarSeries` | `rows`, `series` | `rows` are `{ bucket, [key]: number }`; `series` are `{ key, label, tone }` with `tone` `accent`, `cap` or `ghost`. Declare a ghost first. |
| | `stacked`, `className` | `className` sets the height. |
| `LineSeries` | `rows`, `dataKey`, `label` | One series. |
| | `ghost` | `{ dataKey, labelOf }`: the span before, named by its own date in the tooltip. |
| `ComboSeries` | `rows`, `bars`, `line` | `bars` is `null` when the two would be the same series. One axis, deliberately. |
| `BandStack` | `rows`, `bands`, `totalLabel` | `bands` are `{ key, label, colour }`, colours from `BAND_TONES` and `BAND_NEUTRAL`. |
| all four | `format`, `titleOf`, `labelOf` | The full figure for the tooltip; a bucket in full; a bucket short for the axis. |
| `BandLegend`, `ChartLegend` | `bands`, `series` | Top band first. |
| `Sparkline` | `values`, `colour` | `colour` is a CSS value: the store's band colour where a screen has one. |

Source: `frontend-hub/src/components/ui/chart.tsx` (`BarSeries`, `LineSeries`, `ComboSeries`, `BandStack`, `BandLegend`, `ChartLegend`, `Sparkline`), `lib/chart-bands.ts`, `lib/format.ts` (`compactFormat`).
