# Retail POS design prototype

Open http://localhost:5398/pos/ for the desktop and tablet previews.

The shell follows pos-electron: a header, a left work pane (scan · member · diskon · utilitas), a right transaction pane (keranjang · total · pembayaran · aksi), and payment as its own full page — not a dialog. The visual language stays this prototype's own: pale grey ground, white cards, restrained borders, blue primary actions, Inter. Desktop keeps F1–F12; tablet enlarges the touch targets, drops the keyboard hints, and fits the cash pad without scrolling.

## Quantity follows the tags

Stock is RFID-tagged, so a cart line counts the units that were actually read — there is no +/− stepper. A line expands to the EPC of every unit; a unit entered by barcode or as an emergency SKU has no tag and is flagged `TANPA TAG`. Removing a unit or a line needs supervisor approval, because it means putting a physical garment back.

## Source alignment

Explored read-only: `/Users/hari/Documents/retail/pos-electron`. Relevant source: `renderer/routes/index.tsx` (pane split, `posMode`, F-keys), `renderer/components/pos/payment-mode.tsx` (payment page: method tiles, bank chips, numpad, presets, Enter/Esc — its summary rail sits on the right here, the same column the cart screen keeps its totals in), `cart.tsx`, `header.tsx`, `totals.tsx`, `payment-panel.tsx`, `action-bar.tsx`, `scan-input.tsx`, `member-panel.tsx`, `success-overlay.tsx`. Structure and wording were taken from there; colour, type and shadow were not.

Implemented flows: barcode/SKU scan with quantity prefix, product lookup, floor/warehouse/sold-out stock states, supervisor approval, emergency SKU, member search and registration, vouchers, points, bags, hold/resume, four payment methods with split payment, cash change with denomination breakdown, success overlay, receipt/history, RFID tag dedupe, offline block, lock, shift open/close, and a four-step example exchange.

## Try

- Initial basket: Rp 516.000. Pay Rp 600.000 to see Rp 84.000 change and how to hand it back.
- Scan `3*8991234000101`, or search a product. Expand a line to see its tags.
- Chino has warehouse-only stock; Jeans demonstrates the sold-out state.
- Member Rina Wati, then HEMAT50K or DISC10PCT. Points: minimum/step 100, maximum 50% of subtotal.
- On the payment page, Debit → `Split ½` records a partial payment; the rest can go on another method. Recorded payments cannot be removed.
- Connection menu simulates offline, blocking checkout and scans.
- Return: leave lookup blank to use CONTOH-001. This is a fixed one-item exchange scenario.

## Prototype boundaries

All data is illustrative and in memory; reload resets it. No production API, payment terminal, camera, RFID reader, biometric reader, stock movement or refund is invoked. Inventory quantities, the 11% included tax example, and the bag charge are design fixtures, not production configuration. Supervisor approval is explicitly simulated. Tablet is a design adaptation, not an existing source route. Return policy breadth, multi-item returns, EDC photo/OCR, denomination reconciliation, device settings, pairing/bootstrap, and the customer display remain outside this prototype.

Validation: `node prototypes/pos/pos.test.cjs` covers totals, tender validation, split completion, duplicate RFID tags, holds, offline, sold-out and supervisor gates. Browser checks cover desktop/tablet rendering, the split and cash checkout, every data-attribute click path, and that the payment pad fits without scrolling on both shells.
