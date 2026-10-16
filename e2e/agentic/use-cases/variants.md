# Use cases: PO colour & size (variants)

Rig `agentic`, cloud-hosted warehouse (RIG_DC_HOSTING=cloud). Decisions of 10 Oct 2026 (memory `project_po_variants_2026_10`); screens and endpoints in `maps/variants.md`.
Run: `./remote.sh --config hub.config.ts --output .e2e/out/variants hub/variants`.
Status: pass / fail (bug) = the test asserts the right behaviour and the app is wrong / skip(reason). Photo upload is never tested (the rig has no bucket): photographs are plain https links sent to the API; the UI is only checked for the "Add photos of …" tile.

| ID | Actor | Preconditions | Steps | Expected | Test | Status |
|---|---|---|---|---|---|---|
| VAR-01 | rina | composer, supplier chosen | New item | Colors and Sizes comboboxes show at once, not required; Quantity to order and Price still there; no Purchase Price | hub/variants/create-po.e2e.ts::VAR-01 | PASS |
| VAR-02 | rina | Add item open | pick Black+White, M+L | Purchase Price replaces Quantity/Price; table Variant / Photos / Quantity; rows "<article> Black M" … | create-po::VAR-02 | PASS |
| VAR-03 | rina | as VAR-02 | type quantities 4,3,2,3, then 0 on one | footer "N SKUs" counts rows with a quantity, total pcs adds up | create-po::VAR-03 | PASS |
| VAR-04 | rina | Add item | colours only / sizes only | one row per colour ("<article> Black") / per size; clearing both restores Quantity | create-po::VAR-04 | PASS |
| VAR-05 | rina | variants chosen | look for Markup / Base Price / Price per Pc | none on a PO | create-po::VAR-05 | PASS |
| VAR-06 | rina | variants chosen | look at each row; Submit with no photo | tile "Add photos of <variant>" with a multi-file input; photos are optional | create-po::VAR-06 | PASS |
| VAR-07 | rina | variants chosen, no quantity, no price | Submit | "Fill in the price." AND "Fill in how many." | create-po::VAR-07 | FAIL (bug): only the price sentence shows; with variants the Quantity box is gone and the quantity gap has nowhere to be said |
| VAR-08 | rina | – | build a 4/3/2/3 order in the form, Review, Submit | composer lists the 4 variant rows; PO created; server keeps 12 pcs, 4 variants, unit price Rp 55.000, no per-variant selling price | create-po::VAR-08 | PASS (after test fix) |
| VAR-09 | API | – | variants add to 12 on a line of 10 | refused "the variants add up to 12, not the 10 ordered" | create-po::VAR-09 | PASS |
| VAR-10 | API | – | zero quantity / neither colour nor size / duplicate | refused with the three sentences | create-po::VAR-10 | PASS |
| VAR-11 | API | – | colour-only and size-only variants | accepted | create-po::VAR-11 | PASS |
| VAR-12 | API | – | 3 photos on a variant; 12; 13; non-link | stored in order; 12 ok; 13 and non-link refused | create-po::VAR-12 | PASS |
| VAR-13 | rina | PO with photos on one variant | Edit, change notes, Submit | order updated, variant photos and quantities intact | create-po::VAR-13 | PASS |
| VAR-20 | nina | variant PO | open the count sheet | one box "Counted pieces of <article> <Color> <Size>" per variant, no single line box, live line total, never an ordered figure | hub/variants/receiving-count.e2e.ts::VAR-20 | PASS |
| VAR-21 | API | variant PO | read the bay's work list | variants named (code, label, photos), never a quantity | receiving-count::VAR-21 | PASS |
| VAR-22 | nina | variant PO | count every variant as ordered, Submit count | PO fully received on its own (12) | receiving-count::VAR-22 | PASS |
| VAR-23 | nina | variant PO | count 3/4/2/3 (same total 12) | NOT auto-received; waits for review with per-variant figures | receiving-count::VAR-23 | PASS |
| VAR-24 | nina | variant PO | leave one variant blank (short) | blank = 0; total 10; waits for review (−2) | receiving-count::VAR-24 | PASS |
| VAR-25 | nina | variant PO | exact variants + Not as Ordered 2 | count 14, wrong 2, variants sum 12; not auto-received | receiving-count::VAR-25 | PASS |
| VAR-26 | nina | variant PO | type 2.5 / abc in a variant box | box keeps digits only; Submit count stays disabled when empty | receiving-count::VAR-26 | PASS |
| VAR-27 | nina | variant PO | only Not as Ordered 3 | valid count | receiving-count::VAR-27 | PASS |
| VAR-28 | API | variant PO | sum ≠ line / variant never ordered / duplicate / negative | each refused with its sentence; no count left behind | receiving-count::VAR-28 | PASS |
| VAR-29 | nina | PO with a split line and a plain line | count both | per-variant boxes on one, single box on the other | receiving-count::VAR-29 | PASS |
| VAR-30 | nina | PO without variants | count 8 | single "Counted PCS of <code>", received 8 (regression) | receiving-count::VAR-30 | PASS |
| VAR-31 | API | variant PO | count as a whole, no breakdown | accepted (older client) | receiving-count::VAR-31 | PASS |
| VAR-40 | rina | variant count 3/4/2/2 | open Review Count | variant rows: Ordered, Counted, signed difference, Matches | hub/variants/review-count.e2e.ts::VAR-40 | PASS |
| VAR-41 | rina | same total, different mix | Review, Submit | not auto-received; swap visible; Submit receives 12 | review-count::VAR-41 | PASS |
| VAR-42 | – | exact per-variant count | – | received without review (control) | review-count::VAR-42 | PASS |
| VAR-43 | rina | short variant count | Close Short | short received 10, rest closed | review-count::VAR-43 | PASS |
| VAR-44 | rina | short variant count | Partial Receive | 10 received, 2 outstanding | review-count::VAR-44 | PASS |
| VAR-45 | rina | variant with 3 photos | Review | photo button + "+2" on that variant only | review-count::VAR-45 | PASS |
| VAR-46 | API | counted PO | read awaiting counts | ordered/outstanding/counted + labels per variant | review-count::VAR-46 | PASS |
| VAR-47 | rina | split + plain line | Review, Submit | variant rows only under the split line; both received | review-count::VAR-47 | PASS |
| VAR-48 | rina | variant count waiting | Recount | the bay is asked to count again | review-count::VAR-48 | PASS |
| VAR-49 | rina | plain count waiting | Recount | control for VAR-48 | review-count::VAR-49 | PASS |
| VAR-50 | rina | counted 3/4/2/3 of 4/3/2/3, accepted | open New Articles sheet | grid cells 3/4/2/3, "12 of 12 · 4 SKUs" | hub/variants/new-articles-grid.e2e.ts::VAR-50 | PASS |
| VAR-51 | rina | White M did not come | open sheet | cell starts at counted (0), not ordered | new-articles-grid::VAR-51 | PASS |
| VAR-52 | rina | counted as a whole | open sheet | cells start at ordered quantities | new-articles-grid::VAR-52 | PASS |
| VAR-53 | rina | photos on two variants | open sheet | cell photos small with "+N"; first photo of each colour at the colour head | new-articles-grid::VAR-53 | PASS |
| VAR-54 | rina | no photos | open sheet | none in cells or heads | new-articles-grid::VAR-54 | PASS |
| VAR-55 | API | delivered variant PO | unidentified list | variants carry image_urls and counted_quantity | new-articles-grid::VAR-55 | PASS |
| VAR-60 | rina | variant article in stock, with a picture link | New allotment | 32px thumbnail on the article | hub/variants/allotment-thumbnails.e2e.ts::VAR-60 | PASS |
| VAR-61 | rina | same | Unallotted list | 32px thumbnail | allotment-thumbnails::VAR-61 | PASS |
| VAR-62 | rina | an allotment of it | allotment sheet | 32px thumbnail | allotment-thumbnails::VAR-62 | PASS |
| VAR-63 | rina | same | tap a thumbnail | photo opens full size and closes | allotment-thumbnails::VAR-63 | PASS |
| VAR-70 | rina | – | upload a photo from the Add item tile | stored link, tile shows it | – | skip: the rig has no storage bucket |
| VAR-71 | rina | – | New Articles setup keeps the first photo of each colour as the colourway photo | – | – | skip: needs the bucket-backed picture route; only the prefill is covered (VAR-53) |

## Notes

- Run of 11 Oct 2026 on the rig: 47 tests, 46 pass, 1 red (VAR-07, tagged `bug`).
- VAR-48/49: the hub build on :5580 still asks which lines and why before a Recount (the old flow of RV-08); the newer source (count-review.tsx) sends straight back. The test drives either, and asserts the bay's work line carries `recount_reason`.
- Existing suites that the feature or the new hub build breaks (not touched here): every receiving test that types `Counted PCS of <code>` on a PO made by `rig.placePo` / `po.newPo` (those POs are split into 4 variants, so the sheet now has per-variant boxes: hub/receiving/count.e2e.ts RCV-05, 10-18 and others); `support/outbound.ts` `openAllotments` (waits for an "Allotted" tab, the page now has Unallotted · In progress · Completed · Cancelled) and `openAllotmentSheet` (waits for the text "Lines"), which break hub/outbound/*; hub/receiving/review.e2e.ts RV-08 (Recount flow).
