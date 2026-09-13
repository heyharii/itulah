-- A finger opens a till, and authorises a void.
--
-- The counter signs in with a finger far more often than with a keyboard, and
-- a supervisor is called over to a till many times a day. Both are password
-- prompts today, typed in front of a queue — which is how a shop ends up with
-- a supervisor password written on the side of a monitor.
--
-- # Where the matching happens, and why that decides the shape of this table
--
-- On the till, not here. The scanner is USB on the counter and its matcher is
-- the vendor's own (`libzkfp`); this node has neither. So the node's job is to
-- say *which fingers may open this shop* and to decide what a match is worth —
-- and the till's job is to do the matching and say what it found.
--
-- That means the template travels. It is the vendor's opaque blob, not an
-- image, and it cannot be turned back into one — which is the only reason it
-- is acceptable for it to leave this table at all. It still only leaves it to
-- a device that has proved possession of its enrolment key, the same proof
-- `edge_rfid_device` already demands of a reader.

CREATE TABLE IF NOT EXISTS edge_fingerprint (
    finger_id TEXT PRIMARY KEY,
    -- Whose finger. References the same user table that a password is checked
    -- against, so a person who is barred at the keyboard is barred at the
    -- scanner by the same row.
    username TEXT NOT NULL REFERENCES edge_user(username) ON DELETE CASCADE,
    -- Which finger it is, in the enroller's words ("telunjuk kanan"). A person
    -- enrols more than one, because a plaster on a thumb must not stop a shift.
    label TEXT NOT NULL,
    -- The vendor template, base64. Stored as text rather than a blob so it
    -- survives the same JSON export path every other row here takes.
    template_base64 TEXT NOT NULL,
    -- What produced it. A template from one SDK generation does not always
    -- match under another, and a shop that upgrades its scanners needs to know
    -- which enrolments to redo rather than discovering it one cashier at a
    -- time.
    reader_kind TEXT NOT NULL,
    enrolled_at TEXT NOT NULL,
    -- Who stood there and enrolled it. An enrolment is an authorisation to open
    -- a till; an unattributed one is an authorisation nobody granted.
    enrolled_by TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    -- Retired, not deleted. A void authorised last month was authorised by a
    -- finger, and a row that vanished takes the answer to "who let this happen"
    -- with it.
    retired_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS edge_fingerprint_username
    ON edge_fingerprint(username)
    WHERE active = 1;

-- What a till claimed, and what the node made of it.
--
-- Written whether or not the claim was accepted. A refused claim is the more
-- interesting row: a finger tried repeatedly at one terminal at nine in the
-- evening is the shape of somebody trying fingers until one works, and a table
-- that only kept successes could never show it.
CREATE TABLE IF NOT EXISTS edge_fingerprint_claim (
    claim_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    -- Null when the till matched nothing — which is an answer, and is recorded
    -- as one rather than as a missing row.
    finger_id TEXT,
    username TEXT,
    -- `SESSION` to open a till, `SUPERVISOR` to authorise one action on a till
    -- somebody else is signed in to.
    purpose TEXT NOT NULL CHECK (purpose IN ('SESSION','SUPERVISOR')),
    accepted INTEGER NOT NULL CHECK (accepted IN (0,1)),
    -- The node's own word for why not. Kept so a cashier's account of an
    -- evening can be checked against something.
    refusal TEXT,
    -- The vendor's confidence, when the till reported one. Kept as a number so
    -- a threshold can be argued about with evidence rather than adjectives.
    score INTEGER,
    claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS edge_fingerprint_claim_at
    ON edge_fingerprint_claim(claimed_at);

-- The terminal itself, and why it needs a credential of its own.
--
-- Matching happens on the till, so the node is told "this finger belongs to
-- Andi" by the till — and a node that believed that from anything on the shop
-- wifi would be a node where a laptop can mint a supervisor's authorisation.
-- So a claim is signed, and this is what it is signed with.
--
-- `edge_rfid_device` already does exactly this for readers, down to the
-- sequence and the replay digest. It is not reused because its rows are
-- provisioned from cloud policy with a lease (`valid_until`, "reconnect this
-- Edge to Cloud"), and a counter terminal is paired in the shop by whoever
-- installs it. Same mechanics, different life.
--
-- What this credential is worth is worth saying plainly: a paired terminal can
-- assert that a finger matched. That is inherent to matching on the device —
-- the scanner and its matcher are on the counter, not here. It is bounded by
-- three things: every claim is written down against the terminal that made it,
-- a terminal can be deactivated from one row, and a terminal only ever holds
-- the fingers this shop enrolled.
CREATE TABLE IF NOT EXISTS edge_terminal (
    terminal_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    -- SHA-256 of the secret handed to the terminal once, at pairing. The secret
    -- itself is never stored: a node that could read back its terminals' keys
    -- is a node whose theft is every till's theft.
    auth_key_sha256 TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    -- Monotonic per terminal, and the digest of the last request it signed.
    -- Together they make a captured claim useless a second time.
    last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    last_request_digest TEXT,
    last_seen_at TEXT,
    paired_at TEXT NOT NULL,
    -- Who stood at the counter and paired it. Pairing grants a machine the
    -- right to assert identities; an unattributed pairing is that right granted
    -- by nobody.
    paired_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- One authorisation, for one action, for three minutes.
--
-- A supervisor walking to a till and pressing a finger is a step-up, not a
-- session: the cashier stays signed in and the supervisor authorises one thing
-- and walks away. So what a matched supervisor finger buys is a token that is
-- spent once and then gone — long enough to walk back to their own counter,
-- short enough that a supervisor who authorises a void and then leaves has not
-- left a spare key lying on the counter.
--
-- Only the hash is kept, like every other credential here. A token readable
-- out of this table would be an authorisation anybody with the file can spend.
CREATE TABLE IF NOT EXISTS edge_supervisor_grant (
    grant_token_sha256 TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    -- Which terminal earned it. A grant is not transferable: it was issued to
    -- the till the supervisor walked up to, and is spent there.
    terminal_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    -- Set when it is spent. Kept rather than deleted so "who authorised this,
    -- and when" survives the void it paid for.
    spent_at TEXT
);

CREATE INDEX IF NOT EXISTS edge_supervisor_grant_expiry
    ON edge_supervisor_grant(expires_at);
