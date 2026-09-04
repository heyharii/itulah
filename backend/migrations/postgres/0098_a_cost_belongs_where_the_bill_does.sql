-- 0098: An expense line sits at the bill's own location, until an inter-unit
-- rule exists.
--
-- # What 0094 allowed, and why it was wrong
--
-- 0094 gave an expense line its own `site_id` so one electricity invoice
-- arriving at head office could be split across the four shops it actually
-- covers. The entry balanced in total, and 0094 said so plainly. What it
-- underweighted is that in THIS client's chart every 6* and 7* leaf is already
-- a per-location account, and the trial balance is read per location. A bill at
-- the DC carrying a line at store 01 therefore posts a debit into store 01's
-- books with no credit anywhere in them: store 01's trial balance is out by the
-- cost, the DC's is out by the same amount the other way, and the consolidated
-- one balances perfectly. That is the failure mode this repository keeps naming
-- — wrong in a way the trial balance cannot see.
--
-- # Why refusing, and not inventing the missing credit
--
-- The honest credit is an inter-unit balance: store 01 owes head office for the
-- electricity head office paid for. The client keeps exactly those accounts,
-- and they are already mapped for all fourteen locations —
-- `affiliate_receivable` (`1021401* Piutang Affiliasi Pembiayaan`) and
-- `affiliate_payable` (`2012301* Hutang Affiliasi Pembiayaan`). No rule in this
-- system writes either of them yet, and which side carries the balance, how it
-- is settled and how it nets at a consolidation are Finance's decisions, not
-- ours to guess. `assert_allocation_fits` in 0084 refuses a cross-site PAYMENT
-- on precisely this argument; this is the same refusal for the same reason.
--
-- Splitting is not lost, only deferred: four bills, one per location, records
-- the same four costs in the same four places and balances in each. When the
-- inter-unit rule is written, this constraint comes off and nothing else moves.
--
-- # Why the column stays
--
-- Because the day the rule exists, a line's location becomes meaningful again
-- and the migration that enables it should be a dropped constraint rather than
-- a schema change with a back-fill. `site_id` keeps carrying the answer; for
-- now the answer is forced to be the bill's.

-- Referenced by the lines, the same device 0094 used for `kind` and 0071 for a
-- statement's account: the location travels with the reference, so a line can
-- only name the location its own bill names. Declarative, and it also stops a
-- draft bill's location moving out from under lines that already exist.
ALTER TABLE supplier_invoice
    ADD CONSTRAINT supplier_invoice_id_kind_site_unique UNIQUE (invoice_id, kind, site_id);

ALTER TABLE supplier_invoice_expense_line
    DROP CONSTRAINT supplier_invoice_expense_line_invoice_id_kind_fkey;
ALTER TABLE supplier_invoice_expense_line
    ADD CONSTRAINT supplier_invoice_expense_line_invoice_id_kind_site_fkey
        FOREIGN KEY (invoice_id, kind, site_id)
        REFERENCES supplier_invoice (invoice_id, kind, site_id) ON DELETE CASCADE;

COMMENT ON COLUMN supplier_invoice_expense_line.site_id IS
    'Where the cost belongs. Forced equal to the bill''s location by a composite foreign key, because a cross-location cost needs an inter-unit credit and no rule writes affiliate_receivable / affiliate_payable yet. Drop that key to relax it.';
