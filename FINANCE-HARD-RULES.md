# Finance — hard rules, owner policy, and what is still open

**Status:** canonical as of 25 Sep 2026. Supersedes the conflicting summaries:
the chart is **267 active client posting accounts** (migration `0348`), not the
retired 43-account model. The old "43 akun final" wording in
`FINANCE-COA-COVERAGE.md` described a model the brief retired; that file now
points here.

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

---

## 1. INVARIANTS (enforced)

| # | Rule | Where it lives | Test |
|---|---|---|---|
| I1 | Domain holds the event, Finance holds the journal. | `poster.rs` is the only writer of `journal_entry`/`journal_line` | — |
| I2 | Only Finance HO writes manual journals. Units record events. | `manual_je_policy`, `HAND_KEYED_KINDS` (`ledger.rs`) | — |
| I3 | Every entry balances, and every site balances in its own books. | `interunit::balancing_legs`, deferred trigger 0120 | `finance_connect_integration::every_crossing_goes_through_the_affiliate_accounts` |
| I4 | Units never hold an external party: supplier, service vendor, bank, tax, BPJS or lender. | **`external_party_account` registry + trigger `journal_line_external_party_is_head_office` + `dimension='company'`** (0376) | `finance_hard_rules::a_supplier_payable_cannot_sit_at_a_shop` |
| I5 | A shop holds only 1002 Cash on Hand, 1003 Petty Cash, 1004 Modal Kasir. | 0348 leaves; `external_party_account` for the rest | `finance_hard_rules` 1–5 |
| I6 | Modal Kasir (1004) pays for nothing. | `account_source_rule` ALLOW = `CASH_SHIFT`, `OPENING` (0376) | `finance_hard_rules::modal_kasir_cannot_pay_an_expense` |
| I7 | Three inter-unit families, no more. | `interunit::kind_for_source`: PEMBIAYAAN (1057/2028), BARANG (1058/2029), LAIN (1059 two-way) | `finance_hard_rules` 2, 5 |
| I8 | Unit ↔ unit always goes through HO (counter-site is always `dc`). | `balancing_legs` | `finance_connect_integration` |
| I9 | A rule names a meaning, never a code. The map decides the account. | `poster.rs` `LineAccount::Meaning`; `resolve_account` has no default | `finance_connect_integration::every_meaning_a_writer_names_resolves_at_every_site` |
| I10 | Current-period profit is derived; closing does not post it to retained earnings. | `close_period`/`period_close` seal only; no writer on 3003 | `finance_hard_rules::closing_a_period_leaves_profit_derived` |
| I11 | Bank charge and bank interest are two events. | `bank_admin_fee`→6043 (expense); `interest_income`→8002 (income). Never `Dr 6043 / Cr 8002`. | (documentation; 0376 comment) |

## 2. OWNER POLICY (decided; change only by a new decision)

| # | Policy | Value |
|---|---|---|
| P1 | Chart | 267 client leaves (`0348`); **no new accounts** without the owner. |
| P2 | HO → unit cash | always cash into 1003 Petty Cash. |
| P3 | Store remittance | store Dr 1057 / Cr 1002; HO Dr bank / Cr 2028. Two same-site entries; the pair sits unmatched until HO confirms. |
| P4 | HO pays a unit's bill | unit Dr expense / Cr 2028; HO Dr 1057 / Cr bank/AP. The unit never has the supplier. |
| P5 | Receiving & supplier invoice | supplier payable 2002/2004 always at HO. Goods straight to a shop: shop Dr inventory / Cr 2029, HO Dr 1058 / Cr 2002. **No Suspend/GRNI** (2003 is not used). |
| P6 | Costing | provenance per unit (SKU × receipt), not FIFO, not moving average. Short layers post at last known cost, flagged, trued up. |
| P7 | GL granularity | per store, per day, per tender; source keeps every receipt. |
| P8 | POS return | exchange only, no cash out; difference (cheaper replacement) to 8008. Discounts to 4012. |
| P9 | GA mappings | pre-opening 1111→7026/1112 (period = setting, default 12 months); disposal gain/loss → 8008; security deposit → 1054; lease payable → 2031 (generic other payable; LEASING is a sub-ledger detail). |
| P10 | Payroll | component-driven: salary/overtime/meal/transport → 2017 by component; THR/bonus/severance → 2018; medical → 2020; BPJS → 2021; PPh 21 → 2011; other claims → 2031. |
| P11 | PPN | ignored for now; MDR already includes it. |
| P12 | No new affiliate kind | PEMBIAYAAN / BARANG / LAIN only. |

