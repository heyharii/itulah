-- A temporary password is changed at the next sign-in (owner, 2026-10-18).
--
-- An administrator who sets somebody's password (forgotten, or a new desk)
-- sets a temporary one: the person signs in with it once and is asked to
-- choose their own before the hub opens. Choosing it clears the mark. The
-- administrator therefore knows a password only until it is used.
ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
