-- 0078: A till takes only the limited-coupon uses head office actually held.
--
-- A coupon with a cross-shop cap (HEMAT50, "kuota 100 transaksi") cannot be
-- admitted from this node's snapshot: the count in it is as old as the last
-- sync, and two shops each reading "99 of 100" both give the hundredth away.
-- The pricing engine has always refused such a coupon for that reason
-- (`CouponNeedsOnlineAuthorization`) — and with no way to ask, it was refused
-- for ever, at every till.
--
-- The way to ask is the voucher's (`0044`): the till calls
-- `/store/coupons/{code}/authorize`, this node relays it to head office with its
-- machine credential, head office holds one use of the code's coupon set under
-- the lock that keeps the cap, and the hold's id comes back. The node writes
-- the hold down HERE before the till hears yes, and a quote or a sale may lean
-- on a hold only if it is written here: granted, for that code, not yet used,
-- not released, not expired. A till cannot name a hold this node never
-- relayed, so a cashier's token on the shop's LAN cannot invent a discount.
--
-- No amount column, unlike the voucher: a hold reserves a USE, not money. What
-- the coupon took off is on the sale fact, and head office records it when it
-- commits the hold against the sale.

CREATE TABLE IF NOT EXISTS coupon_hold (
    authorization_id TEXT PRIMARY KEY,
    -- Upper-cased, as head office normalises it.
    code             TEXT NOT NULL,
    checkout_id      TEXT NOT NULL,
    -- As head office stated it. Null only if head office said nothing, in
    -- which case the hold is taken at its word for as long as it is HELD.
    expires_at       TEXT,
    status           TEXT NOT NULL DEFAULT 'HELD'
                     CHECK (status IN ('HELD', 'USED', 'RELEASED')),
    sale_id          TEXT,
    held_at          TEXT NOT NULL,
    closed_at        TEXT
);

CREATE INDEX IF NOT EXISTS ix_coupon_hold_basket
    ON coupon_hold (code, checkout_id);
