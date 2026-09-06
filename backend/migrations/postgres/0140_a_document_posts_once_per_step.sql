-- 0140: A document posts once for each step it has, and never twice for one.
--
-- # The hole
--
-- `journal_entry` records which document caused it — `source_kind` and
-- `source_id`, and 0083 made carrying them compulsory for every kind but
-- MANUAL and REVERSAL. Nothing has ever stopped the same document being posted
-- twice. Every rule that writes one guards itself in Rust instead: `post_bill`
-- refuses a bill that is not DRAFT, `post_payment` the same, `dispose_asset`
-- checks a status column. Those guards are real and they are all the same
-- shape — read a status, decide, write — which is the shape that loses to two
-- requests arriving together. Both read DRAFT, both decide, both post, and the
-- books carry one bill twice with nothing marked wrong.
--
-- A retry does it without any concurrency at all. A client that resends
-- `POST /finance/bills/{id}/post` because the first response never arrived is
-- doing the correct thing, and today it doubles an entry.
--
-- # Why a purpose and not just the pair
--
-- Because one document legitimately posts more than once, at different moments,
-- and the ledger has to be able to tell those apart from a duplicate.
--
-- A store deposit is the case that forces it: the money is recorded as leaving
-- the shop when the deposit is made, and recognised at head office when the
-- bank confirms it, and those are two entries about one document on two dates.
-- Keyed on the document alone, the second is indistinguishable from a repeat of
-- the first. Keyed on the document AND the step — `DEPOSITED`, `CONFIRMED` —
-- each step posts exactly once and the second attempt at either is refused.
--
-- So `purpose` is the name of the step, defaulting to MAIN because the
-- overwhelming majority of documents have exactly one. `poster::post` takes it
-- as an argument; nothing else may write this column.
--
-- # Two kinds that repeat on purpose
--
-- DEPRECIATION carries the asset as its source and posts every month, and
-- ASSET_TRANSFER carries the asset and posts on every move. Both are honest —
-- the asset really is what caused the entry — and both would collide under a
-- key that had only the document in it. They now name their step: `PERIOD_202609`
-- for a month's charge, `MOVED_20260906` for a move. That is not a workaround
-- for the index; it is the idempotency those two never had. Re-running
-- September's depreciation for an asset already charged in September is a
-- duplicate, and from here it is refused rather than doubled.

ALTER TABLE journal_entry
    ADD COLUMN purpose text NOT NULL DEFAULT 'MAIN'
        -- Upper case with underscores, so a purpose is legible in the register
        -- next to the source kind and cannot arrive as free text somebody typed
        -- with a different capitalisation each time.
        CHECK (purpose ~ '^[A-Z][A-Z0-9_]*$');

COMMENT ON COLUMN journal_entry.purpose IS
    'Which step of its document this entry is: MAIN for the overwhelming majority, and a named step for a document that posts more than once (a deposit at DEPOSITED and again at CONFIRMED). Together with source_kind and source_id it is the idempotency key. Written by poster.rs and by nothing else.';

-- ---------------------------------------------------------------------------
-- The rows that were already there
-- ---------------------------------------------------------------------------
--
-- Every existing entry has just been given purpose MAIN by the DEFAULT above,
-- so any document that legitimately posted twice before this migration — a
-- depreciation run over four months, an asset moved twice — is now a group of
-- rows that the unique index would refuse.
--
-- They are named rather than excluded. An index built "for new rows only" needs
-- a discriminator column that exists for no other reason, and it leaves two
-- shapes of database in the world: one where the guarantee holds over
-- everything and one where it holds over a suffix, with nothing in the schema
-- to say which is which. Naming the clashes instead gives every database the
-- same index over every row, and the name is honest about what it is:
-- LEGACY_JV_00000123 says this entry's step was never recorded, and here is the
-- entry number so you can go and look.
--
-- # Disabling the append-only trigger, which deserves an argument
--
-- The journal is append-only. `protect_journal` refuses every UPDATE and DELETE
-- on `journal_entry`, and that rule is why anybody can trust these books. 0083
-- is the only migration that has ever turned it off, and it made its case in
-- writing. This is the second, and the case is narrower.
--
-- It changes no accounting fact and no fact of provenance either. Not one
-- debit, credit, account, date, amount, entry number, source kind or source id
-- moves. The only column written is one that did not exist a statement ago:
-- MAIN is a default this migration invented for rows that never had a value at
-- all, and for these particular rows the invented default is the one value that
-- is certainly wrong — it claims two entries are the same step, which is
-- exactly the thing the index is being built to forbid.
--
-- Bounded so it cannot reach anything else: only rows that carry a source, only
-- kinds the index covers, and only rows that actually have a twin. A re-run
-- finds no twins, because the first run gave every one of them a different
-- name, so this is a no-op the second time.
--
-- All of it inside this migration's transaction: if the UPDATE fails, the
-- trigger is not left disabled, because the ALTER that disabled it rolls back
-- with everything else.

ALTER TABLE journal_entry DISABLE TRIGGER journal_entry_append_only;

UPDATE journal_entry e
   SET purpose = 'LEGACY_' || replace(e.entry_number, '-', '_')
 WHERE e.source_id IS NOT NULL
   AND e.source_kind NOT IN ('MANUAL', 'REVERSAL')
   AND EXISTS (
        SELECT 1 FROM journal_entry o
         WHERE o.source_kind = e.source_kind
           AND o.source_id   = e.source_id
           AND o.purpose     = e.purpose
           AND o.entry_id   <> e.entry_id);

ALTER TABLE journal_entry ENABLE TRIGGER journal_entry_append_only;

-- ---------------------------------------------------------------------------
-- The key
-- ---------------------------------------------------------------------------
--
-- MANUAL and REVERSAL are out, and for opposite reasons.
--
-- MANUAL has no source at all — 0083's CHECK requires one for every other kind
-- and forbids it here — so the partial predicate on `source_id IS NOT NULL`
-- would already exclude it. It is named anyway, because reading the index
-- should tell you which kinds are guarded without having to know that.
--
-- REVERSAL is different: it carries `reversal_of`, which is UNIQUE, so an entry
-- can be reversed exactly once and that is enforced already. Adding it here
-- would say the same thing twice in two places that could later disagree.
CREATE UNIQUE INDEX ux_journal_entry_source_purpose
    ON journal_entry (source_kind, source_id, purpose)
 WHERE source_id IS NOT NULL
   AND source_kind NOT IN ('MANUAL', 'REVERSAL');

COMMENT ON INDEX ux_journal_entry_source_purpose IS
    'One entry per document per step. A resent request, or two that raced, lands once — the second is refused by the database rather than by a status check that two callers can both pass.';
