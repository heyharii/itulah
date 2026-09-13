-- A node says which step-up it accepts, and a PIN is a staging thing.
--
-- A till is opened, and a supervisor authorises a void, by one of two things
-- besides a password: a PIN, or a finger. Which one is **the node's decision**
-- and not the terminal's — a staging shop runs on PINs because there is no
-- scanner to press, and a real shop runs on fingers.
--
-- The important half of that sentence is the refusing. A production node does
-- not merely stop the till from *showing* a PIN box: it refuses a PIN claim
-- outright. A method that is hidden in the interface and still accepted at the
-- door is the weakest thing left in the building, and it is weakest exactly
-- where nobody is looking for it.

CREATE TABLE IF NOT EXISTS edge_auth_option (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    -- `NONE` — password only, which is what every node did before this table.
    -- `PIN` — staging. `FINGERPRINT` — production.
    --
    -- One value rather than a set, on purpose. "Both" reads as flexibility and
    -- behaves as "the weaker of the two", because an attacker picks and a
    -- cashier picks the quicker one. A shop moving from staging to production
    -- changes this row once and every till follows.
    till_step_up TEXT NOT NULL DEFAULT 'NONE'
        CHECK (till_step_up IN ('NONE','PIN','FINGERPRINT')),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

-- Default to the state every existing node is already in. A migration that
-- switched a live shop's door open would be a migration nobody asked for.
INSERT OR IGNORE INTO edge_auth_option (singleton, till_step_up, updated_at, updated_by)
VALUES (1, 'NONE', '1970-01-01T00:00:00Z', 'migration');

-- A PIN, kept apart from the user it belongs to.
--
-- Not a column on `edge_user`, and that is not tidiness. Those rows are partly
-- a projection of cloud accounts (`source` is `CLOUD` or `LOCAL`), so a column
-- there is a column a sync can overwrite — and the failure would be silent:
-- every cashier's PIN quietly gone one morning, with nothing to point at.
--
-- Argon2, the same hashing the password gets, because six digits deserve more
-- protection than six letters rather than less. What keeps a six-digit secret
-- usable at all is the lockout it shares with the password
-- (`edge_user.failed_login_count`, `login_blocked_until`): wrong five times and
-- the account is shut, and no finger opens it either.
CREATE TABLE IF NOT EXISTS edge_user_pin (
    username TEXT PRIMARY KEY REFERENCES edge_user(username) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    set_at TEXT NOT NULL,
    -- Who set it. A PIN is a way into a till; one that appeared with nobody's
    -- name on it is a way in that nobody granted.
    set_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
