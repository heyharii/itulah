-- The other side of a line is a UNIT, and the column should say so.
--
-- `requires_counterparty` (0243) is read by exactly one thing — the posting
-- validator 0261 brought with it — and its name invites the wrong reading. A
-- "counterparty" in finance is whoever is on the other side of a transaction: a
-- supplier, a customer, an employee, an owner. This column means none of those.
-- It means the other UNIT, and the value it demands is `journal_line.
-- counter_site_id`, a `site` id.
--
-- Renamed before anything else starts depending on it. A supplier requirement, a
-- principal requirement, an acquirer or a settlement batch — those are typed
-- references and they are NOT this column; the day one of them is added, a field
-- called `requires_counterparty` would be the obvious place to put it and the
-- wrong one.
--
-- # The workbook asks for seven accounts, this sets three, and that is right
--
-- `COA 162 Config` marks seven accounts as needing a counter unit — two goods in
-- transit (`From Unit; To Unit`) and five affiliate (`Unit; Counterparty Unit`).
-- Three of them have the flag here. The other four are not a miss: they have no
-- row in our chart at all.
--
--     1104101 BDP Barang Dagangan          -> 1011203001  set
--     1104102 BDP Kantong Belanja          -> 1011204001  set
--     1201001 Piutang Affiliasi Pembiayaan -> 1021401001  set
--     1201002 Piutang Affiliasi Atas Barang    no account in the chart
--     1201009 Piutang Affiliasi Lain-lain      no account in the chart
--     2105001 Hutang Affiliasi Pembiayaan      no account in the chart
--     2105002 Hutang Affiliasi Atas Barang     no account in the chart
--
-- The client's own export carries all four families — 196 leaves each — and
-- 0244's curation kept one of them. So the disagreement is about which affiliate
-- accounts the chart holds, not about which are two-sided, and it belongs to
-- whoever decides that. Recorded in `docs/finance-branch-reconciliation.md`.

ALTER TABLE ledger_account
    RENAME COLUMN requires_counterparty TO requires_counter_site;

COMMENT ON COLUMN ledger_account.requires_counter_site IS
    'True when a line on this account must name the other UNIT in `journal_line.counter_site_id` — goods in transit both ways and the inter-unit current account. Not a party requirement: a supplier, an employee, a principal, an acquirer or a settlement batch is a typed reference and none of them is this column.';
