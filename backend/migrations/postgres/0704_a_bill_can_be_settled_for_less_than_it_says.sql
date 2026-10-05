-- 0704: A bill can be settled for less than it says.
--
-- # The potongan
--
-- A supplier bill of Rp 10,000,000 is paid with Rp 9,800,000 because the
-- supplier gave two per cent for paying early, or because the transfer lost
-- Rp 150 to rounding. The bill is settled — the supplier says so — and the
-- Rp 200,000 is a purchase discount. 7Soft's BKK carries a POTONGAN column on
-- every invoice line for exactly this, booked to the account its Setting COA
-- calls "Potongan Hutang"; ERPNext's Payment Entry carries it as a deduction.
--
-- Until this file the only thing an allocation could say was how much of the
-- bill it settled, and the payment had to leave the bank with exactly that
-- much. So the bill above was left owing Rp 200,000 forever, on every ageing
-- report, until somebody wrote a journal by hand.
--
-- # The shape
--
-- `supplier_payment_allocation.discount_minor` is the part of an allocation
-- that was NOT paid in money. `amount_minor` keeps meaning what it always has
-- — how much of the bill this allocation settles — so every reader that
-- subtracts allocations from a bill's total to find what is still owed (0121,
-- 0132, 0133, 0143, 0202, 0311, 0391, the ageing) stays right without being
-- touched. What changes is only what leaves the bank:
--
--     Dr payable               amount           (unchanged, per bill)
--     Cr bank                  total - withheld - discount + charge
--     Cr settlement_discount   discount         (new)
--
-- `settlement_discount` is its own meaning, pointed at the same account as
-- `purchase_discount` to begin with — the client keeps one Potongan Pembelian
-- per unit — and Finance can move it on the Account Links screen.

ALTER TABLE supplier_payment_allocation
    ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT supplier_payment_allocation_discount_within
        CHECK (discount_minor >= 0 AND discount_minor <= amount_minor);

COMMENT ON COLUMN supplier_payment_allocation.discount_minor IS
    'The part of amount_minor settled without money: a discount for paying, a rounding '
    'difference. Booked to settlement_discount; the bill is settled by the whole amount (0704).';

-- The meaning, allowed the account types its sibling is.
INSERT INTO posting_role (role, allowed_account_types, note)
SELECT 'settlement_discount', allowed_account_types,
       'a discount taken when a supplier bill is settled for less than it says (0704)'
  FROM posting_role
 WHERE role = 'purchase_discount'
ON CONFLICT (role) DO NOTHING;

-- Pointed where `purchase_discount` points, for every scope it is linked in.
INSERT INTO account_link
    (role, source_type, source_id, scope_type, scope_unit_kind, scope_unit_id, account_code,
     set_by, note)
SELECT 'settlement_discount', l.source_type, l.source_id, l.scope_type, l.scope_unit_kind,
       l.scope_unit_id, l.account_code, 'migration:0704', 'from purchase_discount'
  FROM account_link l
 WHERE l.role = 'purchase_discount';

-- A payment may post to it. Only where the account is already narrowed to a
-- list of source kinds: an account with no rules takes every kind already,
-- and a DENY somebody wrote stays theirs.
-- (Written out rather than ON CONFLICT: the table's key is a unique index over
-- a coalesced category, which ON CONFLICT cannot infer — see 0376.)
INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note)
SELECT DISTINCT r.account_code, 'PAYMENT', 'ALLOW', 'migration:0704',
       'a supplier payment books its settlement discount here'
  FROM account_source_rule r
  JOIN account_link l ON l.account_code = r.account_code AND l.role = 'settlement_discount'
 WHERE r.effect = 'ALLOW'
   AND r.category_code IS NULL
   AND NOT EXISTS (SELECT 1 FROM account_source_rule e
                    WHERE e.account_code = r.account_code
                      AND e.source_kind = 'PAYMENT'
                      AND e.category_code IS NULL);
