-- Corporate tax has somewhere to be owed.
--
-- The client's tax-payable family carries five leaves — PPh 21, PPh 23
-- withheld, VAT out, land and building tax, PPh 25 — and no PPh 29. Their asset
-- side does have `1011302003 Prepaid - PPh Pasal 29`, so the obligation has a
-- prepayment and nowhere to be owed: the year's corporate tax can be paid in
-- instalments and never recognised as a liability.
--
-- `COA 162 Config` files it as `2103006 Hutang PPh Badan / PPh Pasal 29`, and the
-- coverage audit found it to be the ONLY one of the 162 natural accounts with no
-- backend counterpart at all — every other apparent gap turned out to be a hole
-- in the workbook's mapping sheet rather than a missing account.
--
-- # This is a deliberate exception to 0254
--
-- 0254 is the owner's ruling that "the chart holds nothing the client does not
-- have", and it deleted five invented codes to make that true. This adds one.
-- It is an exception made on instruction, not a drift back: the client's chart is
-- missing an obligation they demonstrably incur, the workbook says so, and the
-- alternative is to keep netting corporate tax inside another account.
--
-- `2012101006` is the next free leaf in the client's own family, so the code
-- stays on their ladder rather than starting a family of ours.
--
-- # What this does NOT do
--
-- It does not move `1011302003 Prepaid - PPh Pasal 29` into it. A prepayment and
-- an obligation are two balances, and offsetting them is a decision about a
-- return that nobody has filed — the tax subledger (`tax_period`,
-- `tax_ledger_entry`) is where that belongs. Until then both sit where they are,
-- and 0267 stops either of them taking an ordinary posting.

INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group, dimension,
     requires_counter_site, normal_balance, is_contra)
VALUES
    ('2012101006', 'Hutang Pajak PPh Pasal 29', 'Corporate income tax payable (art. 29)',
     '2012101', false, 'unit', false, 'C', false)
ON CONFLICT (account_code) DO NOTHING;
