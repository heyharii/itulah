-- 0044: A till takes only the vouchers head office actually held for it.
--
-- A voucher is bearer value spendable at any shop, so the only place that can
-- say "this card still has Rp 150.000 on it, and it is yours for this basket"
-- is the centre, and it says so by granting a hold (`/store/vouchers/{code}/
-- authorize`, relayed by this node). The sale then carries the hold's id on
-- its VOUCHER tender and the centre turns the hold into the redemption when
-- the sale reaches it.
--
-- Until this table, the till checked only that the id was not empty. With the
-- line down — or with a cashier's token and a terminal on the shop's LAN — a
-- sale could name any string as its hold, and the goods left the shop against
-- a voucher nobody had checked. The centre did catch it, when the fact
-- arrived: `commit_voucher_hold_for_fact` refuses a hold that was never
-- granted. But refusing there is too late twice over. The garment is already
-- gone, and the refusal BLOCKS the shop's whole sync stream, so every later
-- sale from that shop — its takings, every other member's points — stops
-- reaching the centre until somebody repairs it by hand.
--
-- Every genuine hold passes through this node, because this node is the only
-- relay a till has. So the node writes each one down as it relays it, and a
-- sale may spend only a hold written here: granted, not yet spent, not
-- released, not expired, and for at least the amount the tender takes. That
-- check needs no connection at the moment of sale — the connection was needed,
-- and used, when the hold was granted — which is exactly the rule the shop
-- wants: no line to head office, no voucher.

CREATE TABLE IF NOT EXISTS voucher_hold (
    authorization_id TEXT PRIMARY KEY,
    code             TEXT NOT NULL,
    checkout_id      TEXT NOT NULL,
    amount_minor     INTEGER NOT NULL CHECK (amount_minor > 0),
    -- As head office stated it. Null only if head office said nothing, in
    -- which case the hold is taken at its word for as long as it is HELD.
    expires_at       TEXT,
    status           TEXT NOT NULL DEFAULT 'HELD'
                     CHECK (status IN ('HELD', 'USED', 'RELEASED')),
    sale_id          TEXT,
    held_at          TEXT NOT NULL,
    closed_at        TEXT
);

CREATE INDEX IF NOT EXISTS ix_voucher_hold_basket
    ON voucher_hold (code, checkout_id);
