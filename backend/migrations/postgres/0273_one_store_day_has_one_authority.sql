-- One store, one trading day, one authority.
--
-- Two modules posted a day's takings, both under `source_kind = 'SALE_DAY'`, and
-- each was idempotent BY ITSELF:
--
--     sales_posting.rs   source_id = the posting's uuid   guarded by
--                        UNIQUE (site_id, business_date) on `sales_posting`
--     sale_day.rs        source_id = 'site:day'           guarded by
--                        PRIMARY KEY (site_id, trading_day) on `sale_day_posting`
--
-- Neither guard could see the other. `ux_journal_entry_source_purpose` is unique
-- on (`source_kind`, `source_id`, `purpose`), and the two source_id shapes never
-- collide — so one shop's Tuesday could be posted through both, recognising the
-- revenue twice, and the trial balance would balance both times.
--
-- 0260 made this worse without meaning to: it dropped `ux_journal_entry_sale_day`
-- as "one step guard and not two that disagree", which was right about the
-- duplication and left `sale_day.rs`'s doc comment describing a guarantee that no
-- longer existed.
--
-- # Which one is the authority, and why
--
-- `sales_posting` (lane A, 2026-09-06). Not because it is older, but because the
-- rest of the money machinery is already attached to it:
--
--   * it opens a Payment Ledger item per acquirer receivable, keyed by provider,
--     and `acquirer::acq_settlement_settle_ledger_items` closes those when the
--     acquirer pays. A day posted the other way puts a card receivable in the
--     ledger with NO open item behind it — a debt nobody can chase, and a
--     divergence `payment_ledger_integrity` then reports forever;
--   * it has the only correction path this ledger has for a day: reverse,
--     regenerate over the same `posting_id`, post again as `ATTEMPT_n`.
--     `sale_day.rs` had no reversal at all, so a day posted wrong through it
--     could only be undone by a hand-written journal;
--   * it carries discounts, returns and untendered money, and it knows what to do
--     with a tender nobody recognises (refuse it, and offer `retender`);
--   * its QRIS money is `qris_receivable` per provider, which is what QRIS
--     actually is (0274). `sale_day.rs` used `qris_clearing`, a meaning nothing
--     else in the estate reads.
--
-- `sale_day.rs`'s writer is REMOVED in the same change as this migration, not
-- hidden behind a flag. Its reader stays and is repointed: "which days are NOT in
-- the book" is a real question that a list of postings cannot answer, and it now
-- answers it from the authority.
--
-- # What it carried that the authority does not
--
-- Two things, and neither is lost:
--
--   * **the tax from the sale's own `tax_minor`** rather than recomputed from a
--     rate. Measured over 21,829 real sales: recorded 1,359,033,170 against
--     1,359,022,320 recomputed at 11% inclusive — Rp 10,850 apart, which is
--     per-sale rounding accumulating, not a rate disagreement. Recorded is still
--     the better source and it is written down as a follow-up in
--     `docs/finance-day-posting-authority.md` rather than changed here, because
--     moving it changes figures and that is its own decision;
--   * **acquirer fees per day.** Those belong to settlement, not to the day: an
--     acquirer pays late and net (0135), and `acquirer_settlement` is where the
--     fee is known rather than guessed at posting time.

-- ---------------------------------------------------------------------------
-- The shape of a day's source id
-- ---------------------------------------------------------------------------
--
-- The authority names its entries by the posting's uuid. Forbidding every other
-- shape means the removed writer's `site:day` cannot come back — by a revert, by
-- a merge, or by somebody writing a third implementation that looks reasonable.
--
-- Checked against every row: no database anywhere holds a SALE_DAY entry in the
-- old shape (verified across every dev database before this was written), so this
-- is VALID rather than NOT VALID and history needs no exemption.
ALTER TABLE journal_entry
    ADD CONSTRAINT journal_entry_sale_day_is_named_by_its_posting
    CHECK (
        source_kind <> 'SALE_DAY'
        OR source_id IS NULL
        OR source_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    );

-- ---------------------------------------------------------------------------
-- And the table the removed writer claimed days in
-- ---------------------------------------------------------------------------
--
-- Kept, not dropped: if any environment holds rows, they are what was posted and
-- the reader still shows them as history. What it stops doing is accepting new
-- ones, so a reintroduced writer cannot claim a day behind the authority's back.
--
-- A trigger rather than a permission, because permissions are per role and this
-- is true of every role.
CREATE OR REPLACE FUNCTION sale_day_posting_is_closed_to_new_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'a trading day is posted through sales_posting, which is the one authority for it (0273). This table holds what the retired writer posted and takes nothing new.'
        USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER sale_day_posting_takes_no_new_rows
    BEFORE INSERT ON sale_day_posting
    FOR EACH ROW EXECUTE FUNCTION sale_day_posting_is_closed_to_new_rows();
