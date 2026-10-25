-- 0998: A code on WhatsApp proves the shopper's phone (owner, 25 Oct 2026).
--
-- The owner's call, and it reverses 0082's: a till registers a new member,
-- and the member app signs a member in, only once the shopper has read back
-- six digits sent to that number's WhatsApp. Members are registered at a till
-- and only there. The codes go out through
-- head office's WhatsApp (`cloud/whatsapp.rs`).
--
-- A row per code, not a slot per number: a code asked again replaces nothing,
-- it is simply the newest, and the count of recent rows is the limit on how
-- often one number may be sent one.
CREATE TABLE member_otp (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- REGISTER: a till registering the number. SIGN_IN: the member app,
    -- signing a member in.
    purpose      text NOT NULL CHECK (purpose IN ('REGISTER', 'SIGN_IN')),
    -- The number as the member id it is or will be: local digits, `08…`.
    phone        text NOT NULL,
    -- Hashed, like every code before it (`member_pairing_code`,
    -- `member_redeem_request`): the plaintext went to WhatsApp and nowhere else.
    code_sha256  text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    attempts     integer NOT NULL DEFAULT 0,
    -- The code was read back right. Kept apart from `used_at` because a till
    -- checks the code before the registration it guards is written.
    verified_at  timestamptz,
    used_at      timestamptz,
    -- The shop's node and its cashier, for a till's code.
    origin_id    text,
    asked_by     text,
    message_id   text
);

CREATE INDEX ix_member_otp_phone ON member_otp (phone, requested_at DESC);

-- A redemption now starts at the till (owner, 25 Oct 2026: "customer ga usah
-- masukin berapa, cukup kasir aja yg input"): the cashier says how many
-- points, and the shopper approves it in the member app or reads back the
-- code WhatsApp brought them. The request keeps who asked and where, for the
-- app to say "C014 asks to spend 5.000 points", and how it was approved.
ALTER TABLE member_redeem_request
    ADD COLUMN asked_by            text,
    ADD COLUMN origin_id           text,
    ADD COLUMN site_id             text,
    ADD COLUMN sent_at             timestamptz,
    ADD COLUMN approved_in_app_at  timestamptz,
    -- `MEMBER` (declined in the app), `CASHIER` (taken off the bill) or
    -- `REPLACED` (the cashier asked again).
    ADD COLUMN cancelled_by        text;
