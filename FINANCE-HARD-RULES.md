# Finance — hard rules, owner policy, and what is still open

**Status:** canonical as of 25 Sep 2026 (evening), with the owner's 27 Sep decisions (I10, P1, P18, T1–T4, T10) folded in: where the client (7Soft) and ERPNext decide something, we follow them; a policy becomes a setting rather than code. Supersedes the conflicting
summaries. The chart is **263 active client posting accounts**: `0348` seeded
267; `0375` retired 2003 and `0377` retired 1110, 2032, 4009 and 4010 (262);
`0380` reopened 1110 Disposed Inventory, manual-only, for the client's opening
balances (263). The old "43 akun final" wording in `FINANCE-COA-COVERAGE.md`
described a model the brief retired; that file now points here.

Companion documents, in order of authority:

1. `FINANCE-CONNECT-BRIEF.md` — the owner's decisions of 25 Sep (the source).
2. **this file** — those decisions as rules, with the invariant / policy / open
   split the owner asked for.
3. `runs/finance-connect/2026-09-25/ACCOUNT-DECISIONS.md` — meaning → account,
   with confidence.

Three categories, and an agent must not mix them:

- **INVARIANT** — true by architecture. A change here is a re-architecture, not
  a configuration. Guards and tests enforce them.
- **OWNER POLICY** — a business choice the owner has made. It can change, but
  only by a new decision, never by a guess.
- **TO_CONFIRM** — not decided. It must not be hard-coded; a posting on it is
  refused or marked, never defaulted silently.

Books are kept per **unit** (owner, 27 Sep; migrations 0605–0609): head office
is the unit of kind `HO` (id `ho`, found by its kind and never by its id) and
the stores C001..C013 are the units `store-01`..`store-13`. A site is a
premises that belongs to one unit — head office's Gudang is the site `dc` — and
a document that happens at a site is booked to its unit (`unit_of_site`). Where
this file says "unit" it means head office or a store; "a unit" opposite "head
office" means a store unit.

---

## 1. INVARIANTS (enforced)

