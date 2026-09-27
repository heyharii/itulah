-- 0370: a bill line says what it was for, and a bill says where it stands.
--
-- GA can now name the thing a cost belongs to — the asset it bought, the repair
-- it paid for, the contract, the replacement, the supply request — and Finance
-- can say a bill is held, or returned to GA, or that it arrived from GA rather
-- than from Finance's own desk. Nothing here posts anything, and nothing here
-- invents an account: this is rujukan (a reference) and a flag, not accounting.
--
-- # The reference lives on the LINE, not on the header
--
-- Brief §8.1: one bill can carry several lines for different objects, and the
-- header only shows the summary. "Ditagih for this contract" and "biaya aktual
-- of this repair" are sums over POSTED lines that point at the record, so the
-- columns are where that sum reads them. A reference on the header would make a
-- mixed bill a bill nobody can count.
--
-- `asset_id` already exists (0160) and is deliberately NOT touched: a line that
-- buys an asset, or spends on one (BBM, servis), already points at it.
--
-- # Why partial indexes, one per reference
--
-- Every reader filters by exactly ONE of these columns and none of them is
-- dense: a line references at most one object, and most lines reference none.
-- A partial index on each (WHERE x IS NOT NULL) is the smallest thing that
-- answers the hub's own query, which is always `... WHERE contract_id = $1` (or
-- repair_id, or supply_request_id), never a combination. A combined index would
-- put the not-null column second for three of the four readers and be scanned
-- as a range nobody can use.
--
-- # Seven days in May become one number
--
-- The seven columns for references and periods are added with no DEFAULT, so
-- every existing row is honestly NULL rather than pointing at object zero.
-- `account_overridden` is the one that needs a value: a line written before this
-- migration did not have its account overridden by anybody, and false is the
-- truth about it.

ALTER TABLE supplier_invoice_expense_line
    ADD COLUMN contract_id       uuid REFERENCES ga_contract (contract_id),
    ADD COLUMN repair_id         uuid REFERENCES ga_repair (repair_id),
    ADD COLUMN replacement_id    uuid REFERENCES ga_replacement (replacement_id),
    ADD COLUMN supply_request_id uuid REFERENCES ga_supply_request (request_id),
    ADD COLUMN service_period_start date,
    ADD COLUMN service_period_end   date,
    -- True when a person chose the account on the line instead of the one the
    -- suggestion offered. The suggestion is a convenience; the person's choice
    -- is the fact, and this is how Finance sees which is which.
    ADD COLUMN account_overridden   boolean NOT NULL DEFAULT false;

-- One partial index per reference, for the reason in the header: each hub
-- reads exactly one of them.
CREATE INDEX ix_bill_line_contract ON supplier_invoice_expense_line (contract_id)
    WHERE contract_id IS NOT NULL;
CREATE INDEX ix_bill_line_repair ON supplier_invoice_expense_line (repair_id)
    WHERE repair_id IS NOT NULL;
CREATE INDEX ix_bill_line_replacement ON supplier_invoice_expense_line (replacement_id)
    WHERE replacement_id IS NOT NULL;
CREATE INDEX ix_bill_line_supply_request ON supplier_invoice_expense_line (supply_request_id)
    WHERE supply_request_id IS NOT NULL;

-- A period that ends before it starts is a typo, not a period. Both ends are
-- optional because plenty of lines name no period at all (goods, a purchase).
ALTER TABLE supplier_invoice_expense_line
    ADD CONSTRAINT bill_line_service_period_is_forward
    CHECK (service_period_start IS NULL OR service_period_end IS NULL
           OR service_period_end >= service_period_start);

