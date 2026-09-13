-- 0238: A day's takings are posted once, and the chart has somewhere to put
--       every tender the counter accepts.
--
-- # What was wrong
--
-- `journal_entry.source_kind` has allowed `SALE_DAY` since 0051 and reserved it
-- again in 0083. Nothing has ever written one. Over 1-13 September 2026 Store
-- 03 took Rp 12,416,979 across its counter — Rp 4,412,348 cash, Rp 5,583,109
-- card, Rp 2,421,522 QRIS — and over that same window the movement on its cash
-- account, on both card receivables and on `card_fee` is zero. The Profit &
-- Loss screen shows Income Rp 0 while the tills ring up real money, because
-- nothing carries a sale into the book.
--
-- The posting rule is Rust (`postgres::sale_day`). What is here is the two
-- things it cannot do for itself: the places in the client's chart it needs to
-- post into, and the row that makes posting a day twice a no-op.
--
-- ---------------------------------------------------------------------------
-- Part one: the three holes in the chart
-- ---------------------------------------------------------------------------
--
-- A card sale already has a home — two receivables (`1011101001` Piutang kartu
-- Kredit, `1011101002` Piutang Debit Card) and a fee account. The counter takes
-- three other tenders and the chart answers for none of them:
--
--   * **QRIS** settles exactly as a card does — the money arrives at the bank a
--     day or two later, net of a fee — and has no account at all. It cannot be
--     traced from the till to the bank statement.
--   * **OTHER** is what a counter transfer lands in, because there is no
--     TRANSFER tender. Money that has arrived somewhere we cannot yet name.
--   * **Revenue itself.** The client's chart splits sales by TENDER
--     (`4010110` Tunai, `4010111` Kartu Debit per bank, `4010112` Kartu Kredit
--     per scheme, `4010113` Online), so there is no leaf meaning "sold over the
--     counter" that does not also claim how it was paid for. Crediting a card
--     sale to Penjualan Tunai is the one thing docs/finance-menu.md §6 decision
--     2 says must not happen: the chart splits revenue per tender precisely so
--     each half reconciles to the asset the tender landed in.
--
-- So this migration adds three families, each built the way the client builds
-- every other one: a group on the `{1,3,5,7,10,12}` ladder, and a leaf per unit
-- whose code ends in that unit's own two digits. Both the suffix and the unit's
-- label are READ OFF the existing `Penjualan Tunai` family rather than written
-- out here, so a chart that gains or loses a unit gains or loses these with it,
-- and nothing in this file has to know that HO is `00` and Wonosobo is `13`.
--
-- The tender split on the asset side is what makes the revenue account able to
-- be tender-neutral: `401011400103` says Store 03 sold Rp 3.5m over the
-- counter, and the four debits beside it say how much of that is in the drawer,
-- how much the acquirer owes and how much the QRIS provider owes. When the
-- owner settles decision 2 and wants revenue split per tender as well, that is
-- a row on the Account Map — `revenue` is a QUALIFIED meaning and the rule
-- prefers a tender-qualified binding over the plain one — and not a change
-- here or in Rust.

-- Every insert below is conditional on the rung it hangs from already being
-- there, and that is not defensive habit. The chart is IMPORTED
-- (`scripts/import-coa.py`) rather than migrated, so a database built from
-- scratch — every `#[sqlx::test]` database, for one — has the sites but no
-- accounts at all. Unconditional inserts would make this migration fail on
-- every one of them, and the failure would name a foreign key rather than the
-- reason.

-- ── QRIS in transit ──────────────────────────────────────────────────────
INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
SELECT '1011101003', 'Piutang QRIS', '1011101', true, NULL
 WHERE EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '1011101');

INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
SELECT '1011101003' || u.suffix, 'Piutang QRIS ' || u.label, '1011101003', false, u.site_id
  FROM (SELECT a.site_id, substr(a.account_code, 11, 2) AS suffix,
               btrim(replace(a.name, 'Penjualan Tunai', '')) AS label
          FROM ledger_account a
         WHERE a.account_code LIKE '4010110001__' AND a.is_group = false
           AND a.site_id IS NOT NULL) u;

-- ── every other tender, until it has a name of its own ───────────────────
INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
SELECT '1011101004', 'Piutang Tender Lain-Lain', '1011101', true, NULL
 WHERE EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '1011101');

INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
SELECT '1011101004' || u.suffix, 'Piutang Tender Lain-Lain ' || u.label, '1011101004', false, u.site_id
  FROM (SELECT a.site_id, substr(a.account_code, 11, 2) AS suffix,
               btrim(replace(a.name, 'Penjualan Tunai', '')) AS label
          FROM ledger_account a
         WHERE a.account_code LIKE '4010110001__' AND a.is_group = false
           AND a.site_id IS NOT NULL) u;

-- ── what the counter sold, before it says how it was paid for ────────────
--
-- `4010114` is the next free number under `40101 PENJUALAN`, after Tunai,
-- Kartu Debit, Kartu Kredit and Online.
INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
SELECT * FROM (VALUES ('4010114', 'Penjualan Barang Dagangan', '40101', true, NULL::text),
                      ('4010114001', 'Penjualan Barang Dagangan', '4010114', true, NULL)) v
 WHERE EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '40101');

INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
SELECT '4010114001' || u.suffix, 'Penjualan Barang Dagangan ' || u.label, '4010114001', false, u.site_id
  FROM (SELECT a.site_id, substr(a.account_code, 11, 2) AS suffix,
               btrim(replace(a.name, 'Penjualan Tunai', '')) AS label
          FROM ledger_account a
         WHERE a.account_code LIKE '4010110001__' AND a.is_group = false
           AND a.site_id IS NOT NULL) u;

-- ---------------------------------------------------------------------------
-- Part two: the bindings, including the one that was quietly missing
-- ---------------------------------------------------------------------------
--
-- `cash_variance` is a live defect and not a new feature. `cash_counts.rs:33`
-- has named that meaning since 0216, it was never declared in
-- `required_semantic_keys()`, so the Account Map has never listed it, nobody
-- has ever been asked to set it, Period close reports the map complete — and
-- the first person to book a short drawer meets a refusal naming a key they
-- have never seen. The Rust half of that fix is one line in
-- `required_semantic_keys()`; this is the other half.
--
-- `8010110007 Pendapatan (Biaya) Lain-Lain` is where the COA review of 7
-- September put it: a drawer that is short is neither an expense of trading nor
-- a loss of stock, it is other income and expense, and the client's own account
-- is signed so a long drawer credits it and a short drawer debits it.
--
-- `set_by` is the migration rather than a person because nobody chose these on
-- a screen; the Account Map shows that, and a real decision overwrites it.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT 'cash_variance', a.site_id, '', a.account_code, 'migration:0238',
       'seeded from the COA review of 7 September 2026'
  FROM ledger_account a
 WHERE a.account_code LIKE '8010110007__' AND a.is_group = false AND a.site_id IS NOT NULL
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT 'qris_clearing', a.site_id, '', a.account_code, 'migration:0238',
       'QRIS taken at the counter, not yet settled into the bank'
  FROM ledger_account a
 WHERE a.account_code LIKE '1011101003__' AND a.is_group = false AND a.site_id IS NOT NULL
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT 'other_tender_clearing', a.site_id, '', a.account_code, 'migration:0238',
       'a tender the till could only call OTHER — a counter transfer, today'
  FROM ledger_account a
 WHERE a.account_code LIKE '1011101004__' AND a.is_group = false AND a.site_id IS NOT NULL
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT 'revenue', a.site_id, '', a.account_code, 'migration:0238',
       'counter sales; the tender split lives on the debits beside it'
  FROM ledger_account a
 WHERE a.account_code LIKE '4010114001__' AND a.is_group = false AND a.site_id IS NOT NULL
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

-- A voucher presented at the counter is not money arriving. The money arrived
-- when the card was sold, and this is the liability being settled — which is
-- why the debit is `205001 Uang Muka - Penjualan`, the account the client keeps
-- for customer deposits and vouchers, and not a receivable.
--
-- One account for every unit, deliberately: a voucher is sold in one shop and
-- spent in another, so the liability is the company's and not the shop's. The
-- LINE still carries the shop that redeemed it, because every line does.
INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
SELECT 'voucher_liability', s.id, '', '205001', 'migration:0238',
       'company-wide: a voucher is sold in one shop and spent in another'
  FROM site s
 WHERE EXISTS (SELECT 1 FROM ledger_account
                WHERE account_code = '205001' AND is_group = false)
