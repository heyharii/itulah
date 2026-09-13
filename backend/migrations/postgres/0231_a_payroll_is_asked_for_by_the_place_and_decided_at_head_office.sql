-- 0231: A payroll is asked for by the place and decided at head office.
--
-- Owner's decisions, 2026-09-13. They reverse the formulation `0105` was
-- written to — recorded in `frontend-hub/PEOPLE-BRIEF.md` as *"verify →
-- approve → seal, and reopen, are head office only"* — and the reversal is
-- deliberate rather than a drift, so it is written down here in full.
--
-- # The place submits the batch, and sees the figures
--
-- Including its own staff's base pay. That visibility was argued against twice
-- and reaffirmed twice, and the reason it matters to the schema is that it is
-- what makes the second signature worth having: a person who cannot see a
-- batch cannot stand behind it, so a store that submitted blind would be
-- adding a name to a document rather than a check to a control.
--
-- # Four states become three, and both deletions are the same deletion
--
-- `DRAFT → VERIFIED → APPROVED → SEALED` becomes `DRAFT → SUBMITTED →
-- APPROVED`, and nothing follows an approval.
--
--   * `VERIFIED` is gone because the act it recorded has moved. It was head
--     office checking figures head office would then approve — one opinion
--     recorded twice — and what replaced it is the place saying "these are my
--     staff and this is what they are owed". So the state is renamed rather
--     than dropped: every stored `VERIFIED` is a first signature and becomes
--     a `SUBMITTED` one.
--   * `SEALED` is gone because approval is already final. A state whose only
--     content is "and we mean it" cannot be told from the state before it, and
--     a run's figures were never editable after approval anyway — nothing in
--     the estate has ever written a slip on an approved run.
--
-- What sealing was reaching for is still here, in a better place: reopening is
-- head office's alone, it clears both signatures, and it is written into the
-- run's own history where somebody reads it.
--
-- # `SEALED` is refused, not rewritten
--
-- There is no sealed data on any database this was written against. There
-- could be one on a node this has not seen, and the two ways of guessing what
-- it means are both wrong: folding it into `APPROVED` would silently unlock a
-- month somebody deliberately locked, and leaving it would leave a state the
-- application can no longer parse, which fails on the next read with a message
-- about a corrupt row rather than about this migration. So it names what it
-- found and stops. Same shape as `0230`, and for the same reason.
--
-- # There is no `verified_by` column to rename
--
-- The rename the plan called for is on the *wire*: `PayrollRunView` served
-- `verified_by`, and the run's signatures have only ever been stored inside
-- `history`. So what this file renames is the step code and the action key
-- inside that jsonb, and the Rust renames the field. A column that never
-- existed is the happier half of this change.

-- ---------------------------------------------------------------------------
-- The state machine
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    sealed_runs text;
BEGIN
    SELECT string_agg(id || ' (' || place_id || ' ' || to_char(period, 'YYYY-MM') || ')',
                      ', ' ORDER BY id)
      INTO sealed_runs
      FROM payroll_run
     WHERE state = 'SEALED'
        OR history @> '[{"step": "SEALED"}]'::jsonb;

    IF sealed_runs IS NOT NULL THEN
        RAISE EXCEPTION
            'these payroll runs are SEALED, and this migration will not decide '
            'what that means on its own: %. Sealing is being removed because '
            'approval is final; a sealed run is a month somebody deliberately '
            'locked, and folding it into APPROVED would unlock it silently. '
            'Decide each one before applying this.', sealed_runs;
    END IF;
END $$;

-- The first signature, renamed where it is stored.
--
-- `jsonb_set` per element rather than a rewrite of the whole array: the rest of
-- each event — its actor, its instant, its reason — is evidence and must come
-- through untouched. The `WHERE` keeps the update off every run that has no
-- such step, so nothing is rewritten that did not need to be.
UPDATE payroll_run
   SET history = (
        SELECT jsonb_agg(
                 CASE WHEN event->>'step' = 'VERIFIED'
                      THEN jsonb_set(
                             jsonb_set(event, '{step}', '"SUBMITTED"'::jsonb),
                             '{authorization,action_key}',
                             '"people.payroll.submit"'::jsonb)
                      ELSE event
                 END
                 ORDER BY ordinality)
          FROM jsonb_array_elements(history) WITH ORDINALITY AS elements(event, ordinality)
       )
 WHERE history @> '[{"step": "VERIFIED"}]'::jsonb;

UPDATE payroll_run SET state = 'SUBMITTED' WHERE state = 'VERIFIED';

ALTER TABLE payroll_run
    DROP CONSTRAINT payroll_run_state_check,
    ADD CONSTRAINT payroll_run_state_check
        CHECK (state IN ('DRAFT', 'SUBMITTED', 'APPROVED'));

