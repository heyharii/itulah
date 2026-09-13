# Supplier bill — matching, posting, payable and payment

**Status:** target model, with the current implementation recorded beside it.
Owner decisions of 2026-09-12 are incorporated, including the correction of the
same date: **accounting enters the chain here and nowhere earlier.** Code
references are read off `feat/handheld-rfid` at `537739a`.

Vocabulary: [`../CONTEXT.md`](../CONTEXT.md). Before this:
[receiving — verification](./receiving-verification.md).

This is the Finance end: the supplier asks to be paid, Finance decides whether
the ask agrees with what was ordered and what was accepted, books it, and only
then does anything leave the bank.

---

## 1. Two documents, one supplier

| | **Supplier Invoice Document** | **Supplier Bill** |
|---|---|---|
| What | The paper or scan that arrived with the lorry | Finance's record of what is claimed |
| Who holds it | The DC, at the bay | Finance / AP |
| What it is | Evidence that a claim exists | An accounting document |
| Can it be paid | No | Yes, once matched, posted and approved |

The bay captures the document. Finance keys the figures, because Finance is who
must stand behind them — asking the busiest person in the warehouse to
reproduce a tax breakdown that Finance will type again is two versions of one
truth and one of them will be wrong.

---

## 2. What a bill covers

A bill **adopts accepted receipts**. The relation is explicitly many-to-many at
the receipt-line level, because suppliers bill the way they please:

```
one bill     ──▶ several accepted deliveries   (a week's lorries, billed monthly)
one delivery ──▶ several bills                 (goods now, freight later)
```

The common case — one bill, one delivery — is what the screen optimises for; it
is not what the schema assumes.

A bill carries: the supplier, the site that owes it, its own number and date,
due date, subtotal, tax, discount, total, the scan, **and the accepted receipt
lines it claims to cover**.

---

## 3. The match

Three sources, compared side by side:

```
PURCHASE ORDER        what Procurement agreed
ACCEPTED RECEIPTS     what the DC actually accepted
SUPPLIER BILL         what the supplier is claiming
```

| Comparison | Tolerance | Who resolves a difference |
|---|---|---|
| Quantity billed vs accepted | **zero** | Procurement / the buyer |
| Unit price billed vs the receipt's snapshot, or the approved decision where one exists | **zero** | Procurement / the buyer |
| Total arithmetic and rounding | a Finance-configured threshold | Finance |

Rounding tolerance and commercial tolerance are different things and are never
mixed: nobody may wave through a quantity or a price difference because they
hold a payment permission. A rounding difference is arithmetic; a price
difference is a negotiation.

```
✓ matched              → post, then ready to pay
⚠ quantity mismatch    → buyer decides; nothing is posted meanwhile
⚠ price mismatch       → buyer decides; nothing is posted meanwhile
⚠ rounding only        → Finance clears it within policy, then posts
⚠ no receipts adopted  → not postable and not payable: the claim has no support
```

**Nothing is posted before the match is clean.** A discrepancy is the ordinary
case, not an exception, and posting a liability that is then reversed,
adjusted and reposted turns every disagreement into four journal entries
nobody can read. Finance posts once, at the amount it validated.

---

## 4. The accounting ladder

Using the client's own accounts, per site (`HO`, `C001`…`C013`):

**1. Acceptance at the DC** — see
[verification](./receiving-verification.md). Operational stock moves.

```
(no journal)
```

**2. A bill is recorded** — Finance keys the claim and adopts the receipts it
covers.

```
(no journal)
```

**3. The match clears, and Finance posts — once**, at the **financially
approved value**: the receipt's own evidence plus any approved commercial
decision about it.

```
Dr  1011201001  Persediaan Barang Dagangan          matched goods value
Dr  1011302004  Prepaid VAT (PPN Masukan)           tax as the invoice states it
    Cr  8010110003  Potongan Pembelian              discount as agreed
    Cr  2012001001  Hutang Suppliers Barang Dagangan   invoice total
```

**4. Payment** (already implemented)

```
Dr  2012001001  Hutang Suppliers Barang Dagangan
    Cr  bank / cash
```

Three notes:

- **No holding account exists in this chain.** No GRNI, no suspense payable, no
  temporary account — migration `0052`'s original reasoning stands: there is
  nowhere honest in this client's books to put an obligation the company has
  not yet validated, and the answer is to report the gap, not to invent an
  account for it.
- **Purchase discount keeps its existing presentation** as its own line
  (`8010110003`, under other income). A procurement refactor is not the place
  to restate the client's P&L.
- **The posting is the same shape the code already produces** (`payables.rs:857`).
  What changes is not the entry, it is what must be true before it may be made.

---

## 5. The exposure, and the AP work queue

Between acceptance and posting, the warehouse holds goods the ledger has never
heard of. That gap is real and is reported rather than hidden:

