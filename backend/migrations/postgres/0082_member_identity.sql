-- Who a member is, so their points stop being readable by anyone who guesses a
-- card number.
--
-- Until now the whole customer domain was one nullable text column on
-- `edge_sale` (0042) plus three read endpoints scoped by a `customer_id` taken
-- from the URL. That was honest about what it was — "a member id in the path is
-- an argument, not a credential" — but it means any node account can read any
-- shopper's history, and it is why the member app still stands behind an
-- operator login no shopper should ever see.
--
-- ── What is being proved, and by what ────────────────────────────────────────
--
-- One question only: is the person looking at this screen the holder of that
-- card? Three reference implementations were read before writing this
-- (`retail/internal/cloud/customer` in Go, `final-product/.../cloud-customer`
-- in Rust, `fresh/crates/member-domain`) and all three answer it with a
-- one-time code sent to a phone number.
--
-- We do not, and the reason is this market. A phone OTP proves control of a
-- NUMBER. Indonesian operators recycle a prepaid number after roughly 60–90
-- days of inactivity, and prepaid numbers are changed often by the shoppers
-- this is for — so whoever is issued a recycled number would inherit the
-- previous holder's purchase history. As evidence of "holds this card" it is
-- weaker than it looks, and it is the only option that also needs a paid
-- provider (WhatsApp Cloud API or an SMS gateway) and a data connection at the
-- moment somebody is trying to sign in.
--
-- A code read out by the cashier proves the thing we actually care about: the
-- card is in the person's hand, in the shop, checked by an employee. It costs
-- nothing, needs no provider, survives a dead data connection, and — unlike an
-- OTP — every issuance is attributable to the cashier who made it, which is
-- the only defence against the one attack this scheme has (a dishonest
-- cashier pairing their own phone to a customer's card).
--
-- The phone number is therefore NOT in this migration at all. When it arrives
-- it will be contact detail behind consent, not a credential, and it can be
-- added as a second path without touching the identity model below.

-- ─────────────────────────────────────────────────────────────────────────────
-- The member.
--
-- Keyed by the number on the card, NOT by a fresh uuid. The reference Rust
-- implementation mints `cust_<uuid>` at registration, which is clean on an
-- empty database and wrong on ours: `edge_sale.customer_id` already holds
-- whatever the till was told, and issuing a new id would detach every sale a
-- member has ever made from the member who made it. The number the cashier
-- reads out IS the identity here.
--
-- Identity and standing only — no counts, no totals, no tier. Those are derived
-- from `edge_sale`, and a stored copy is one that goes stale against the sales
-- that earned it. (`fresh/crates/member-domain` argues this at length for tier
-- and is right.)
CREATE TABLE member (
    member_id    text PRIMARY KEY,
    -- Optional. A shopper who will not give a name still gets a card, and a
    -- required name is a required lie.
    display_name text,
    joined_on    date NOT NULL DEFAULT current_date,
    -- Set when a membership is stopped. Blocked rather than deleted: the sales
    -- stay, and deleting the member would leave them attributed to a row nobody
    -- can look up.
    blocked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN member.member_id IS
    'The number on the card — the same value edge_sale.customer_id already '
    'carries. Not a uuid: re-keying would detach every existing sale.';

-- No foreign key from `edge_sale.customer_id` to here, on purpose. Sales arrive
-- from edge nodes that have never seen this table; a sale naming a member the
-- centre has not enrolled yet must be accepted and attributed, not rejected.
-- The join is a LEFT JOIN and a missing row means "not enrolled", not "corrupt".

-- ─────────────────────────────────────────────────────────────────────────────
-- The pairing code a cashier reads out.
--
-- Issued at the counter against a card that is physically present, consumed
-- once by the app, and dead either way within minutes.
CREATE TABLE member_pairing_code (
    member_id   text PRIMARY KEY REFERENCES member(member_id) ON DELETE CASCADE,
    -- Hashed at rest, never returned again after issuing and never logged. The
    -- Go reference stored its codes in plain text and compared them with `!=`;
    -- one SELECT there hands over every code in flight.
    code_sha256 text NOT NULL,
    -- Who issued it. This is the whole accountability story for the attack this
    -- scheme has: a cashier who pairs their own phone to somebody else's card
    -- leaves their name on the row that did it. None of the three phone-OTP
    -- references can name anyone.
    issued_by   text NOT NULL,
    issued_at   timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    -- Counted in the database, because the count has to survive the process.
    -- The Go reference counted attempts in a process-local map — lost on
    -- restart, useless across replicas — and the Rust port dropped attempt
    -- limiting altogether. Six digits with unlimited guesses is not a second
    -- factor; it is a formality.
    attempts    integer NOT NULL DEFAULT 0,
    consumed_at timestamptz
);

-- One live code per member: issuing again replaces the previous one, so
-- "I asked twice and the first one still worked" is not a state this can be in.
-- Hence member_id as the primary key rather than a row per issuance.

CREATE INDEX ix_member_pairing_code_expiry ON member_pairing_code (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- The member's session.
--
-- Its own table, never `auth_session`: an operator session carries a role and
-- authorises writes across the whole system, and a shopper's proof that they
-- hold a loyalty card must never be able to become one of those by accident.
--
-- Opaque and hashed, the shape `auth_session` already uses, so a database read
-- yields nothing replayable. The Go reference kept sessions in a process-local
-- map — gone on restart, unusable across replicas; the Rust port persisted
-- them, and this follows the Rust port.
CREATE TABLE member_session (
    session_id        uuid PRIMARY KEY,
    token_sha256      text NOT NULL UNIQUE,
    -- A cookie is sent by the browser whether or not the page asking for it is
    -- ours, so a cookie session needs CSRF. Same pairing as `auth_session`.
    csrf_token_sha256 text NOT NULL,
    member_id         text NOT NULL REFERENCES member(member_id) ON DELETE CASCADE,
    -- Which shop paired this device, and who served them. Kept because "my
    -- points are being read by somebody else" is a question a member will ask,
    -- and the answer has to be in the database rather than in a memory.
    paired_at_site    text,
    paired_by         text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    revoked_at        timestamptz
);

CREATE INDEX ix_member_session_member
    ON member_session (member_id)
    WHERE revoked_at IS NULL;

CREATE INDEX ix_member_session_expiry ON member_session (expires_at);
