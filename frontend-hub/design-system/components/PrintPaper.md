# PrintPaper

The template for a printed paper: a document in its own right, ink on white at the sheet's real size, in the language of the person who holds it, with the company's letterhead, one number, one table and the lines to sign on. It is the one place text may be smaller than 15px.

## Copy this screen

- The outbound papers: `frontend-hub/src/components/operations/outbound-papers.tsx` (`SuratJalanPaper` is the one the card draws, A4 portrait). The purchase order's head is drawn from `screens/procurement/po-print.ts`.
- Start from them for any document somebody prints, signs or hands over. The A5 papers are the packing list, the picklist and the PO.

## When to use it

| The paper is | Use |
| --- | --- |
| Handed over with goods: a delivery note, a packing list, a picklist, a return note | PrintPaper, A4 or A5 |
| Sent to a supplier: a purchase order | PrintPaper, in English |
| Signed: a cash slip, a letter | PrintPaper, A4 |
| The bank's own leaf (giro) | Its own template: millimetres from the paper's corner |
| Read on a screen only | Not paper: a Sheet |

## Slots, top to bottom

The paper's parts, in this order. Ink on white: no tint, fill, photograph or shadow on the sheet (the shadow in the card is the desk).

| Part | Drawn as |
| --- | --- |
| Letterhead | At the left the company in capitals (WIRA, 600, tracking 0.04em) and its address; at the right the title and the number. A 2px ink rule under both (14px of space after it on the outbound papers). The company is `COMPANY` in `screens/finance-lab/print.tsx`. |
| Title | Capitals, as the client writes them: SURAT JALAN, PACKING LIST, PICKLIST, PURCHASE ORDER, SURAT JALAN RETUR. 24px on 28px on the outbound papers, 18px on the PO and the return note. The number under it, in mono, on paper only. |
| Facts | The label in grey, the value in ink, two columns 14px apart, 4px between lines: Kepada, Tanggal; To, Delivery date, Payment. A line to write on is a dotted rule under a grey label ("Data perjalanan"). |
| Table | The heading at 600 over a 1.5px ink rule, a hairline between rows, figures right-aligned, a total at 600 under a 1.5px ink rule. |
| Note | One sentence in a darker grey under the table. The PO's terms stand at the foot. |
| Signatures | Last: a 1px ink rule over each caption, 96px of white above it for the pen. |
| QR | Opens the record while the paper travels: 29mm on a surat jalan (one per shop), 20mm on an open PO, 24mm on a packing list. A finished PO wears its stamp instead. |
| Stamp | Tilted −12deg, a 3px rule round the word and day, 55% opaque; green for received, red for cancelled. It is `DocStamp`'s idea, in capitals. |

### Where each paper lives

| Paper | Sheet | File |
| --- | --- | --- |
| Surat jalan, one shop · one trip | A4 portrait, 13mm sides, 12mm top | `components/operations/outbound-papers.tsx` (`SuratJalanPaper`, `TripSuratJalanPaper`) |
| Packing list, inside the koli | A5 portrait, 9mm | `outbound-papers.tsx` (`PackingListPaper`) |
| Picklist, taken to the racks | A5 portrait, 9mm | `outbound-papers.tsx` (`PicklistPaper`) |
| Purchase order | A5 landscape; A4 landscape; both upright; 8mm 10mm | `screens/procurement/po-print.ts` (HTML), `po-pdf.ts` (PDF), opened by `purchase-orders.tsx` through `PrintMenu` |
| Return delivery note, two copies | A4 portrait, 14mm 16mm | `procurement/return-print.ts`, `return-pdf.ts`; its QR opens `screens/public/return-note-page.tsx` |
| Letters: delivery note, goods receipt, general, supplier return | A4, 14mm margin | `screens/letters/document.tsx` (`LetterPaper`) |
| Written letters: goods out/in, handover, authority, assignment, warning, employment, notice, request, blank | A4 or A5, 1–3 named copies (Lembar 1 · Asli …) | `screens/letters/written.tsx` (`WrittenPaper`, `PrintCopies`), PDF `letter-pdf.ts`; forms in `forms.ts` |
| Cash slip, BKK and BKM | A4, 14mm margin | `screens/finance/cash-documents.tsx` (`SlipDocument`) |
| Giro leaf | the bank's size in mm, no margin | `screens/finance/giro-print.tsx` (`Leaf`) |

### Type, ink and language

| | Outbound papers | PO | Return note | Letters | Cash slip |
| --- | --- | --- | --- | --- | --- |
| Body | 14px on 19px | 14px; 12px upright | 13px | 14px; the head 15px | 15px |
| Ink | `#111`, grey `#555`, rules `#ccc` | `#1d1f1a`, `#5b6158`, `#d9dbd6` | `#1d1f1a` | tokens | tokens |
| Words | Indonesian | English | Indonesian | Indonesian; the return in English | English labels, Indonesian "Terbilang" |
| Dates | 17 Oktober 2026 | 16 Oct 2026 | 16 Oct 2026 | 17 Oct 2026 | 16 Oct 2026 |

