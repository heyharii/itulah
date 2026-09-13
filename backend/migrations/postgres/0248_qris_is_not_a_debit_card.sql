-- 0248: QRIS is not a debit card, and neither is a tender nobody has named.
--
-- # What was wrong
--
-- 0238 gave the counter's three unanswered tenders somewhere to go, and two of
-- those three were clearing accounts of their own:
--
--     1011101003  Piutang QRIS
--     1011101004  Piutang Tender Lain-Lain
--
-- with `qris_clearing` and `other_tender_clearing` bound to them. That was
-- correct work and it lasted six days.
--
-- 0244 then collapsed the chart onto the unit dimension using
-- `docs/fixtures/coa-final.json`, which was derived from the client's own
-- export BEFORE 0238 existed. The fixture therefore knew no QRIS meaning, and
-- the migration had to put one somewhere: it chose `1011101002 Piutang Kartu
-- Debit`, said so in its header as the only judgement in the file, and wrote
-- the reason onto the thirty `ledger_account_remap` rows it applies to —
--
--     'JUDGEMENT: the 219-account chart has no tender-clearing account for
--      QRIS or for an unnamed tender; both are an acquirer owing for a
--      card-rail tender at the counter, so they land on Piutang Kartu Debit.
--      Change this row if the owner wants QRIS on its own line.'
--
-- — which is exactly the invitation this migration accepts.
--
-- The judgement is wrong on its own terms. A QRIS acquirer is not a card
-- acquirer: it settles on a different rail, on a different day, at a different
-- MDR, against a different statement. With both on one account a QRIS sale and
-- a debit-card sale are the same row in the ledger, the Accounts receivable
-- screen reports "Owed by acquirers" as one number that silently merges them,
-- and nobody reconciling a QRIS settlement report has an account to reconcile
-- it AGAINST. In this database that is Rp 1,142,837,121 of QRIS sitting inside
-- a card receivable — a third more than the card money it is hiding behind.
--
-- # These two accounts are OURS, and the owner has to approve them
--
-- Said here rather than left to be discovered. The client's chart has no QRIS
-- account and cannot have one: their chart is older than QRIS. So neither of
-- these two can take a client name the way every other account in this chart
-- does, and the rule the owner set on 2026-09-14 — we do not invent accounts
-- and we do not rename theirs — means an account we invent has to be VISIBLE
-- as one rather than slipped in among 298 that are theirs.
--
--     1011101003  Piutang QRIS               ours, new
--     1011101004  Piutang Tender Lain-Lain   ours, new
--
-- Both are named plainly and in the chart's own idiom, both are marked `NEW.`
-- in `docs/fixtures/coa-final.json` with `legacy_templates` empty — which is
-- what says "no client account became this" — and both join the short list in
-- `docs/coa-final.md` §8.7 of accounts the simplified chart had to add and the
-- owner is asked to approve. That list is now four: Setoran Dalam Perjalanan,
-- Selisih Kas, and these.
--
-- What is NOT invented here is the meaning. 0238 named both, and the till has
-- been taking QRIS across the counter the whole time; the only question the
-- owner is being asked is whether their chart should gain two rows to say so.
-- Until they answer, the money is on an account that names what it is rather
-- than on one that names something else.
--
-- # One account per meaning, and no per-unit copies
--
-- 0238 minted these families the way the client builds every family: a group
-- with fourteen leaves under it, one per unit. That shape is gone. 0243/0244
-- made the unit a DIMENSION — `journal_line.site_id`, NOT NULL on every
-- posting since 0051 — and 0244 added `ledger_account_carries_no_unit` to make
-- it structural. So what is minted here is TWO POSTING ACCOUNTS and not
-- twenty-eight leaves under two groups.
--
-- The codes are 0238's own. `1011101003` and `1011101004` are the next two
-- free numbers under `10111 Piutang` in the collapsed chart, they are the
-- codes the two meanings already had, and reusing them means a balance that
-- was reported under `1011101003` before the collapse is reported under
-- `1011101003` after it. They stop being `ledger_account_remap` entries and
-- become accounts again, which is why the two ten-digit rows are deleted from
-- that table rather than repointed: 0244's own convention gives no remap row
-- to an account that kept its code. The twenty-eight twelve-digit LEAVES
-- keep their rows and are repointed, because those really did go somewhere.
--
-- # What this does not do
--
-- It does not touch the postings' totals, only which account they name. The
-- book balances before and after by construction: every line moved is a debit
-- moved from one asset account to another, and `1011101002` and `1011101003`
-- hang off the same `10111 Piutang`, so even the group total is unchanged.

