-- 0097: A login belongs to somebody, and leaves when they do.
--
-- # What 0060 promised and did not build
--
-- 0060 joined `app_user` to `employee` and said so in a comment on the column:
--
--     ON DELETE RESTRICT rather than CASCADE: ending an employment record must
--     not silently take a login with it. Someone who has left keeps their audit
--     trail, and the account is disabled by the code that handles leaving, in
--     daylight.
--
-- There was no such code. Terminating somebody wrote an employment event and
-- left their credential working — at the centre, and through the policy
-- snapshot, at every till they were assigned to. The employment record said
-- TERMINATED and the door still opened. This migration is the half the sentence
-- was about; the handler that walks somebody out is the other half.
--
-- # Why the binding needs a record of its own
--
-- Every other employment change names its actor, its authority and its reason,
-- and cannot be represented without them. Binding a login to a person did not:
-- it took a username and wrote it, and the only trace was `audit_log`'s floor —
-- POST /api/v1/employees/{id}/account → 200.
--
-- That floor cannot answer this question even in principle. 0078 excludes the
-- request body from `audit_log` on purpose, because bodies here carry passwords
-- and personal data — and the username being bound is *in the body*. So the log
-- can say somebody bound a login to this employee and never which login. The
-- counterpart is unrecoverable, which is the one fact an audit of "who was this
-- person allowed to be" needs.
--
-- Hence a table. It is a history, not a status: the binding itself stays on
-- `app_user.employee_id`, where the unique index keeps it single and every
-- existing join keeps working.

CREATE TABLE employee_account_link (
    id          bigserial PRIMARY KEY,
    employee_id text NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
    -- The account, by its key rather than its name. Usernames are never
    -- released and never deleted, so either would be stable; the id is what
    -- `app_user` is joined by everywhere else.
    user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    -- LINK bound this account to this person; RELEASE unbound it. Both are
    -- decisions somebody took, so both are rows — a release recorded by
    -- deleting the link row would be a change with no record, which is the
    -- state this table exists to end.
    act         text NOT NULL CHECK (act IN ('LINK', 'RELEASE')),
    -- The actor as the session knew them, never as the request claimed.
    actor       text NOT NULL CHECK (btrim(actor) <> ''),
    reason      text NOT NULL CHECK (btrim(reason) <> ''),
    at          timestamptz NOT NULL DEFAULT now()
);

-- "How did this person come to have this login" — the employee sheet's query.
CREATE INDEX ix_employee_account_link_employee
    ON employee_account_link (employee_id, at DESC, id DESC);

-- "Whose login is this, and who says so" — the accounts console's query, and
-- the one an auditor asks about a credential they have found.
CREATE INDEX ix_employee_account_link_user
    ON employee_account_link (user_id, at DESC, id DESC);

-- Bindings made before this table existed are not backfilled.
--
-- A row here is somebody's recorded decision. Writing one on their behalf,
-- naming an actor who never typed a reason, would put a fabricated statement in
-- the middle of the evidence — and the first time it mattered would be the time
-- somebody relied on it. An older binding therefore reads with no provenance,
-- and the screens say "recorded before this was kept" rather than inventing a
-- name.

COMMENT ON TABLE employee_account_link IS
    'Every binding and release of a login to an employment record, with who '
    'decided it and why. The current binding is app_user.employee_id; this is '
    'how it got there.';
COMMENT ON COLUMN app_user.employee_id IS
    'The employment record behind this login, when there is one. Null is a '
    'machine account or a login HR has not finished the paperwork for. '
    'Terminating or suspending the employee deactivates this account — see '
    'cloud::http::employment::transition.';
