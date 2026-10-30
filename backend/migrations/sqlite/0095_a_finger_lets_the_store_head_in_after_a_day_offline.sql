-- 0095: A finger lets the store head in after a day offline.
--
-- Head office holds a store head's and an admin's offline lease to 24 hours
-- (`edge_user.valid_until`, postgres `auth_policy.rs`), and this node refused
-- every way in once it passed. So a store whose line to head office had been
-- down for a day could not be opened by its head, and nobody there could
-- approve a void.
--
-- A finger proves the person is standing at the till, so head office now
-- sends a longer lease for it beside the password's (the auth policy's
-- `finger_valid_until`, seven days, never earlier than `valid_until`):
--
-- * `edge_user.finger_valid_until` keeps it. NULL is a policy from an older
--   centre, read as `valid_until`: a finger then lasts exactly as long as a
--   password did.
-- * `edge_auth_session.opened_by_finger` says how a session was opened, so a
--   session a finger opened lives under the finger's lease and one a
--   password, a PIN or head office's sign-on opened lives under the
--   password's. Every session from before this file was opened under the
--   password's lease, and keeps it (0).
--
-- Active, head office's stop on the POS and the lockout are unchanged.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so this file is applied once,
-- guarded by the presence of `edge_user.finger_valid_until`
-- (`edge/auth.rs::ensure_finger_lease`), and inside one transaction so a run
-- that dies half way leaves nothing half-added.

BEGIN;

ALTER TABLE edge_user ADD COLUMN finger_valid_until TEXT;

ALTER TABLE edge_auth_session ADD COLUMN opened_by_finger INTEGER NOT NULL DEFAULT 0
    CHECK (opened_by_finger IN (0, 1));

COMMIT;
