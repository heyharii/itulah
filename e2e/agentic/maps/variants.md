# PO colour & size (variants) — map (10 Oct 2026)

Owner's decisions: memory `project_po_variants_2026_10`. Migrations 0961 (`purchase_order_line_variant.image_urls`, ≤12) and 0963 (`dc_receiving_count_variant`, `dc_receiving_count_breakdown()`).

## Screens, labels, file:line (frontend-hub/src/screens)

| Screen | Route | Exact labels | Source |
|---|---|---|---|
| New PO › Add item | `/procurement/orders?new-order=true` → "New item" | combobox `Colors`, `Sizes` (optional); with either chosen: textbox `Purchase Price` (per pc), table columns `Variant` · `Photos` · `Quantity`, spinbutton `Quantity of <COLOURCODE> <size code>` (e.g. `Quantity of BLACK 03`), row cell `<article> <Color> <Size>`, footer `N SKUs` + total pcs, tile `label[title="Add photos of <article> <Color> <Size>"]` (multi file input) | procurement/item-form.tsx (canSplit ~640, byVariant ~685, gaps ~713), line-pricing.tsx:100-250 (VariantGrid), variant-photos.tsx:87 |
| New PO composer line | same | variant sub-rows `Black M 4 pcs` under the line (no "N SKUs" text on the composer) | procurement/composer.tsx ~2290, items-table.tsx |
| Ops › Receiving count | `/operations/intake` → row → sheet | per variant `Counted pieces of <article> <Color> <Size>`; line total live ("8 pcs"); `Not whole pieces`; unsplit lines keep `Counted PCS of <code>`; `Total Counted`, `Not as Ordered`, `Submit count`, toast `Count sent` | operations/intake/receiving.tsx:1180-1270 (variant boxes), :955 piecesOf, :1048 entries |
| Review Count | `/procurement/orders?verify=<PO>` | line row, then one row per variant: `<article> <Color> <Size>`, Ordered (outstanding) · Counted · difference `−1 pc` / `+1 pc` / `Matches`; photo button `View the photo of <name>` + `+N`; buttons `Recount` (immediate, no reason), `Close Short`, `Partial Receive`, `Submit` | procurement/count-review.tsx:787-835 (phone), :896-1010 (desk), VariantDiff ~1644; procurement/variant-photo.tsx |
| New Articles sheet | `/master/new-articles?receipt=<receipt_line_id>` | grid cell `<article> <Color> <Size> pieces` pre-filled from COUNTED quantity per variant (else ordered); cell photo button `View the photo of <article> <Color> <Size>` (+`+N`); colour row head `View the photo of <Color>` | procurement/setups.tsx:2095 prefillFromReceipt, :2954 orderPhotoOf, :2971 orderPhotosAt, :3496/:3533 |
| Allotment | `/allotment/new?supplier=0001&articles=<id>`, `/allotment` (Unallotted), `/allotment?allotment=<id>` | 32px `ArticleThumb` → button `View the photo of <article>` (only when the article has a picture link), else silhouette `title="No photograph yet"` | allotment/article-thumb.tsx; to-allot.tsx:468, allotments.tsx:482/1824, matrix.tsx:2313/2516, items.tsx:122, amend-sheet.tsx:139 |

## Endpoints

| Call | Notes | Source |
|---|---|---|
| `POST /api/v1/purchase-orders/catalog` | line `variants[] {colour_code,size_code,quantity,base_price_minor,image_urls}`; refusals: "the variants add up to X, not the Y ordered", "every variant needs a positive quantity", "a variant names a colour, a size or both", "the same colour and size appears twice", "more than 12 photographs", "a variant's photograph is not a link" (http/https only) | backend/src/cloud/postgres/suppliers.rs:2985-3045 |
| `GET /api/v1/purchase-orders/{id}` | `lines[].variants[]` incl. `image_urls` | suppliers.rs:3516 |
| `GET /api/v1/dc/purchase-orders` | work line `variants[] {colour_code,colour_label,size_code,size_label,image_urls}` — never an ordered quantity (blind) | dc/receiving.rs:289-345, contract PurchaseWorkVariant |
| `POST /api/v1/dc/purchase-counts/batch` | `counts[] {po_line_id,counted_quantity,wrong_quantity,variants[] {colour_code,size_code,counted_quantity}}`; rule: sum(variants) = counted − wrong; refusals "the variants come to X pieces and the line to Y", "was not ordered on this line; count those pieces as Not as Ordered", "counted once on a sheet", "less than nothing" | dc/receiving.rs:672-860 |
| `GET /api/v1/dc/purchase-counts` | awaiting review; `variants[] {…,ordered_quantity,outstanding_quantity,counted_quantity,image_urls}` | receiving.rs:1304-1357, 0963 `dc_receiving_count_breakdown` |
| auto-receive | waits when any variant's counted ≠ outstanding even if the line total matches, or wrong>0 | receiving.rs:2180-2195 |
| `GET /api/v1/article-setups/unidentified` | `variants[]` with `image_urls`, `counted_quantity` (null when counted as a whole) | postgres/tagging.rs:1538 |