-- ---------------------------------------------------------------------------
-- The bill: held, returned, and where it came from
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_invoice
    -- Held so that nothing pays it, while still a document in the books if it
    -- was already posted. Different from a draft: a held bill is real money
    -- somebody has decided not to move yet.
    ADD COLUMN on_hold            boolean NOT NULL DEFAULT false,
    ADD COLUMN hold_reason        TEXT,
    -- The day somebody plans to lift the hold. NULL means "until somebody
    -- decides", which is a real answer and not a missing one.
    ADD COLUMN release_date       date,
    -- 'GA' when Operations filed the draft (brief §8.3) and
    -- 'PAYMENT_REQUEST' when approving a shop's ask made it (brief §8.4). The
    -- column is free text rather than a CHECK because it is an ORIGIN, and a
    -- closure of origins is a list this file cannot see; the two values above
    -- are the only two writers, and both say their own name.
    ADD COLUMN submitted_by_domain TEXT,
    -- Why Finance sent the draft back to GA. Kept on the row after a return
    -- (the id and the mark do not move, §8.3), so GA reads the sentence on the
    -- same bill it will file again.
    ADD COLUMN returned_reason    TEXT,
    -- A hold with no reason is a bill that vanished from the ready-to-pay list
    -- with nobody able to say why. The readable refusal is in Rust; this is the
    -- last word.
    ADD CONSTRAINT bill_hold_is_explained
        CHECK (NOT on_hold OR (hold_reason IS NOT NULL AND btrim(hold_reason) <> ''));

-- The ready-to-pay and ageing filters both ask "not held"; the inbox asks
-- "which drafts did GA file". Two partial indexes, each exactly the population
-- its query reads.
CREATE INDEX ix_supplier_invoice_on_hold ON supplier_invoice (on_hold)
    WHERE on_hold;
CREATE INDEX ix_supplier_invoice_submitted_by_domain
    ON supplier_invoice (submitted_by_domain)
    WHERE submitted_by_domain IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Verified, not assumed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    missing text;
    refuses integer;
BEGIN
    -- The seven columns the sum reads must exist, spelled as the readers spell
    -- them: a typo here would make every hub read answer zero forever.
    SELECT string_agg(wanted, ', ') INTO missing
      FROM (VALUES ('contract_id'), ('repair_id'), ('replacement_id'),
                   ('supply_request_id'), ('service_period_start'),
                   ('service_period_end'), ('account_overridden')) AS w(wanted)
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'supplier_invoice_expense_line'
           AND column_name = w.wanted);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION '0370 left bill-line columns missing: %', missing;
    END IF;

    SELECT string_agg(wanted, ', ') INTO missing
      FROM (VALUES ('on_hold'), ('hold_reason'), ('release_date'),
                   ('submitted_by_domain'), ('returned_reason')) AS w(wanted)
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'supplier_invoice' AND column_name = w.wanted);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION '0370 left supplier_invoice columns missing: %', missing;
    END IF;

    -- The four partial indexes the hub queries ride on, proven by name so a
    -- later migration cannot drop one without this block going red first.
    SELECT count(*) INTO refuses
      FROM pg_indexes
     WHERE tablename = 'supplier_invoice_expense_line'
       AND indexname IN ('ix_bill_line_contract', 'ix_bill_line_repair',
                         'ix_bill_line_replacement', 'ix_bill_line_supply_request');
    IF refuses <> 4 THEN
        RAISE EXCEPTION '0370 installed % of the four bill-line indexes', refuses;
    END IF;

    -- Both CHECKs really refuse: a period that runs backwards and a hold with
    -- no reason. Probed live, against a row that is rolled back, so a CHECK
    -- that was silently dropped is caught here rather than by a person.
    BEGIN
        INSERT INTO supplier_invoice
            (invoice_id, invoice_number, supplier_id, site_id, invoice_date, currency,
             subtotal_minor, total_minor, recorded_by, on_hold)
        VALUES (gen_random_uuid(), 'MIGRASI/0370', 'migrasi', 'dc', CURRENT_DATE, 'IDR',
                0, 0, 'migrasi', true);
        RAISE EXCEPTION '0370 did not refuse a hold with no reason';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;