ON CONFLICT (semantic_key, site_id, qualifier) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Part three: one entry per unit per trading day, and the database says so
-- ---------------------------------------------------------------------------
--
-- The property this table exists for is that posting a day twice books it once.
-- It is not enforced by a check in Rust that somebody could forget to write, or
-- write and then move: it is the PRIMARY KEY. The rule posts the journal entry
-- and inserts this row in ONE transaction, so two people pressing the button at
-- the same moment both post, both reach this insert, one commits and the other
-- finds the key taken — and rolls back the entry it had written along with it.
-- Neither outcome leaves half a day in the book.
--
-- `trading_day` is the shop's day and not the node's. The node keeps UTC, the
-- shops keep WIB, and for seven hours of every day those two disagree about
-- which day it is; an evening's takings dated by the UTC calendar land on
-- tomorrow. The rule reads sales with the same offset every sales report uses
-- (`reporting::DEFAULT_UTC_OFFSET_MINUTES`) and records here which offset it
-- used, so a day posted under one boundary can be told from a day posted under
-- another rather than silently re-added.
CREATE TABLE sale_day_posting (
    site_id          text NOT NULL REFERENCES site(id),
    trading_day      date NOT NULL,
    entry_id         uuid NOT NULL REFERENCES journal_entry(entry_id),
    -- Minutes east of UTC that defined this day's boundary. 420 is WIB.
    utc_offset_minutes integer NOT NULL,
    -- What the rule found when it posted, kept so the entry can be read against
    -- the day without re-deriving it from sales that may since have been
    -- returned against. Not a cache of a balance — `journal_line` is still the
    -- only place the money lives — but a record of the facts the rule saw.
    sales_count      bigint NOT NULL CHECK (sales_count > 0),
    gross_minor      bigint NOT NULL CHECK (gross_minor > 0),
    -- Cash as it was HANDED OVER, and the change handed back. Two columns and
    -- not one net figure, because the drawer holds the difference and the
    -- receipt says the first: a cash count agrees with `cash_tendered_minor -
    -- change_minor`, and a till report agrees with `cash_tendered_minor`.
    -- Netting them here would leave neither reconcilable.
    cash_tendered_minor bigint NOT NULL CHECK (cash_tendered_minor >= 0),
    change_minor     bigint NOT NULL CHECK (change_minor >= 0),
    card_debit_minor bigint NOT NULL CHECK (card_debit_minor >= 0),
    card_credit_minor bigint NOT NULL CHECK (card_credit_minor >= 0),
    -- Card takings whose tender never said debit or credit. Its own column
    -- rather than folded into one of the two, because it is booked to the
    -- debit receivable by a house rule and not by evidence, and a figure
    -- arrived at by a rule should be visible as one. Every card row in the
    -- seeded books is this today: `sale_payment.card_kind` is null on all of
    -- them.
    card_unattributed_minor bigint NOT NULL CHECK (card_unattributed_minor >= 0),
    qris_minor       bigint NOT NULL CHECK (qris_minor >= 0),
    voucher_minor    bigint NOT NULL CHECK (voucher_minor >= 0),
    other_minor      bigint NOT NULL CHECK (other_minor >= 0),
    -- What the acquirer and the QRIS provider keep. Nothing in this estate
    -- knows an MDR rate — it is a contract, not a fact the till observes — so
    -- it is told to the rule by whoever holds the settlement slip, and is zero
    -- when nobody said. Per card kind because the two are priced differently:
    -- debit is usually a flat fee per transaction and credit a percentage.
    card_debit_fee_minor  bigint NOT NULL CHECK (card_debit_fee_minor >= 0),
    card_credit_fee_minor bigint NOT NULL CHECK (card_credit_fee_minor >= 0),
    qris_fee_minor   bigint NOT NULL CHECK (qris_fee_minor >= 0),
    posted_by        text NOT NULL,
    posted_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, trading_day)
);

COMMENT ON TABLE sale_day_posting IS
    'One row per unit per trading day: the day''s takings, and the journal entry that carries them. The primary key is what makes posting a day twice a no-op.';

-- The second guard, on the journal's own side. `source_id` is `site:day` for
-- these entries, so this refuses a second SALE_DAY entry for one day even if it
-- were written by something that never touched the table above — a repair
-- script, a hand-rolled insert, a future second rule. Partial, so it costs
-- nothing on the other eleven source kinds.
CREATE UNIQUE INDEX ux_journal_entry_sale_day
    ON journal_entry (source_id) WHERE source_kind = 'SALE_DAY';