## 3. TO_CONFIRM (must not be hard-coded)

| # | Question | Current handling |
|---|---|---|
| T1 | BPJS account (2021 vs folded into 2017) | P10 routes BPJS to its own meaning `bpjs_payable`, canonical mapping → 2021, marked TO_CONFIRM at the map (`0376`). One `account_map` row moves when decided; no payroll code change. |
| T2 | PPh 4(2) (sewa, konstruksi) | no dedicated account; enters 2012 with a `withholding_key` pasal marker — review with a tax consultant. |
| T3 | Member points | no account; nothing is posted. |
| T4 | `1110 Disposed Inventory`, `2032 Giro Keluar` vs `6002` | suspected duplicate/unused — owner to review. |
| T5 | Pre-opening useful period | a Finance setting; currently 12 months. |
| T6 | Loan current portion (2035–2040), leasing payable/interest (2031/8012) | mapped, but **no writer**; see the plan. |
| T7 | Full & final / severance payout signage | `exit.rs` to be traced and regression-tested first (see plan). |

---

## 4. The acceptance scenarios (in `backend/tests/finance_hard_rules.rs`)

| # | Scenario | Expected | Test |
|---|---|---|---|
| 1 | Store cash sale | store Dr 1002 / Cr 4002; no inter-unit | `a_store_cash_sale_stays_in_the_shop` |
| 2 | Store remits cash to HO bank | store Dr 1057 / Cr 1002; HO Dr bank / Cr 2028 | `a_store_remittance_is_two_affiliate_halves` |
| 3 | HO tops up store petty cash | HO Dr 1057 / Cr bank; store Dr 1003 / Cr 2028 | `head_office_tops_up_a_shops_petty_cash` |
| 4 | HO pays store electricity | store Dr 6045 / Cr 2028; HO Dr 1057 / Cr bank; no 2002/2004 at store | `head_office_pays_a_shops_electricity` |
| 5 | HO sends merchandise to store | 1058/2029, never 1057/2028 | `goods_sent_to_a_shop_cross_on_atas_barang` |
| 6 | Store pays an expense from Modal Kasir | HARD REJECT | `modal_kasir_cannot_pay_an_expense` |
| 7 | AP 2002/2004 at a store | HARD REJECT | `a_supplier_payable_cannot_sit_at_a_shop` |
| 8 | Payroll salary + THR + medical + BPJS | four separate accounts (2017/2018/2020/2021) | `payroll_components_have_four_separate_homes` |
| 9 | Stock loss / damage routes | 8007 / 6011 | `stock_loss_and_damage_have_a_route` |
| 10 | Period close | no profit posting to 3003 | `closing_a_period_leaves_profit_derived` |

Run them with:

```
cd backend
DATABASE_URL=... cargo test --test finance_hard_rules
DATABASE_URL=... cargo test --test finance_connect_integration
```

## 5. What the code does today (25 Sep 2026)

Changed in this pass (migration `0376`, plus writers):

- `external_party_account` registry, `dimension='company'`, and the
  `journal_line_external_party_is_head_office` trigger (I4).
- Modal Kasir locked to `CASH_SHIFT`/`OPENING` (I6).
- `bpjs_payable` gets its own canonical mapping (T1) and `pay.rs` routes BPJS to
  it instead of silently folding it into 2017.
- Store remittance posts the two same-site halves (P3, I7); the old
  `Dr cash_in_transit / Cr cash` no-op is gone, and `PostingLine::with_counter_site`
  lets a rule post an affiliate line itself.
- Goods receipt and supplier invoice put the payable at HO (P5); a shop that
  receives directly gets 1058/2029 from the balancer.

Still to do: `runs/finance-guards/2026-09-25/PLAN.md`.
