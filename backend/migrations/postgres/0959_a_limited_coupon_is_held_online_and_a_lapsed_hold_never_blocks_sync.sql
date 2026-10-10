-- A limited coupon is held online, and a hold that cannot be committed never
-- blocks a shop's sync.
--
-- A price book's coupon with a use cap (HEMAT50, 100 uses) is now held at head
-- office before a till may apply it: the book's coupon becomes a SHARED coupon
-- set with its one code (`coupons::ensure_book_coupon_sets_for_publication`,
-- or lazily on the first authorize), the till's node relays the hold, and the
-- sale fact carries the hold's id on the promotion it opened. Applying that
-- fact commits the hold into the sale's redemption.
--
-- When it cannot — the hold was released, committed to another sale, never
-- granted, or the sale was rung after it lapsed — the sale fact is still
-- accepted. Refusing it would stop every later fact from that shop (its
-- takings, its stock, its members' points) until somebody repaired it by hand,
-- over a discount already given on a real receipt. So the problem is written
-- here instead, one row per sale and hold, for somebody to look at.
CREATE TABLE IF NOT EXISTS coupon_hold_exception (
    sale_id          uuid NOT NULL,
    authorization_id text NOT NULL,
    coupon_code      text,
    site_id          text,
    discount_minor   bigint NOT NULL DEFAULT 0,
    problem          text NOT NULL,
    recorded_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sale_id, authorization_id)
);