| # | Rule | Where it lives | Test |
|---|---|---|---|
| I1 | Domain holds the event, Finance holds the journal. | `poster.rs` is the only writer of `journal_entry`/`journal_line` | — |
| I2 | Only Finance HO writes manual journals, and Finance HO may post to **every account of every unit** (a manual journal may target any store). Stores have no manual-journal access whatsoever; units record events. | `manual_je_policy`, `HAND_KEYED_KINDS` (`ledger.rs`); HTTP role check on `/api/v1/finance/journal` | `finance_api_integration::a_shop_role_cannot_post_a_manual_journal`, `finance_hard_rules::finance_ho_posts_prive_on_a_stores_books` |
| I3 | Every entry balances, and every unit balances in its own books. | `interunit::balancing_legs`, deferred trigger `journal_line_balances_per_unit` (0605; per site from 0120) | `finance_connect_integration::every_crossing_goes_through_the_affiliate_accounts` |
| I4 | A unit never holds a supplier payable (2002/2004) or a lender/loan (2035–2040, 2043–2048, the owner's loan included). It reaches the same result through the affiliate accounts. A unit **may** hold its own bank accounts (1005–1015), the outstanding giro drawn on them (2005–2009), and its tax payables (2011–2015), as the client does. | **`external_party_account` registry + trigger `journal_line_external_party_is_head_office` + `dimension='company'`** (0376, narrowed by 0380; the HO unit by its kind since 0605) | `finance_hard_rules::a_supplier_payable_cannot_sit_at_a_shop`, `a_unit_may_hold_outstanding_giro_for_its_own_bank_account`, `a_unit_giro_paying_a_head_office_supplier_crosses_on_pembiayaan` |
| I5 | A shop's cash is 1002 Cash on Hand, 1003 Petty Cash, 1004 Modal Kasir. | 0348 leaves | `finance_hard_rules` 1–5 |
| I6 | Modal Kasir (1004) pays for nothing. | `account_source_rule` ALLOW = `CASH_SHIFT`, `OPENING` (0376) | `finance_hard_rules::modal_kasir_cannot_pay_an_expense` |
| I7 | Three inter-unit families, no more: PEMBIAYAAN (unit 2028 / HO 1057), BARANG (unit 2029 / HO 1058), LAIN (unit 2030 / HO 1059). **The unit side is always the hutang account and head office always the piutang account**, whichever way value moved; balances may go negative. | `interunit::kind_for_source` picks the family and the meaning; the `affiliate_*` links resolve, per family, to hutang for STORE units and piutang for the HO unit (0460, 0606; the counterparty is on the line as `counter_unit_id`, not in the link); `2030.requires_counter_site` | `finance_hard_rules` 2–5, 12, 13, 15; `finance_api` harness `assert_sound` |
| I8 | HO ↔ unit only; unit ↔ unit always goes through HO (the counter unit of a store's line is always the HO unit, found by its kind). | `balancing_legs` (head office from `head_office_unit_id()`) | `finance_connect_integration`, `finance_hard_rules` 13 |
| I9 | A rule names a meaning, never a code. The map decides the account. | `poster.rs` `LineAccount::Meaning`; `resolve_account` has no default | `finance_connect_integration::every_meaning_a_writer_names_resolves_at_every_site` |
| I10 | **Replaced 27 Sep (owner: "sama dengan ERPNext").** Closing a month only locks it. Moving profit to retained earnings is a Period Closing Voucher, as in ERPNext and as the client's 7Soft does at year end (C001: Laba Ditahan 2024→2025 rose by exactly its 2024 net profit, 2,125,007,102). A voucher closes a period that follows the last closed one, per unit, zeroing the P&L accounts into 3003 Laba (Rugi) Ditahan; run it once a year (7Soft / older ERPNext) or per period (current ERPNext). | to build: `period_closing_voucher` | to write |
| I11 | Bank charge and bank interest are two events. | `bank_admin_fee`→6043 (expense); `interest_income`→8002 (income). Never `Dr 6043 / Cr 8002`. | (documentation; 0376 comment) |
| I12 | 1110 Disposed Inventory is reached only by a Finance HO hand-keyed journal or the opening import. | `account_source_rule` ALLOW = MANUAL, RECLASS, ADJUSTMENT, WRITE_OFF, OPENING; no account link (0380, 0460) | `finance_hard_rules::disposed_inventory_takes_a_manual_journal_and_nothing_automatic` |

### 27 Sep: which of these are now settings

Following the owner's "sedinamis ERPNext tanpa developer" (Desain Fondasi Finance
Dinamis, migrations 0460–0472), the mechanisms above stay in code and the
database; what they apply to is edited by Finance from the screen:

| Rule | Mechanism (code/DB, unchanged) | Contents (now a setting) |
|---|---|---|
| I2 | role gate on `/api/v1/finance/journal` | `role_permission` overrides (0472) |
| I4 | trigger `journal_line_external_party_is_head_office` | head-office accounts screen (`external_party_account`, 0471) |
| I6, I12, P21 | `validate_account_posting` + `account_source_rule` | source-rule screen (0471) |
| I7 | balancer `interunit::balancing_legs` | affiliate account links per family and kind of unit (0460, 0606) |
| I9 | `LineAccount::Meaning` → `account_link` | Account Links screen, by source (0460, 0465–0469) |
| I10 | replaced — Period Closing Voucher (0464) | Finance runs it per period or per year |
| counter-unit accounts | line check (`counter_unit_id`) | `ledger_account.requires_counter_site`, set in the chart editor (0471) |
| — (new) | trigger `journal_line_account_not_frozen` | `ledger_account.is_frozen`, ERPNext freeze_account (0471) |

## 2. OWNER POLICY (decided; change only by a new decision)

| # | Policy | Value |
|---|---|---|
| P1 | Chart | **Replaced 27 Sep:** the chart is edited from the screen and applies at once, as in ERPNext and 7Soft (no approval step); who may edit is a permission, and every change is kept in `ledger_account_change` (0461). |
| P2 | HO → unit cash | always cash into 1003 Petty Cash. |
| P3 | Store remittance | store Dr 2028 / Cr 1002; HO Dr bank / Cr 1057. Two entries, each within one unit's books; the pair sits unmatched until HO confirms. |
| P4 | HO pays a unit's bill | unit Dr expense / Cr 2028; HO Dr 1057 / Cr bank/AP. The unit never has the supplier. |
| P5 | Receiving & supplier invoice | supplier payable 2002/2004 always at HO. Goods straight to a shop: shop Dr inventory / Cr 2029, HO Dr 1058 / Cr 2002. A goods return unit → HO: shop Dr 2029 / Cr inventory, HO Dr inventory / Cr 1058. **No Suspend/GRNI** (2003 is not used). |
| P6 | Costing | provenance per unit (SKU × receipt), not FIFO, not moving average. Short layers post at last known cost, flagged, trued up. |
| P7 | GL granularity | per store, per day, per tender; source keeps every receipt. |
| P8 | POS return | exchange only, no cash out; difference (cheaper replacement) to 8008. |
| P9 | GA mappings | pre-opening 1111→7026/1112 (period = setting, default 12 months); disposal gain/loss → 8008; security deposit → 1054; lease payable → 2031 (generic other payable; LEASING is a sub-ledger detail). |
| P10 | Payroll | component-driven: salary/overtime/meal/transport → 2017 by component; THR/bonus/severance → 2018; medical → 2020; BPJS → 2021; PPh 21 → 2011; other claims → 2031. |
| P11 | PPN | ignored for now; MDR already includes it. |
| P12 | No new affiliate kind | PEMBIAYAAN / BARANG / LAIN only. |
| P13 | All HO ↔ unit through the affiliate accounts (decision A, 25 Sep) | every HO ↔ unit transaction crosses on hutang/piutang afiliasi; unit ↔ unit is forbidden and crosses only via HO (I7, I8). |
| P14 | Giro follows the bank account (decision B, 25 Sep; 0380) | 11 of 13 stores have their own giro bank accounts (1005–1009); 9 carry outstanding giro (2005/2006/2008, ~3.1B). 2005–2009 are unit accounts, out of the registry; 2032 stays retired. A unit giro paying an HO supplier: unit Dr 2028 / Cr 2005; HO Dr 2002 / Cr 1057 (the payable stays at HO). |
| P15 | 2030 is the unit side of Lain-lain (decision C, revised 25 Sep; 0380) | The client pairs 1057/2028, 1058/2029, 1059/2030; there is no "Piutang Afiliasi Principal". 2030: `dimension='unit'`, `requires_counter_site`, out of the registry. Unit side always 2030, HO side always 1059; a unit balance may go negative. Example (repaying the owner's loan from C001's cash, P21): C001 Dr 2030 (counter HO) / Cr 1002; HO Dr 2043 / Cr 1059 (counter C001). `principal_payable` (→2030, no writer) removed. Principal (owner) transactions (`EQUITY_MOVEMENT`) cross on Lain-lain. 2031 Hutang Lain-lain stays the generic other payable (leasing, employee claims); client balances on it are zero everywhere. |
| P16 | Tax stays per unit (decision D) | 2011–2015 remain unit-postable (every store carries a small PPh 25 payable). |
| P17 | P&L layered like the client (0379) | PENJUALAN → Laba kotor → BEBAN USAHA (GOP) → BEBAN USAHA LAINNYA, section `OTHER_OPERATING_EXPENSE` (NOP) → non-operating (NPBT) → PAJAK PENGHASILAN, section `INCOME_TAX` (NPAT). 8004 Potongan Pembelian is non-operating (OTHER_NET), not cost of sales. |
| P18 | Discounts | every promotion benefit (line and basket) is booked net inside revenue; **4012 Discount/Potongan Penjualan receives only voucher redemptions**. There is no manual cashier/bill discount in the POS, by owner policy — it must not be built. Same as the ERPNext default; ERPNext's "Enable discount accounting for selling" (discounts to their own account) becomes a setting, default off, matching the client (27 Sep). |
| P19 | Divisions (0382) | seeded to the client's nine (KODE DIVISI 1–9). |
| P20 | 1110 Disposed Inventory (0380) | reopened manual-only for the client's opening balances (2.73B across 12 stores); no automatic writer yet (I12). |
| P21 | Owner takes money at a unit (25 Sep) | Finance HO posts it as a manual journal **on the store's own books**: Dr 3004 Prive (store) / Cr 1002 Cash (store). If it repays the owner's loan it crosses on Lain-lain, also posted by HO: store Dr 2030 (counter HO) / Cr cash; HO Dr 2043 Pinjaman Jangka Panjang Principal / Cr 1059 (counter the store). The store itself has no access. 3004 is reached only by HO hand-keyed kinds, `EQUITY_MOVEMENT` (the principal document, Admin only) and OPENING (0380). |

## 3. TO_CONFIRM (must not be hard-coded)

| # | Question | Current handling |
|---|---|---|
| T1 | BPJS account | **Closed 27 Sep:** 2021 Biaya Asuransi dan BPJS YMHD, as in the client's chart (2012201005); employer expense 6017 store / 6031 HO. |
| T2 | PPh 4(2) | **Closed 27 Sep:** the client's chart has no PPh 4(2)/final account (7,528 accounts searched), so the company does not pay it; tax follows the client's accounts only (PPh 21, 23, 25, 29, PPN, PBB). If it is ever needed, Finance adds the account from the chart editor. |
| T3 | Member points | **Decided 27 Sep (ERPNext Loyalty Program):** points are only a way to pay. Earning posts nothing; paying with points is a payment method whose settlement account is a loyalty expense account (ERPNext `loyalty_program.expense_account`), at a set Rupiah value per point. The client has no such account yet; Finance adds it. |
| T4 | 1110 Disposed Inventory — for the client: what it contains, its valuation basis (cost vs expected selling price), and how it is cleared (sold to a jobber / destroyed). Balances: C001 380,808,034; C002 263,861,904; C003 76,220,749; C004 180,062,858; C005 182,983,368; C006 203,919,554; C007 312,289,183; C009 325,770,893; C010 321,218,520; C011 273,167,243; C012 106,013,394; C013 108,538,367. | reopened manual-only (P20); no writer until answered. **Valuation decided 27 Sep: at cost (harga pokok).** Balances confirmed by the per-branch balance sheet of Dec 2025. Still to ask: destroyed or sold to a jobber. |
| T5 | Pre-opening useful period | a Finance setting; currently 12 months. |
| T6 | Loan current portion (2035–2040), leasing payable/interest (2031/8012) | mapped, but **no writer**; see the plan. |
| T7 | Full & final / severance payout signage | `exit.rs` to be traced and regression-tested first (see plan). |
| T8 | "NON DIVISI" sales (790.6M, HPP 60k) | ask the client what it is. |
| T9 | The client's inter-unit balances do not eliminate: per-unit HO vs unit sides differ ~5.6B net, plus 17.1B on HO self rows (11.48B of it on "Hutang Lain-lain Principal HEAD OFFICE - HO"). The per-branch balance sheet does not balance at C008 (−1.48B), C013 (162M) and HO (−110M). | must be cleaned by the client accountant before opening balances. `ledger_account_source_code` (0381) now names every affiliate row's counterparty and tags SELF_ROUTE / UNIT_TO_UNIT / OPENING_RECLASS rows. |
| T10 | 4012 in the client's 2025 books (22,022,050) | **Closed 27 Sep:** the client's item discounts (828,836,975) are already net in revenue; the 22M is 7Soft's cashier total-bill discount, which our POS does not have (P18). |
| T11 | Opening reclass of unit rows on HO-only accounts | 0381 tags 182 crosswalk rows (2002, 2004, 2035–2040, 2043–2048 at units) OPENING_RECLASS: opening moves the balance to HO and the unit carries 2028 (counter HO). `opening.rs` does not read the crosswalk, so the preparer of the opening sheet applies it. |
| T12 | Client rows on the wrong side of the convention (I7) | the client has HO rows on hutang accounts and unit rows on piutang accounts, e.g. 13 HO rows on 2030 with a unit counterparty ("Hutang Lain-lain Principal <unit> - HO") and every store's 2030 "HEAD OFFICE" balance (net −19.5B). Under I7 they open on the other side of the same family (HO on 1057/1058/1059, units on 2028/2029/2030); how each nets is for the client accountant. |

---

## 4. The acceptance scenarios (in `backend/tests/finance_hard_rules.rs`)

| # | Scenario | Expected | Test |
|---|---|---|---|
| 1 | Store cash sale | store Dr 1002 / Cr 4002; no inter-unit | `a_store_cash_sale_stays_in_the_shop` |
| 2 | Store remits cash to HO bank | store Dr 2028 / Cr 1002; HO Dr bank / Cr 1057 | `a_store_remittance_is_two_affiliate_halves` |
| 3 | HO tops up store petty cash | HO Dr 1057 / Cr bank; store Dr 1003 / Cr 2028 | `head_office_tops_up_a_shops_petty_cash` |
| 4 | HO pays store electricity | store Dr 6045 / Cr 2028; HO Dr 1057 / Cr bank; no 2002/2004 at store | `head_office_pays_a_shops_electricity` |
| 5 | HO sends merchandise to store | 1058/2029, never 1057/2028 | `goods_sent_to_a_shop_cross_on_atas_barang` |
| 6 | Store pays an expense from Modal Kasir | HARD REJECT | `modal_kasir_cannot_pay_an_expense` |
| 7 | AP 2002/2004 at a store | HARD REJECT | `a_supplier_payable_cannot_sit_at_a_shop` |
| 8 | Payroll salary + THR + medical + BPJS | four separate accounts (2017/2018/2020/2021) | `payroll_components_have_four_separate_homes` |
| 9 | Stock loss / damage routes | 8007 / 6011 | `stock_loss_and_damage_have_a_route` |
| 10 | Period close | no profit posting to 3003 | `closing_a_period_leaves_profit_derived` |
| 11 | Store issues and clears its own giro | store Cr 2005 at issue; Dr 2005 / Cr 1005 at clearing; no inter-unit | `a_unit_may_hold_outstanding_giro_for_its_own_bank_account` |
| 12 | Store giro pays an HO supplier (real bill + payment path) | HO Dr 2002 / Cr 1057; store Dr 2028 / Cr 2005, with counters; no 2002/2004 at store | `a_unit_giro_paying_a_head_office_supplier_crosses_on_pembiayaan` |
| 13 | HO ↔ unit Lain-lain, both directions | 2030 at the unit, 1059 at HO, each naming the other side; 2030 without a counter refused | `lain_lain_is_2030_at_the_unit_and_1059_at_head_office` |
| 14 | 1110 Disposed Inventory | automatic posting refused; Finance HO MANUAL journal posts | `disposed_inventory_takes_a_manual_journal_and_nothing_automatic` |
| 15 | Every kind of crossing, both directions (funding, unit pays HO supplier, goods out and back, unit→unit, management fee, asset back) | no unit line on 1057/1058/1059, no HO line on 2028/2029/2030; every affiliate line HO↔unit with a counter; affiliates net to zero | `a_unit_is_always_on_hutang_and_head_office_on_piutang` |
| 16 | Owner takes cash at a store | HO MANUAL journal on the store: Dr 3004 / Cr 1002 posts; a store document naming Prive is refused | `finance_ho_posts_prive_on_a_stores_books` |

Run them with:

```
cd backend
DATABASE_URL=... cargo test --test finance_hard_rules
DATABASE_URL=... cargo test --test finance_connect_integration
```

## 5. What the code does today (25 Sep 2026)

Changed in `0376`, plus writers:

- `external_party_account` registry, `dimension='company'`, and the
  `journal_line_external_party_is_head_office` trigger (I4).
- Modal Kasir locked to `CASH_SHIFT`/`OPENING` (I6).
- `bpjs_payable` gets its own canonical mapping (T1) and `pay.rs` routes BPJS to
  it instead of silently folding it into 2017.
- Store remittance posts the two same-unit halves (P3, I7); the old
  `Dr cash_in_transit / Cr cash` no-op is gone, and `PostingLine::with_counter_unit`
  (spelled `with_counter_site` until 0605) lets a rule post an affiliate line itself.
- Goods receipt and supplier invoice put the payable at HO (P5); a shop that
  receives directly gets 1058/2029 from the balancer.

Changed in `0380` / `0381`:

- Giro 2005–2009 and 2030 leave the registry; both are unit accounts; 2030
  requires a counter unit (P14, P15). The registry is now 2002, 2004,
  2035–2040, 2043–2048.
- `affiliate_payable` / `affiliate_receivable` resolve, for every family, to the
  hutang account at every store unit (2028/2029/2030) and the piutang account at
  the HO unit (1057/1058/1059) (I7). The balancer and the writers still name meanings, so no
  writer changed; store remittance, card settlement into an HO bank and a unit
  paying an HO supplier now land store Dr 2028 / HO Cr 1057.
- `principal_payable` removed; `EQUITY_MOVEMENT` crosses on Lain-lain
  (`interunit::OTHER_SOURCES`).
- 3004 Prive: ALLOW = MANUAL, RECLASS, ADJUSTMENT, EQUITY_MOVEMENT, OPENING (P21).
- 1110 reopened manual-only (P20, I12).
- Crosswalk: every affiliate row (1057/1058/1059/2028/2029/2030, 1,176 rows) has
  its counterparty decoded from digits 8–10 of the client natural (001 = HO,
  002..014 = C001..C013), verified against the BDP rows and the client's own
  names. 84 SELF_ROUTE rows (counter NULL), 936 UNIT_TO_UNIT rows, 156 HO ↔
  unit rows, and 182 OPENING_RECLASS rows (T9, T11).

Changed in `0605`–`0609` (27 Sep, the books move from site to unit):

- `journal_line.site_id` / `counter_site_id` are `unit_id` / `counter_unit_id`,
  translated through `site.unit_id` (`dc` → `ho`); history is re-keyed, not
  re-posted. The per-unit balance trigger replaces the per-site one (I3); the
  external-party trigger asks `head_office_unit_id()` (I4).
- Account links hold for `ALL`, a `UNIT_KIND` or one `UNIT`, and
  `account_resolution` answers per unit (I7, I9).
- Store money, bank accounts and statements, giro, tax, budgets, the Payment
  Ledger, opening balances, cash documents, tender reconciliations,
  corrections, prepaid schedules, bank rules and payment batches are keyed by
  unit. Documents that happen at a premises (receipts, bills, shifts, sales,
  settlement lines, assets, cash counts, stock) keep their site and are booked
  to its unit.

Still to do: `runs/finance-guards/2026-09-25/PLAN.md`.