COMMENT ON COLUMN payroll_run.state IS
    'DRAFT while the place is building it, SUBMITTED once the place has sent '
    'the figures it stands behind, APPROVED once head office has decided. '
    'Approved is final: there is no state after it, and the only way back is a '
    'reopen, which is head office''s and clears both signatures (0231).';
COMMENT ON COLUMN payroll_run.history IS
    'Every submit, approve and reopen, with its authority. The state is folded '
    'back from this on the way in, and the two-person rule — submitter is not '
    'approver — is re-checked while folding, so a row whose two signatures '
    'carry one name fails to load rather than becoming an approved payroll.';

-- ---------------------------------------------------------------------------
-- The handover to Finance
-- ---------------------------------------------------------------------------
--
-- # Why this is a crossing and not a posting
--
-- Every other module that owes Finance money calls `poster::post` in its own
-- transaction and stamps the journal entry back onto its own row. This one
-- does not, and the obstacle is geography rather than taste.
--
-- A payroll run is keyed by `org_place` — head office plus Store 01 to 13 —
-- because head office employs people too, and a payroll that could only be run
-- for a shop cannot pay the buyer (`0105`). A `journal_line` is keyed by
-- `site NOT NULL`, which is the set of syncing nodes, and head office is not
-- one: `org_place_site_matches_kind` pins `site_id IS NULL` for kind `HO`. So
-- the one run the `org_place` key exists for is the one run with no site to
-- post to.
--
-- The books' own instinct is that head office *is* the DC site —
-- `ledger::book_locations` says so in a comment, and the client's codes suffix
-- head office `00` — but no function in this estate performs that mapping, and
-- inventing it here would decide, on a lane that is not Finance's, which
-- location thirteen shops' worth of salary expense lands in. That is an
-- owner-and-accountant decision.
--
-- So this table is the honest half of the crossing: a named gross liability
-- for one place and one month, with the breakdown behind it, and a state
-- Finance moves. There is deliberately **no `journal_entry_id` column**. The
-- convention for one — `0052`'s nullable FK tied to status by CHECK — is the
-- right convention for a module that posts, and a column that nothing can
-- write is a promise nothing keeps. When the site question is answered, that
-- column and its CHECK are a two-line migration.
--
-- # Gross only, and what that excludes
--
-- Base plus the standing (*tetap*) allowances — `payroll_slip`'s
-- `statutory_base_minor`. Nothing else on a slip is money: overtime is stored
-- in minutes and leave in days, and this estate holds no overtime rate and no
-- daily rate anywhere, so a handover that turned minutes into rupiah would be
-- inventing the multiplier. And nothing statutory is netted off — no PPh 21,
-- no BPJS — for the reason `0105` gives at length: a figure computed here is a
-- figure somebody files with the tax office.
--
-- # Why the breakdown is copied and not joined
--
-- Head office may reopen an approved run **after this has been booked**. The
-- owner accepted that consequence explicitly, so nothing refuses it. What
-- makes it survivable is that these lines are a snapshot: a reopened run whose
-- slips are rebuilt does not retroactively change what Finance was handed. The
-- run moves; the crossing does not.

CREATE TABLE payroll_handover (
    -- One handover per run, and `payroll_run` already allows one run per place
    -- per month — so the primary key and the unique below say the same thing
    -- from two directions, which is what makes "sending twice cannot double
    -- the liability" true however a caller reaches it.
    --
    -- RESTRICT, not CASCADE: `payroll_slip` may go when its run goes because a
    -- slip is a working figure, but this row is money the company has told
    -- Finance it owes. A correction to a month already handed over is a new
    -- period's business, exactly as a second run for a month already paid is.
    run_id      text PRIMARY KEY REFERENCES payroll_run(id) ON DELETE RESTRICT,
    place_id    text NOT NULL REFERENCES org_place(id),
    -- The month, named by its first day. Any other day would let two
    -- "September" liabilities coexist — the check `payroll_run.period` and
    -- `asset_depreciation_entry.period_month` both carry, for the same reason.
    period      date NOT NULL CHECK (extract(day from period) = 1),
    -- The single figure Finance owes. Checked against the sum of the lines by
    -- a deferred trigger below, because a total with no evidence behind it is
    -- what somebody has to explain from memory later.
    gross_minor bigint NOT NULL CHECK (gross_minor > 0),
    -- RECEIVED → PAID. No `DRAFT`: a handover exists because somebody handed
    -- it over, so its first state is Finance holding it.
    state       text NOT NULL CHECK (state IN ('RECEIVED', 'PAID')),
    -- Who handed it over, when, under which key, and why. The same
    -- `Authorization` shape every HR decision is recorded in, and the key gate
    -- is re-checked when the row is decoded.
    handed_over jsonb NOT NULL,
    -- Finance's own signature, and null until Finance gives one. Absence here
    -- is a real state: it says the money has not gone out, not that it went
    -- out unsigned.
    settled     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payroll_handover_one_per_place_period UNIQUE (place_id, period),
    -- Paid and signed for are the same fact, so they cannot disagree — the
    -- shape `supplier_invoice` refuses between its status and its `posted_at`.
    CONSTRAINT payroll_handover_paid_is_signed_for
        CHECK ((state = 'PAID') = (settled IS NOT NULL))
);

