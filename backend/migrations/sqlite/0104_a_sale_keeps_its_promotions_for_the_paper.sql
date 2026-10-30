-- 0104: a sale keeps the promotions that came off it, by name and by piece,
-- for the struk the printer makes (Hari, 30 Oct 2026).
--
-- The till drew "Gajian Oktober 30%  -Rp 62.100" under its piece from the
-- quote it held in memory; the node's own paper only knew the total, so the
-- printed struk could not say which promotion took what. One row per
-- promotion and SKU it came off; `sku_code` NULL for one that came off the
-- whole basket (a member promotion, a coupon), printed by name above
-- Total Disc. A sale with no rows here is from before 0104 and prints as it
-- always did.
--
-- `IF NOT EXISTS`: creates only, runs on every open.
CREATE TABLE IF NOT EXISTS sale_promotion_line (
    sale_id       TEXT    NOT NULL,
    promo_seq     INTEGER NOT NULL CHECK (promo_seq >= 0),
    name          TEXT    NOT NULL,
    sku_code      TEXT,
    benefit_minor INTEGER NOT NULL CHECK (benefit_minor >= 0)
);

CREATE INDEX IF NOT EXISTS ix_sale_promotion_line_sale
    ON sale_promotion_line (sale_id, promo_seq);
