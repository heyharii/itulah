-- One step guard, and not two that disagree.
--
-- `ux_journal_entry_sale_day` (0238) and `ux_journal_entry_source_purpose`
-- (0140) both guard the same thing and they do not agree about it. 0140 is the
-- general rule — one entry per document per STEP — and 0238 is a special case
-- written on another branch three weeks earlier, before the step existed. Where
-- they overlap, 0238 is the stricter of the two, and its extra strictness is
-- wrong.
--
-- # What 0238 wanted, and what 0140 already gives it
--
-- 0238 wanted one SALE_DAY entry per trading day, including against "a repair
-- script, a hand-rolled insert, a future second rule" — its own words. For the
-- rule it was written for that is exactly what 0140 delivers: that rule posts
-- `source_id = '<site>:<day>'` with no purpose, so the step is MAIN, and
-- `(SALE_DAY, '<site>:<day>', 'MAIN')` can exist once. Nothing is lost.
--
-- # What it breaks
--
-- `postgres::sales_posting` posts a day and can be asked to post it again after
-- a reversal. It names each go `ATTEMPT_n` and leans on 0140 to refuse a repeat
-- of the SAME attempt while permitting the next one — the mechanism 0140 exists
-- for. 0238's index ignores the step, so ATTEMPT_2 collides with ATTEMPT_1 on
-- `source_id` alone and the database refuses it. A reversed trading day could
-- not be re-posted at all.
--
-- # What it does NOT catch, and why this migration is not the fix for that
--
-- The two rules spell `source_id` differently — `'<site>:<day>'` on one side, a
-- `sales_posting.posting_id` uuid on the other — so a unique index on that
-- column never compared them in the first place. One trading day can still be
-- carried into the book twice, once through each rule. That is a decision about
-- which rule is canonical, it is recorded in
-- `docs/finance-branch-reconciliation.md` §1, and it is NOT resolved here:
-- dropping an index that was not preventing it either way must not be mistaken
-- for closing it.

DROP INDEX IF EXISTS ux_journal_entry_sale_day;

COMMENT ON INDEX ux_journal_entry_source_purpose IS
    'One entry per document per step. A resent request, or two that raced, lands once — the second is refused by the database rather than by a status check that two callers can both pass. Also the only guard on SALE_DAY since 0260 dropped 0238''s narrower one, which ignored the step.';