CREATE INDEX ix_payroll_handover_place ON payroll_handover (place_id, period DESC);
-- The index Finance's inbox reads: what has been handed over and not paid.
CREATE INDEX ix_payroll_handover_outstanding ON payroll_handover (period DESC)
    WHERE state = 'RECEIVED';

-- One person's share of the liability, as it stood when it crossed.
CREATE TABLE payroll_handover_line (
    run_id      text NOT NULL REFERENCES payroll_handover(run_id) ON DELETE CASCADE,
    -- No CASCADE from `employee`: deleting a person must not silently shrink a
    -- liability somebody is going to pay. Nothing deletes an employee anyway —
    -- employment ends, it is not erased — and if something ever tries, the
    -- refusal is the right answer.
    employee_id text NOT NULL REFERENCES employee(id),
    -- Base plus standing allowances, copied. See the header on what is not in
    -- this number.
    gross_minor bigint NOT NULL CHECK (gross_minor > 0),
    -- One line per person. Two would leave the total right and the breakdown
    -- nonsense.
    PRIMARY KEY (run_id, employee_id)
);

-- The header agrees with its lines, or the transaction does not commit.
--
-- The rule `journal_entry` enforces on itself, enforced here for the reason
-- `0051` gives: application validation is where an invariant lives until the
-- day somebody opens psql, or a second writer appears, or a migration
-- back-fills. This row is what a payment will one day be reconciled against.
--
-- It cannot be a CHECK: the lines do not exist when the header is inserted. So
-- it is a deferred constraint trigger firing at COMMIT, on both tables —
-- either one alone leaves a hole, because checking only the header misses
-- lines appended to a handover that already committed and checking only the
-- lines misses a handover that never got any.
--
-- It raises with plpgsql's default SQLSTATE, P0001, and must keep doing so:
-- `AppError::into_response` recognises exactly that and passes the message
-- through as a 409, so a person reads the sentence. A more precise-looking
-- ERRCODE makes the same refusal arrive as an opaque 500.
CREATE OR REPLACE FUNCTION assert_payroll_handover_adds_up() RETURNS trigger AS $$
DECLARE
    lines  bigint;
    total  bigint;
    header bigint;
    target text;
BEGIN
    -- Both tables carry `run_id`, so one function serves both.
    target := NEW.run_id;

    SELECT gross_minor INTO header FROM payroll_handover WHERE run_id = target;
    -- The header may have been rolled back out from under its lines; there is
    -- then nothing to check.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(gross_minor), 0)
      INTO lines, total
      FROM payroll_handover_line WHERE run_id = target;

    IF lines = 0 THEN
        RAISE EXCEPTION
            'payroll handover % has no breakdown, so its % is a figure with no '
            'evidence behind it', target, header;
    END IF;
    IF total <> header THEN
        RAISE EXCEPTION
            'payroll handover % says % but its breakdown totals %',
            target, header, total;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER payroll_handover_adds_up
    AFTER INSERT ON payroll_handover
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_payroll_handover_adds_up();

CREATE CONSTRAINT TRIGGER payroll_handover_line_adds_up
    AFTER INSERT ON payroll_handover_line
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_payroll_handover_adds_up();

COMMENT ON TABLE payroll_handover IS
    'One gross liability handed to Finance for one place and one month, '
    'idempotent per (place, period) so sending it twice cannot double what the '
    'company owes. It is not a posting: head office has no site and a journal '
    'line must name one, so Finance books this and Finance says when it has '
    'been paid (0231).';
COMMENT ON TABLE payroll_handover_line IS
    'The per-employee breakdown, COPIED at the moment of the handover rather '
    'than joined to payroll_slip — head office may reopen an approved run '
    'afterwards, and what Finance was handed must not change when it does.';
COMMENT ON COLUMN payroll_handover.gross_minor IS
    'Base plus standing allowances, and nothing derived. Overtime is minutes '
    'and leave is days; no rate for either exists anywhere in this estate, so '
    'neither becomes money here. Nothing statutory is netted off.';
