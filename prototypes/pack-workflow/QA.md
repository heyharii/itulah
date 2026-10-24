# Verification — 21 October 2026

- `node --check pack-options-3.js` and `node --check pack-workflow-model.mjs`: passed.
- `node --test prototypes/pack-workflow/model.test.mjs`: 8 tests passed.
- All four layouts were rendered and visually reviewed at 1440 × 1000 and 414 × 896. No document-level horizontal overflow or clipped SKU rows/panel headings was found. Matrix scrolling is confined to its container; its phone layout uses cards.
- The quantity dialog was inspected at 375 × 812. No horizontal overflow. Typing 2 and pressing Enter moved 2 pieces and left the correct picked balance.
- Dispatch was checked at 375 × 812. No horizontal overflow or clipped dispatch rows/summary.

Browser journeys completed:

1. A: transfer 2 Oxford M to Koli 3, return 1 to Picked, seal, dispatch, and reload. Quantities and trip persisted.
2. B: transfer 2 Oxford M into the selected koli from the expanded store workspace.
3. C: open an empty matrix cell, add 1 Oxford L from Picked, then Undo. The previous quantity was restored.
4. D: record the remaining 6 picks for WMJB, pack only 17 of the resulting 24 pieces, seal and dispatch. Reload retained the trip and 7 pieces still waiting to pack.
5. After the user's clarification, D's Dispatch was changed to the same global, multi-store trip workspace as A–C. Selected Cikupa Koli 1, Jambi Koli 1, and Muaro Bungo Koli 2: 3 koli / 36 pieces / 3 stores. Review and dispatch produced one trip grouped by destination. Reload retained all three destinations.
6. Opened Cikupa's packing list: 8 Oxford M + 4 Oxford L = 12 pieces. Reopening removed it from the sealed dispatch selection; Undo restored it.

Screenshots: `output/pack-workflow-20261021/`. The final demo state was reset to its original sample quantities and returned to A / Pack / Cikupa.

Limits: this is an isolated local prototype. Production APIs, real delivery-note issuance, printer hardware, and scanner hardware were not exercised. The browser's native print dialog was not submitted. Source and storage are separate from the existing T10 and production app.

## 13 / 30 stores follow-up

The demo now defaults to 13 stores and also supports a separate 30-store scenario, chosen in the prototype toolbar or with `stores=30` in the URL. Extra names are placeholders. The navigator uses compact rows, fixed search and filter controls, and an independently scrolling list.

- 10 model tests passed, including unique koli across both roster sizes and preservation of the original four-store picks, koli and trips during roster expansion.
- With 30 stores, scrolling the navigator reached store 30 while the page scroll position and packing context remained unchanged. Selecting store 30 retained the list scroll position.
- Searching `C029` returned one store; the work filter returned the expected 15 stores pending pack in the original sample.
- A transfer in the 30-store demo survived switching to 13 stores and back. The 13-store quantities were unchanged.
- A and D were checked at 1280 × 800, 1440 × 1000 and 414 × 896: no document-level horizontal overflow or clipped store-row/SKU content. On phones the store control remains a dropdown.
- Updated scaling captures and geometry results are in `output/pack-workflow-20261021/scaling/`.
