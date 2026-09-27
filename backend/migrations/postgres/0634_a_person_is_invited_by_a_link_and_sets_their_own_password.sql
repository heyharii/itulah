-- A person is invited by a link, and sets their own password.
--
-- Owner's decision, 28 Sep 2026. Head office invites people by naming them,
-- their job role (0633) and their unit, and is handed a one-time link to copy
-- — no email, no WhatsApp, nothing sent by the system. The person opens the
-- link, chooses a username, sets a password and is signed in. The
-- administrator never types or sees that password: the old way ("System ›
-- Accounts", then a password read out across a counter) put a live credential
-- in two heads and usually on a sticky note.
--
-- # What the link is
--
-- `{origin}/join/{token}`, where the token is 32 random bytes, base64url. Only
-- its SHA-256 is stored, so this table cannot be read back into a working
-- link: head office is shown the link once, when it is made or renewed.
-- Renewing replaces the hash, so the old link stops working the moment a new
-- one exists. A link lasts 72 hours.
--
-- # What an invitation already did, and what it waits for
--
-- The employment record exists from the moment of inviting: the person is
-- registered as a CANDIDATE and posted to the unit, through the same code as
-- People › Directory. What waits for the link is the login — `app_user`,
-- bound to that record — which is why `employee_id` is required here and
-- `user_id` is filled only on acceptance.
--
-- The state is not stored as a word. It is read from the columns, so it can
-- never disagree with them:
--
--   ACCEPTED  accepted_at set
--   REVOKED   revoked_at set
--   EXPIRED   neither, and expires_at has passed
--   PENDING   neither, and expires_at has not

CREATE TABLE user_invitation (
    id                 uuid PRIMARY KEY,
    token_sha256       text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
    employee_id        text NOT NULL REFERENCES employee (id) ON DELETE RESTRICT,
    name               text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 128),
    role_code          text NOT NULL REFERENCES job_role (code) ON UPDATE CASCADE,
    unit_id            text NOT NULL REFERENCES unit (id),
    position           text CHECK (position IS NULL OR (btrim(position) <> '' AND length(position) <= 128)),
    suggested_username text NOT NULL CHECK (btrim(suggested_username) <> ''),
    created_by         text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    renewed_at         timestamptz,
    renewed_by         text,
    accepted_at        timestamptz,
    user_id            uuid REFERENCES app_user (id) ON DELETE RESTRICT,
    username           text,
    revoked_at         timestamptz,
    revoked_by         text,
    CONSTRAINT user_invitation_expires_after_it_is_made CHECK (expires_at > created_at),
    CONSTRAINT user_invitation_ends_one_way CHECK (accepted_at IS NULL OR revoked_at IS NULL),
    CONSTRAINT user_invitation_accepted_names_the_login CHECK (
        (accepted_at IS NULL) = (user_id IS NULL) AND (user_id IS NULL) = (username IS NULL)
    ),
    CONSTRAINT user_invitation_revoked_names_who CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- One open invitation per person: a second link for somebody who already has
-- one is a renewal, not a new invitation.
CREATE UNIQUE INDEX ix_user_invitation_one_open_per_employee
    ON user_invitation (employee_id)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX ix_user_invitation_created ON user_invitation (created_at DESC, id DESC);

COMMENT ON TABLE user_invitation IS
    'A one-time join link head office made for one person (0634): only the token''s hash is kept; the login is created when the person accepts.';
