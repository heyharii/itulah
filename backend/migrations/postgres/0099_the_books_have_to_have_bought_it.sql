-- 0099: Which bill line bought this asset.
--
-- # The hole
--
-- `10215* AKTIVA TETAP` has never had a single journal line posted to it. Not
-- one, in the whole seeded history. `10216*` carries forty-four depreciation
-- credits, so the books are steadily accumulating depreciation against a cost
-- that is not in them. The register says the company owns twenty-one things
-- worth some hundreds of millions; the balance sheet says it owns nothing.
--
-- Disposal, added in 0096, is what makes this visible rather than merely
-- untidy: it credits `fixed_asset` at cost, and against an account that was
-- never debited that drives the client's fixed-asset balance negative.
--
-- # Why there is no acquisition posting rule here
--
-- Because there is nothing for it to post. An asset is bought from a supplier,
-- and a supplier's bill is already a document that posts: 0094's expense bill
-- debits whatever account its line names, and class 1 is admitted precisely so
-- that a prepayment — or a capital purchase — can be coded there. A bill line
-- coded to `102150400305 Eskalator C005` IS the acquisition, in the books, with
-- a supplier and a payable behind it.
--
-- The alternative was an "asset clearing" account that registration debits and
-- the bill later credits. That account does not exist in the client's chart,
-- and inventing one puts a line in their books their own accountant cannot
-- explain — the same argument 0052 makes about goods-received-not-invoiced, and
-- it was right there too.
--
-- So what is missing is not a rule. It is a LINK, and the report that says
-- where the link is absent: assets the books never bought, and purchases
-- nobody put on the register.
--
-- # Why the asset points at the line and not the other way
--
-- Because one line buys one asset here, and an asset that was never bought
-- through this system — most of them, on day one — simply has no line. Putting
-- the reference on the bill line would need it nullable on every line of every
-- expense bill, where it means nothing on the electricity.

ALTER TABLE fixed_asset
    ADD COLUMN acquired_via_line_id uuid
        REFERENCES supplier_invoice_expense_line(line_id);

-- One line buys one asset. Partial, because "no line" is the ordinary state and
-- has to stay repeatable: a plain UNIQUE would allow exactly one unbacked asset
-- in the entire register.
CREATE UNIQUE INDEX ux_fixed_asset_acquired_via
    ON fixed_asset (acquired_via_line_id)
    WHERE acquired_via_line_id IS NOT NULL;

CREATE INDEX ix_supplier_invoice_expense_line_asset_family
    ON supplier_invoice_expense_line (account_code)
    WHERE account_code LIKE '10215%';

COMMENT ON COLUMN fixed_asset.acquired_via_line_id IS
    'The expense-bill line that bought this, when the books bought it. The two checks that matter — the line''s account is under 10215 and its amount equals the capitalised cost — are made in Rust, because a constraint naming a client account code is what 0050 exists to prevent. NULL is ordinary: an asset the company already owned has no line.';
