-- 1006: some goods never come back, and a paper voucher is spent once.
--
-- The till's POS decisions of 28–29 Oct 2026 (Hari, pos-classic-prototype,
-- pos-thermal-prototype "pakaian dalam … tidak bisa ditukar"):
--
-- `return_policy.exchangeable` — a policy may say its goods are not taken
-- back at all. An ARTICLE policy is the per-article flag; a DIVISION or TAG
-- policy covers a whole category (underwear). It rides the same snapshot to
-- every store (`ReturnPolicyRule.exchangeable`), the till reads it on each
-- catalogue item, and the store server refuses such a piece on a return. The
-- window (`max_days`) stays required so the row keeps one shape; it is not
-- read while `exchangeable` is false.
--
-- `voucher.single_use` — a paper voucher is spent once and gives no change:
-- whatever a basket did not take off it is forfeited in the same transaction
-- as the redemption (movement kind FORFEIT), and the voucher is SPENT. True by
-- default, because the vouchers this business hands out are paper; a gift
-- card that keeps its rest is issued with `single_use: false`.
--
-- The consistency trigger compared every movement with the header. Two
-- movements in one transaction — the REDEEM and the FORFEIT after it — would
-- then fail on the first, whose balance is no longer the newest. The rule it
-- states in its own words is "a header that does not match its NEWEST
-- movement", so it now checks exactly that.

ALTER TABLE return_policy
    ADD COLUMN exchangeable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN return_policy.exchangeable IS
    'False: the goods this policy covers are never taken back at a till (e.g. underwear).';

ALTER TABLE voucher
    ADD COLUMN single_use boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN voucher.single_use IS
    'A paper voucher: one redemption, no change; the rest is forfeited (FORFEIT movement).';

ALTER TABLE voucher_movement DROP CONSTRAINT voucher_movement_kind_check;
ALTER TABLE voucher_movement
    ADD CONSTRAINT voucher_movement_kind_check
    CHECK (kind IN ('ISSUE','REDEEM','VOID','FORFEIT'));

ALTER TABLE voucher_movement DROP CONSTRAINT voucher_movement_sign_matches_kind;
ALTER TABLE voucher_movement
    ADD CONSTRAINT voucher_movement_sign_matches_kind CHECK (
        (kind = 'ISSUE' AND amount_minor > 0) OR
        (kind IN ('REDEEM','VOID','FORFEIT') AND amount_minor < 0)
    );

CREATE OR REPLACE FUNCTION voucher_movement_is_consistent() RETURNS trigger AS $$
DECLARE
    previous bigint;
    header   bigint;
BEGIN
    SELECT balance_after_minor INTO previous
      FROM voucher_movement
     WHERE voucher_id = NEW.voucher_id AND seq < NEW.seq
     ORDER BY seq DESC
     LIMIT 1;

    previous := COALESCE(previous, 0);

    IF previous + NEW.amount_minor <> NEW.balance_after_minor THEN
        RAISE EXCEPTION
            'voucher movement does not add up: % + % is not %',
            previous, NEW.amount_minor, NEW.balance_after_minor;
    END IF;

    -- Only the newest movement speaks for the header: a REDEEM followed by
    -- its FORFEIT in the same transaction leaves the header at the second.
    IF NOT EXISTS (
        SELECT 1 FROM voucher_movement
         WHERE voucher_id = NEW.voucher_id AND seq > NEW.seq
    ) THEN
        SELECT balance_minor INTO header FROM voucher WHERE voucher_id = NEW.voucher_id;
        IF header <> NEW.balance_after_minor THEN
            RAISE EXCEPTION
                'voucher balance is % but its newest movement leaves %',
                header, NEW.balance_after_minor;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
