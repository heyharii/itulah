# Table flow — verification, 21 October 2026

Current entry: `pack-options-3.html`. The user's four-tab table flow replaces the A–D workspace proposals.

## Checks

- JavaScript syntax checks passed for `pack-table.js` and `pack-table-model.mjs`.
- Seven table-model tests passed: sealed-only records, globally ordered picklists, atomic creation on seal, rejection of invalid quantities without allocating a number, picklist scope, dispatch from three stores, and successive koli quantity conservation.
- All four tabs were visually reviewed at 1440 × 1000 and 375 × 812. No document-level horizontal overflow or overflowing tab strip. Wide tables scroll within their frame; Picked fits the phone width.
- Pack and Dispatch forms were reviewed at 375 × 812. No sheet or footer overflow. Quantity inputs use 16 px text.

## Browser journeys

1. Open Cikupa Pack with 18 available pieces. Enter 2, close without seal: quantity stays 18, Packed stays 12 koli.
2. Reopen and seal 2: record A02000 is created, available Picked becomes 16, Packed becomes 13 koli.
3. Enter an unfinished next koli of 1, then close and reload: only A02000 survives, with 16 still in Picked. No unsealed record or number was saved.
4. Select A02000 from Cikupa, A00104 from Jambi, and A00106 from Muaro Bungo: 3 koli, 3 stores, 26 pieces. Dispatch creates one trip, which appears in In transit and persists after reload. Its detail groups the three destinations.
5. Picklists appear globally in order: PL-00000032, 33, 36, 37, 38, 43, 44, and onward. Record the remaining 2 for PL-00000036: its picked quantity becomes 22/22, and Cikupa's available Picked increases by 2.
6. Enter 999 for a SKU with 4 available: inline validation appears and Seal is disabled. Correcting to 2 enables sealing.

Captures and geometry: `output/pack-table-20261021/`. Demo data is isolated from the older proposals and production data. No production API, physical printer, or scanner was exercised. Native print dialogs were not submitted.
