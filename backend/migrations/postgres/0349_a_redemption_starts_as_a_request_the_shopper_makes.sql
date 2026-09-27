-- 0349: A redemption starts as a request the shopper makes.
--
-- `redeem_points_to_voucher` (0165) has always been able to spend points —
-- debit and issue in one transaction, safe to retry, correctly refusing an
-- overdrawn balance. What it never had was a caller a shopper could reach:
-- the route sits on the operator surface, decided in one call by whoever is
-- signed in, because "how many points buy how much" was declared a loyalty
-- scheme's decision and not the ledger's. Nothing in `frontend-customer` — the
-- member's own app — could ever touch it.
--
-- This does not change that division. It adds the other half of the
-- conversation the pairing code (0082) already has one side of: there, a
-- cashier generates a code and a shopper types it; here, a shopper generates
-- a code and a cashier types it. The shopper says how many points; a cashier,
-- standing at the till with the shopper in front of them, reads the code back
-- and confirms — and confirming is still what decides the rate, at a fixed
-- 1 point = Rp 1 the confirm handler applies and nowhere else does.
--
-- ── Why a row per request, not one slot per member ───────────────────────────
--
-- `member_pairing_code` is keyed by `member_id`: one live code, replaced by
-- the next. A redemption is not disposable the same way — the shopper's own
-- app has to show a history of what was asked for and what became of it
-- ("list redeem poin mereka"), so this is `request_id` as the primary key and
-- every ask keeps its row. The application enforces at most one *live*
-- (pending, unexpired, not locked out) request per member — see
-- `create_redeem_request` — so a cashier reading a member's current request
-- is never choosing between two.
--
-- ── Why this references `loyalty_redemption` and not the other way round ────
--
-- A request may never be confirmed — expired, cancelled, or simply not shown
-- to a cashier. `loyalty_redemption` is only ever written for a spend that
-- actually happened, and a nullable, unconstrained pointer from the request
-- to it is what lets "asked but never redeemed" be the overwhelming common
-- case rather than an error state.
CREATE TABLE member_redeem_request (
    request_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id     text NOT NULL REFERENCES member(member_id),
    points        bigint NOT NULL CHECK (points > 0),
    -- Hashed at rest, exactly like `member_pairing_code.code_sha256` and for
    -- the same reason: the plaintext lives in the response that mints it and
    -- nowhere else, so a database read cannot hand it back out.
    code_sha256   text NOT NULL,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    -- Counted here rather than in a process, exactly like the pairing code's
    -- own counter — a limit a restart forgets is not a limit.
    attempts      integer NOT NULL DEFAULT 0,
    confirmed_at  timestamptz,
    -- The cashier's username, not their session id: this is read back on a
    -- shopper's own history screen one day, and "confirmed by a session" is
    -- not a sentence a person can be shown.
    confirmed_by  text,
    redemption_id uuid REFERENCES loyalty_redemption(redemption_id),
    -- Not used by anything in this change. Present so a future cancel action
    -- has somewhere to write, rather than a migration of its own for one
    -- column the shape below already implies.
    cancelled_at  timestamptz
);

-- A voucher is issued by at most one confirmed request, the same invariant
-- `ux_loyalty_redemption_voucher` already holds one level down — belt and
-- braces costs one index.
CREATE UNIQUE INDEX ux_member_redeem_request_redemption
    ON member_redeem_request (redemption_id) WHERE redemption_id IS NOT NULL;

-- The shopper's history, newest first, and a cashier's "does this member have
-- a live request" check both read by `member_id` first.
CREATE INDEX ix_member_redeem_request_member
    ON member_redeem_request (member_id, requested_at DESC);