- A paper speaks one language, the one of the person who holds it. The warehouse, shops and drivers hold Indonesian papers; the PO went to English on 4 Oct 2026 ("di print itu jangan bahasa indo"). `dayIndonesian()` writes the long month; the screens never use it.
- Money is `Rp 2.040.000` and quantities "90 pcs" on every paper.
- The client's own capitals stay (white.css keeps `.cashdoc-print` and `.giro-print` out of sentence case): the company, the titles, the stamp's words, and a giro's payee when "Print in capitals" is on.
- A paper keeps the client's own wording for its form: Kepada, Tanggal, Jumlah, Keterangan, Hormat kami.

### Signature captions

| Paper | Captions |
| --- | --- |
| Surat jalan | Dibuat oleh · Pengemudi · Diterima oleh |
| Picklist | Diambil oleh · jam · Diterima packer · jam; a Catatan box |
| Letter, delivery note | Dikirim oleh · Dibawa oleh · Diterima oleh |
| Letter, goods receipt | Pengirim / Pemasok · Diperiksa oleh · Diterima oleh |
| Letter, general | Hormat kami · Diterima oleh |
| Letter, supplier return | Person in charge · Received by — supplier |
| Return delivery note | Hormat kami, (the company) · Penerima, (the supplier) |
| Cash slip | Prepared by · Checked by · Approved by |
| Purchase order | None: "This document is system-generated and needs no signature." |

### How it prints

- The paper is the same DOM on screen and on the sheet: an overlay with `@page` set to its size and `@media print` hiding the app (outbound), or a window opened inside the click and written whole (PO, return note, supplier card), or the app hidden around the paper by `visibility` (letters, slips, giro). A PDF is written line by line by jsPDF (Helvetica 9pt on a PO) and downloads without the print dialog.
- The overlay's bar says what it is and its size ("Delivery note", "A4 · one per shop"), then Print (primary) and ×.

## On a phone

A phone prints through the browser like a desk. The overlay has no fit-to-width: it scrolls the sheet at its real width inside its box. Nothing else changes: a paper is not a screen.

## Rules

Do:
- Draw a paper at its real sheet size and say the size on screen.
- Give it the parts in order: letterhead, facts, table, note, signatures.
- Write it in one language and keep the client's wording for its form.
- Keep a QR on a paper that travels.

Don't:
- Use screen styles on paper (a pill, a dot, a tab, a button) or paper styles on screen (a 14px label).
- Print the app: a paper is not a screenshot, and the sidebar never reaches it.
- Use colour for anything but a stamp and a PO's received figures.

## Retired

Follows it: every paper keeps the same bones (letterhead rule, grey labels, ruled table, signature rule).

Drifts, on the reference papers themselves:
- Three inks: the `#111` family in the outbound papers, `#1d1f1a` in the PO and the return note (HTML, and `[29, 31, 26]` in the PDF), tokens in letters, slips and giro.
- A dark backdrop and 14px on a screen: the overlay is `bg-ink/55` (`outbound-papers.tsx:99`), its note is `text-[0.875rem]` (`:103`), and "Reading the koli…" is 14px white on it.
- Two languages on one paper: the packing list says Toko, Tanggal, Dikemas and also "Quantity", "Total"; the return note says Kepada and "Quantity" and dates in English. The PO's language is settled; the other papers' is the owner's open question D16.
- Bold titles as `font-bold` (`outbound-papers.tsx:168`, `:256`) and bold stamps, each paper with its own stamp CSS (`po-print.ts`, `return-print.ts`: `#78b896`, `#2f5fd0`). Use one stamp look.
- Stamp tones that disagree with `DocStamp`: the PO print draws CLOSED SHORT in green and CANCELLED in red; on screen Closed short is `bad` and Cancelled is `mute`.

Drifts elsewhere:
- Four ways to print, and the print CSS copied into `outbound-papers`, `letters/document`, `cash-documents`, `giro-print` and `finance-lab/print`.
- `COMPANY` lives in the unrouted `screens/finance-lab/print.tsx`; the rest of that folder is dead.

## What you provide

| Piece | Prop | Notes |
| --- | --- | --- |
| `SuratJalanPrint` | `shipmentIds`, `open`, `onClose` | `tripNote`, `siteId` optional. One A4 per shop. |
| `TripSuratJalanPrint` | `dispatchId`, `open`, `onClose` | One A4 per truck. |
| `PackingListPrint`, `PicklistPrint` | `koliIds` or the allotment's lines, `open`, `onClose` | A5. |
| `purchaseOrdersHtml` | `orders`, `phone`, `paper`, `variantName` | `Paper` is `A5`, `A4`, `A5-portrait` or `A4-portrait`. |
| `PrintMenu` | `onChoose({ paper, pdf })` | Print or Download PDF, then the paper. |
| `LetterPaper` | `letter`, `editable`, `onFact` | The letter on its sheet. |

Source: `frontend-hub/src/components/operations/outbound-papers.tsx`, `screens/procurement/po-print.ts`, `po-pdf.ts`, `return-print.ts`, `print-menu.tsx`, `screens/letters/document.tsx`, `screens/finance/cash-documents.tsx`, `giro-print.tsx`; `styles/white.css` (sentence case, except printed documents).
