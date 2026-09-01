# Navigation registry vs. the ollama prototypes

`src/lib/navigation.ts` is grounded in what `backend/src/cloud/http/mod.rs`
actually serves — 147 endpoints. The prototypes design a considerably wider
information architecture. Both are right; they are answering different
questions, and the gap is recorded here rather than resolved by adding screens
with nothing behind them.

A nav entry whose endpoint does not exist is worse than a missing entry: it is a
screen somebody opens once, finds empty, and stops trusting the app over.

## Modules the design has and this app folds elsewhere

| Prototype module | Where it lives here | Why |
|---|---|---|
| **Catalog** (Article Master, SKU Lookup, Divisions, Tags, Variant Matrix, Barcode & RFID) | under Procurement | The cloud node serves 4 catalogue endpoints (vocabulary + images). A nine-item module on four endpoints is mostly empty rooms. Promote it when article master data lands. |
| **Distribution** (Transfer Orders, Pick & Pack, Shipments, In-Transit, Store Receiving, Reverse Logistics) | under Inventory → Allotments / Returns | The cloud holds allotments and returns; picking, packing and receiving are **edge** operations (`src/edge/http.rs`) and belong to `frontend-dc`. |

## Screens the design has and this backend cannot serve yet

Not built, deliberately. Listed so they are proposals rather than oversights.

- **Commercial** — Campaigns, Markdown, Vouchers & Deposits, Loyalty, Customers
  & Members. The cloud serves 7 commercial endpoints (price books, prices,
  simulate, fleet); none of these five has one.
- **Finance** — Budget & Forecast, Tax & Compliance, Inventory Accounting,
  Close & Reports as separate screens. The 21 finance endpoints cover the
  ledger, position, bills, bank and assets.
- **People** — Payroll, Leave & Overtime, Claims & Advances, Onboarding,
  Performance & Training, Biometric & Devices. The cloud serves 7 employee
  endpoints; the rest of HR is not on this node.
- **Store ops** — Shift Close, Cash Deposit, Cash Difference, EDC Settlement,
  POS Devices, Incidents, Checklists. These are **store-edge** concerns and
  belong to `frontend-store`, not to the central console.
- **Analytics** — Dashboards, Sales BI, Customer Retention, Report Catalog.
  Three report endpoints exist.
- **System** — Permissions, Approval Workflows, Thresholds, Feature Flags,
  Integrations, Audit Log. Users, roles, sync and notifications exist; the rest
  does not.

## What to do with this file

When an endpoint family lands, add the nav entry to that module's own
`src/screens/<module>/nav.ts`, write the screen, register it in the module's
`index.ts`, and delete the line here. The router is generated from the registry,
so those are the only three edits.

## Found by walking the flow (2026-09-02)

**The chain from an accepted delivery to a tagging job is broken in the
browser.** Walking sourcing → basket → PO → sync → DC count → verify → accepted
→ head office, the goods arrive in Procurement → Article setups → "Awaiting
identity" and stop there: that table has no row action and no button, and
`POST /api/v1/article-setups` (open a setup session) is not called anywhere in
the client. Nothing can give a delivery its identity, so no article is minted
and the DC's tagging queue stays empty for ever — its own empty state says
"head office issues these when goods are accepted", and head office cannot.

The endpoint exists and works. What is missing is one mutation in
`lib/queries/procurement.ts` and one action on the "Awaiting identity" tab.

The path-only endpoint audit could not see this: `GET` and `POST` share
`/api/v1/article-setups`, so the route looked covered. Method-level gaps are
now listed by hand in `scripts/endpoint-audit.mjs` — see `KNOWN_METHOD_GAPS`.
