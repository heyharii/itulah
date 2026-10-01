-- 0812: an approver can hand their decisions to somebody for a while.
--
-- Delegasi approval, kept by the owner on 2026-09-30. A store manager on
-- leave names a stand-in from one date to another; while it runs, the
-- stand-in decides what the manager would — leave, expense claims and
-- attendance corrections — with the manager's rung, and nothing else of the
-- manager's. Every decision is still signed by the person who made it; the
-- delegation is the record of why they could.

CREATE TABLE approval_delegation (
    id          text PRIMARY KEY CHECK (btrim(id) <> ''),
    delegator   text NOT NULL REFERENCES app_user (username),
    delegate    text NOT NULL REFERENCES app_user (username),
    from_date   date NOT NULL,
    to_date     date NOT NULL,
    reason      text NOT NULL CHECK (btrim(reason) <> ''),
    created_by  text NOT NULL,
    revoked_at  timestamptz,
    revoked_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT approval_delegation_not_to_oneself CHECK (delegator <> delegate),
    CONSTRAINT approval_delegation_runs_forward CHECK (from_date <= to_date),
    CONSTRAINT approval_delegation_revocation_is_signed
        CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX ix_approval_delegation_delegate ON approval_delegation (delegate, from_date, to_date)
    WHERE revoked_at IS NULL;