-- ---------------------------------------------------------------------------
-- Step one: two accounts
-- ---------------------------------------------------------------------------
--
-- `dimension = 'unit'` like every other receivable: a QRIS balance is a shop's
-- and the line carries which shop. `normal_balance = 'D'` because an acquirer
-- owing us is an asset.
--
-- The parent is `1011101 Piutang Dagang` and not `10111 Piutang`. 0247 lands
-- between 0244 and this file and puts every posting account back on the
-- client's five-rung ladder — 1, 3, 5, 7, 10, no rung skipped — and it created
-- `1011101` under the client's own name to hold the two card receivables.
-- Hanging a posting account on the five-digit group would make `10111` a mixed
-- parent again, which the client's chart never does anywhere and which is the
-- exact defect 0247 was written to remove. These three are siblings: the card,
-- the QRIS and the tender nobody has named yet.
--
-- Conditional on that rung for the habit 0238 explains: a chart is IMPORTED
-- rather than migrated, so an unconditional insert would fail on a database
-- that has no chart naming a foreign key rather than the reason.

INSERT INTO ledger_account
    (account_code, name, name_en, parent_code, is_group,
     dimension, requires_counterparty, normal_balance, is_contra,
     is_active, site_id, counterparty_site_id)
SELECT v.account_code, v.name, v.name_en, '1011101', false,
       'unit', false, 'D', false, true, NULL, NULL
  FROM (VALUES
    ('1011101003', 'Piutang QRIS', 'QRIS settlement receivable'),
    ('1011101004', 'Piutang Tender Lain-Lain', 'Other tender settlement receivable')
  ) v(account_code, name, name_en)
 WHERE EXISTS (SELECT 1 FROM ledger_account
                WHERE account_code = '1011101' AND is_group)
    ON CONFLICT (account_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Step two: the two meanings point at them again
-- ---------------------------------------------------------------------------
--
-- `account_map` keeps its per-site rows — its primary key is
-- `(semantic_key, site_id, qualifier)` and `site_id` is NOT NULL — so this is
-- fourteen rows per meaning all naming the same account, which is what every
-- other meaning looks like after 0244.
--
-- Narrowed to rows that still point at the debit receivable, so a binding
-- somebody has since chosen on the Account Map screen is left alone. Being
-- wrong is ours to fix; a decision is not.

UPDATE account_map
   SET account_code = '1011101003',
       set_by = 'migration:0248',
       note = 'QRIS taken at the counter, not yet settled into the bank; '
              'its own account since 0248'
 WHERE semantic_key = 'qris_clearing'
   AND account_code = '1011101002'
   AND EXISTS (SELECT 1 FROM ledger_account
                WHERE account_code = '1011101003' AND is_group = false);

UPDATE account_map
   SET account_code = '1011101004',
       set_by = 'migration:0248',
       note = 'a tender the till could only call OTHER — a counter transfer, '
              'today; its own account since 0248'
 WHERE semantic_key = 'other_tender_clearing'
   AND account_code = '1011101002'
   AND EXISTS (SELECT 1 FROM ledger_account
                WHERE account_code = '1011101004' AND is_group = false);

-- ---------------------------------------------------------------------------
-- Step three: move the money that already landed in the wrong place
-- ---------------------------------------------------------------------------
--
-- A repointed mapping only changes what happens NEXT. Every day already in the
-- book still has its QRIS sitting on the card receivable, and a chart fix that
-- left them there would mean the account means one thing before a date and
-- another after it — the single worst outcome available here, because it is
-- invisible in every report that does not cut on that date.
--
-- # How a line is known to be QRIS
--
-- The line itself cannot say: after 0244 it names `1011101002` and nothing
-- else. But `sale_day_posting` records what the rule SAW when it posted, and
-- `sale_day` builds its debits in a fixed order — cash, debit card, credit
-- card, QRIS, voucher, other — skipping any that came to nothing. So the
-- lines on the card receivable within one entry are, in `line_number` order,
-- exactly the non-zero members of
--
--     1  card   card_debit + card_unattributed - card_debit_fee
--     2  qris   qris - qris_fee
--     3  other  other
--
-- That is a derivation and not a reading, so it is ASSERTED rather than
-- trusted: the amounts are compared leg by leg and the migration raises if a
-- single one disagrees. A chart repair that guessed which half of a receivable
-- was which would be worse than the defect it fixes.

CREATE TEMPORARY TABLE tender_leg ON COMMIT DROP AS
SELECT p.entry_id,
       v.meaning,
       v.amount,
       ROW_NUMBER() OVER (PARTITION BY p.entry_id ORDER BY v.ordinal) AS leg
  FROM sale_day_posting p
 CROSS JOIN LATERAL (VALUES
        (1, 'card',  p.card_debit_minor + p.card_unattributed_minor - p.card_debit_fee_minor),
        (2, 'qris',  p.qris_minor - p.qris_fee_minor),
        (3, 'other', p.other_minor)
     ) AS v(ordinal, meaning, amount)
 WHERE v.amount > 0;

CREATE TEMPORARY TABLE receivable_line ON COMMIT DROP AS
SELECT l.line_id,
       l.entry_id,
       l.debit_minor,
       ROW_NUMBER() OVER (PARTITION BY l.entry_id ORDER BY l.line_number) AS leg
  FROM journal_line l
  JOIN sale_day_posting p ON p.entry_id = l.entry_id
 WHERE l.account_code = '1011101002'
   AND l.debit_minor > 0;

DO $$
DECLARE
    legs bigint;
    lines bigint;
    wrong bigint;
    stray bigint;
BEGIN
    SELECT count(*) INTO legs  FROM tender_leg;
    SELECT count(*) INTO lines FROM receivable_line;
    IF legs <> lines THEN
        RAISE EXCEPTION
            'the day''s takings say % legs land on the card receivable and the '
            'journal has % lines there; the two cannot be matched leg by leg, '
            'so nothing is moved', legs, lines;
    END IF;

    SELECT count(*) INTO wrong
      FROM tender_leg t
      JOIN receivable_line r ON r.entry_id = t.entry_id AND r.leg = t.leg
     WHERE r.debit_minor <> t.amount;
    IF wrong > 0 THEN
        RAISE EXCEPTION
            '% lines on the card receivable do not match the tender the day''s '
            'row says they are; the posting order this migration reads them by '
            'no longer holds and the split would be a guess', wrong;
    END IF;

    -- And no line on the card receivable belonging to a SALE_DAY entry that
    -- has no row in `sale_day_posting` to explain it. There should be none —
    -- the table is what claims the day — but a line nobody can attribute is
    -- exactly the thing that must stop this rather than be left behind.
    SELECT count(*) INTO stray
      FROM journal_line l
      JOIN journal_entry e ON e.entry_id = l.entry_id
     WHERE l.account_code = '1011101002'
       AND e.source_kind = 'SALE_DAY'
       AND NOT EXISTS (SELECT 1 FROM sale_day_posting p WHERE p.entry_id = l.entry_id);
    IF stray > 0 THEN
        RAISE EXCEPTION
            '% lines sit on the card receivable under a SALE_DAY entry with no '
            'posting row to say what tender they were', stray;
    END IF;
END $$;

-- The journal is append-only by trigger — the rule that makes it a ledger —
-- so the trigger comes off for the length of these two statements and goes
-- straight back on, the way 0244 did it. This is not an edit to what a line
-- SAYS: the same rupiah, the same day, the same unit, under the account that
-- was always meant.
ALTER TABLE journal_line DISABLE TRIGGER journal_line_append_only;

UPDATE journal_line l SET account_code = '1011101003'
  FROM tender_leg t, receivable_line r
 WHERE r.line_id = l.line_id
   AND t.entry_id = r.entry_id AND t.leg = r.leg
   AND t.meaning = 'qris';

UPDATE journal_line l SET account_code = '1011101004'
  FROM tender_leg t, receivable_line r
 WHERE r.line_id = l.line_id
   AND t.entry_id = r.entry_id AND t.leg = r.leg
   AND t.meaning = 'other';

ALTER TABLE journal_line ENABLE TRIGGER journal_line_append_only;

-- ---------------------------------------------------------------------------
-- Step four: the map of the old chart stops saying they went to the card
-- ---------------------------------------------------------------------------
--
-- `ledger_account_remap` is kept forever because it is the only record of
-- where a balance went. Leaving the QRIS rows pointing at `1011101002` would
-- make it the only record of where a balance went WRONG, and anyone reading
-- last year's figure against this year's would be told the two are the same
-- account.

UPDATE ledger_account_remap r
   SET new_code = CASE left(r.legacy_code, 10)
                    WHEN '1011101003' THEN '1011101003'
                    ELSE '1011101004'
                  END,
       note = 'unit suffix ' || right(r.legacy_code, 2) || ' dropped'
 WHERE left(r.legacy_code, 10) IN ('1011101003', '1011101004')
   AND length(r.legacy_code) = 12
   AND EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '1011101003');