> **Accepted receipts Finance has not yet matched and posted**, per supplier,
> per site, aged from the day of acceptance, valued at the **expected value**
> carried on the receipt — matched quantity × the price snapshotted at
> acceptance, less its share of the order discount.

An invoice may well exist; what makes a receipt part of the exposure is that
nothing has been validated yet. Each row says which case it is:

```
NO_INVOICE          nothing has arrived for these goods
AWAITING_MATCH      an invoice exists and has not been matched
QUANTITY_MISMATCH   matched, and the quantities disagree
PRICE_MISMATCH      matched, and the prices disagree
```

It is labelled an **exposure**, never a payable, because nothing has validated
it. It is the list AP works through each week to chase missing invoices, and
the list that answers "what is in the warehouse that the books do not show yet".

The mirror list — **bills awaiting match** — is the same queue from the other
side: claims that arrived without support, or with support that does not agree.

---

## 6. Bills with no purchase order

Not every supplier liability comes through procurement — electricity, rent,
internet, professional fees, reimbursements. Those follow their own path and
must never be forced through three-way matching:

```
Bill / claim  →  approval + supporting evidence  →  payable  →  ready to pay  →  payment
```

This path already exists as the EXPENSE bill (`payables.rs:682`), which carries
its own lines naming the account each cost belongs to and credits
`non_merchandise_payable` (`2012001003 Hutang Supplier Non Barang Dagang`).
Nothing in this document changes it.

---

## 7. As-is — what the code does today

**Exists and works:** the bill itself (`supplier_invoice`, `0052`) with status
`DRAFT → MATCHED → POSTED`, plus `REJECTED` and `VOID`; unique per supplier and
number; a CHECK that total = subtotal + tax − discount; a trigger that refuses
to edit a posted bill's amounts; posting (`payables.rs:857`) in exactly the
shape of §4.3; ageing over bills and payments (`payables.rs:1106`); payment
settlement; and the expense-bill path.

**Missing or wrong:**

| | Gap | Evidence | Fix |
|---|---|---|---|
| **G1** | A bill adopts nothing. `supplier_invoice_receipt` has one reader and **no writer**, and `record_bill` takes no receipt ids | `payables.rs:1013`, `payables.rs:682` | Accept receipt lines when recording a bill; write the link |
| **G2** | A merchandise bill deliberately carries **no lines**, so billed quantity and billed price per item do not exist to compare | `payables.rs:682` refuses lines on merchandise | Give it lines that name the purchase line they claim |
| **G3** | Matching does not exist in any form | — | Compare ordered, accepted and billed; classify the outcome |
| **G4** | A bill can be posted with no receipts adopted and no match performed | `payables.rs:857` posts any DRAFT bill | Refuse to post a merchandise bill that has not matched |
| **G5** | "Ready to pay" is not a concept; `MATCHED` is a status nothing computes | `0052` | Derive readiness from the match and the posting |
| **G6** | The unbilled list can never shrink, and values goods at the order's current price rather than the receipt's snapshot | `payables.rs:999` | Follows from G1 and from the receipt snapshot |
| **G7** | No tolerance policy of any kind | — | One configurable rounding threshold; zero elsewhere |

---

## 8. Open decisions

1. **The rounding threshold.** One number, per company or per site, in rupiah.
   Recommendation: a single company-wide figure, small enough that nobody is
   tempted to use it as a negotiating tool.
2. **Who may approve a price difference?** Recommendation: the buyer who owns
   the order, never Finance, even when Finance is the one who noticed.
3. **A bill that claims more than was accepted.** Recommendation: it cannot
   post. Finance records it, matching reports the difference, and the supplier
   is asked for a credit note or a corrected invoice.
4. **Is posting a separate action from matching?** They may be one Finance
   click, but the meanings stay distinct: matched = the claim agrees; posted =
   the ledger carries it. Recommendation: one action, two recorded facts.
5. **A bill that covers part of a receipt** — 60 pieces invoiced of 98
   accepted. Recommendation: allow it; match at receipt-line level with a
   billed-quantity running total, so the remaining 38 stay in the exposure.

---

## 9. Tests this document requires

1. a bill can adopt one delivery and several deliveries;
2. an adopted receipt line leaves the exposure list;
3. a bill that matches exactly posts and becomes ready to pay;
4. a quantity mismatch posts nothing and is not ready to pay;
5. a price mismatch posts nothing and is not ready to pay;
6. a rounding-only difference clears within the threshold, and a rupiah over it
   does not;
7. a merchandise bill with no adopted receipts cannot post;
8. posting books inventory, tax, discount and the supplier payable once, and
   only once;
9. payment settles the payable and touches no receipt evidence;
10. a posted bill's amounts cannot be edited;
11. an expense bill still posts through its own path and never requires a
    purchase order;
12. the exposure total equals the sum of unmatched accepted receipts at their
    snapshotted expected value, and a receipt with an unmatched invoice still
    appears in it.
