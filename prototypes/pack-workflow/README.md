# Allotment — table flow

Current direction, 21 October 2026. Replaces the A–D workspace proposals following the owner's instruction to use four icon tabs and tables.

Open: http://localhost:5397/pack-options-3.html?tab=picked&stores=30

The prototype supports 13- and 30-store demo sizes. Additional names such as Toko 29 are placeholders. Each size has separate local storage. It makes no production API calls.

## Four tabs

| Tab | One table row represents | Action |
| --- | --- | --- |
| Picklist | One picklist, globally ordered by number | Pick / View |
| Picked | One store, with its available picked quantity | Pack |
| Packed | One sealed koli, with its store, quantity and seal time | Select koli, then Dispatch |
| In transit | One trip / delivery note | View its koli grouped by store |

Picked is intentionally only Store, Picked quantity, and Pack. It includes stores with pieces still available to pack. Dispatch is an action within Packed; it can combine koli from different stores in one trip.

## Seal creates the koli

Pack opens a quantity form for one new koli. Form edits are temporary and do not consume picked pieces, allocate a koli number, or create a record. Closing or reloading before Seal discards those edits.

Seal & create koli validates the selected SKU quantities, creates one sealed koli, and deducts exactly those quantities from Picked. The koli appears in Packed. The form resets to the remaining quantities so another koli can be sealed in the same session. Closing an unfinished next koli preserves the ones already sealed.

There are no saved open koli in this flow. The initial sample converts pieces formerly in open draft boxes back into the available Picked quantity.

## Files and validation

- `pack-options-3.html`: current entry point.
- `pack-table.js` and `pack-table.css`: current table UI.
- `pack-table-model.mjs`: strict model in which every koli record is sealed.
- `prototypes/pack-workflow/table-model.test.mjs`: model checks.
- `output/pack-table-20261021/`: visual captures and geometry results.
- `TABLE-QA.md`: browser verification and limits.

Run:

```sh
node --check pack-table.js
node --test prototypes/pack-workflow/table-model.test.mjs
```

The older A–D proposals remain available at `pack-options-3-archive.html`; their model tests and original QA are retained for reference. They are no longer the main prototype.
