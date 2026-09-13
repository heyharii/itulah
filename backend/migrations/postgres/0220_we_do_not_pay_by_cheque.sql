-- 0220: We do not pay by cheque.
--
-- # What this changes
--
-- `supplier_payment.method` has carried five values since 0084. One of them,
-- CHEQUE, has never been true here. The client's own chart of accounts has no
-- cheque account at all: no cek, no bilyet, no warkat, no kliring, nothing. What
-- it has is giro, twice over — `1011002 CASH IN BANK GIRO`, which is the current
-- account, and `2012002 OUTSTANDING GIRO`, which is the paper written and not
-- yet cleared, carried per bank and per unit.
--
-- # Why a value nobody picks is not harmless
--
-- Because it is about to stop being cosmetic. GIRO is getting a lifecycle and a
-- posting rule of its own — issued as a liability, cleared against the bank only
-- when the statement says so — and a register named after that instrument which
-- quietly contains cheques would be worse than either name alone.
--
-- And the two are not synonyms. A cek is payable on presentation whatever date
-- is written on its face, so crediting the bank the day it is handed over is
-- true. A bilyet giro is an order to move money into a named account and cannot
-- be presented before its tanggal efektif, so the same posting is a lie for
-- thirty to ninety days. A column that lets one word stand for both invites the
-- wrong one.
--
-- # What happens to rows that say CHEQUE
--
-- They become OTHER, and no ledger line moves: the pot the money left is
-- `account_key`, not `method`, and nothing branches on the method today. OTHER
-- is the honest landing place — it says "paper we no longer name" without
-- inventing a giro number for an instrument that never had one. There should be
-- no such rows; the UPDATE is here for the dev databases where a seed may have
-- taken the value simply because the list offered it.
--
-- # Why the constraint is found by what it says
--
-- 0084 left its CHECKs unnamed, so Postgres named them by position —
-- `supplier_payment_check`, `_check1`, `_check2` — and which one is which
-- depends on the order they happened to be written in. Dropping by that name
-- works here and drops the wrong constraint on a database where somebody added a
-- fourth. So: find it by its definition, fail loudly if it is not exactly one,
-- and give the replacement a name so the next migration need not do this again.

UPDATE supplier_payment SET method = 'OTHER' WHERE method = 'CHEQUE';

DO $$
DECLARE
    con_name text;
    found    int;
BEGIN
    SELECT count(*), min(conname)
      INTO found, con_name
      FROM pg_constraint
     WHERE conrelid = 'supplier_payment'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%''CHEQUE''%';

    IF found <> 1 THEN
        RAISE EXCEPTION
            'expected exactly one CHECK on supplier_payment naming CHEQUE, found %; 0084''s method constraint is not where this migration expected it',
            found;
    END IF;

    EXECUTE format('ALTER TABLE supplier_payment DROP CONSTRAINT %I', con_name);
END $$;

ALTER TABLE supplier_payment
    ADD CONSTRAINT supplier_payment_method_known
        CHECK (method IN ('TRANSFER', 'CASH', 'GIRO', 'OTHER'));