-- The two ten-digit codes are accounts again, and 0244 writes no remap row for
-- a code that kept its own. Deleting them is what makes this table mean the
-- same thing for these two families as for every other.
DELETE FROM ledger_account_remap
 WHERE legacy_code IN ('1011101003', '1011101004')
   AND EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '1011101003');

-- ---------------------------------------------------------------------------
-- Step five: say what moved, and prove nothing else did
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    moved_qris  bigint;
    moved_other bigint;
    amount_qris bigint;
    debits      bigint;
    credits     bigint;
BEGIN
    SELECT count(*), COALESCE(sum(debit_minor), 0) INTO moved_qris, amount_qris
      FROM journal_line WHERE account_code = '1011101003';
    SELECT count(*) INTO moved_other
      FROM journal_line WHERE account_code = '1011101004';
    RAISE NOTICE
        '0248 moved % postings (%) to Piutang QRIS and % to Piutang Tender Lain-Lain',
        moved_qris, amount_qris, moved_other;

    SELECT COALESCE(sum(debit_minor), 0), COALESCE(sum(credit_minor), 0)
      INTO debits, credits FROM journal_line;
    IF debits <> credits THEN
        RAISE EXCEPTION 'the book no longer balances: debits %, credits %', debits, credits;
    END IF;
END $$;
