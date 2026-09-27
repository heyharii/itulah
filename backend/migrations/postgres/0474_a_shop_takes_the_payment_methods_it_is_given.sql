-- 0474: a shop takes the payment methods it is given.
--
-- Owner, 27 Sep 2026: payment methods are set up per shop, and Finance adds
-- and removes them. Before this a payment method was on for every shop or for
-- none, and the tills carried their own hard-coded list of tenders.
--
--   * `payment_method_site` is each shop's list. A shop's tills show exactly
--     these, and its node refuses a tender outside them.
--   * The list reaches the shop as the command `payment.methods.replace`,
--     whole, published once a minute to a node whose list changed
--     (`payment_method_publication` remembers what each node was last sent).
--   * EWALLET becomes a tender on the wire, so an e-wallet such as OVO is a
--     payment method like any other: owed by its provider (the method's
--     bank_code) until it settles.
--
-- Seeded with every active method at every site, so no till loses a tender
-- when this lands.

CREATE TABLE payment_method_site (
    method_code text NOT NULL REFERENCES payment_method (code),
    site_id     text NOT NULL REFERENCES site (id),
    set_by      text NOT NULL DEFAULT 'system',
    set_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (method_code, site_id)
);

CREATE INDEX ix_payment_method_site_site ON payment_method_site (site_id);

INSERT INTO payment_method_site (method_code, site_id, set_by)
SELECT p.code, s.id, 'migration:0474'
  FROM payment_method p CROSS JOIN site s
 WHERE p.is_active;

COMMENT ON TABLE payment_method_site IS
    'Which payment methods each shop accepts (0474). Its tills show exactly these; its node refuses any other tender.';

CREATE TABLE payment_method_publication (
    origin_id    text PRIMARY KEY,
    content_hash text NOT NULL,
    command_id   uuid,
    published_at timestamptz NOT NULL DEFAULT now()
);

-- The cloud's record of a tender learns the fifth kind of money.
DO $$
DECLARE
    name text;
BEGIN
    FOR name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'edge_sale_tender'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%QRIS%'
    LOOP
        EXECUTE format('ALTER TABLE edge_sale_tender DROP CONSTRAINT %I', name);
    END LOOP;
END
$$;

ALTER TABLE edge_sale_tender
    ADD CONSTRAINT edge_sale_tender_method_check
        CHECK (method IN ('CASH', 'CARD', 'QRIS', 'VOUCHER', 'EWALLET', 'OTHER'));

-- An edge that does not know `payment.methods.replace` stops its whole command
-- stream on it. So the cloud publishes only once Finance turns this on, after
-- every shop node runs a build that understands the command.
INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by)
VALUES ('sync.publish_payment_methods', 0, 'flag',
        '1 sends each shop node its payment methods; turn on only after every node runs a build that knows payment.methods.replace (0474).',
        'migration:0474')
ON CONFLICT (setting_key) DO NOTHING;
