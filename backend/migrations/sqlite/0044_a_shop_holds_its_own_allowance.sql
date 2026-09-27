-- 0044: A shop holds its own allowance.
--
-- For a promotion head office has chosen to split (postgres `0387`), this shop
-- is granted an allowance of the budget or the baskets, and enforces it against
-- its OWN sales: what the centre has counted this shop giving away, plus what
-- this till has given away since (`commercial_usage_local`, 0043). It stops at
-- its allowance whether or not it can reach the centre, and because the
-- allowances never add up to more than the limit, the fleet cannot give away
-- more than the limit either.
--
-- Replaced whole by every usage message, like `commercial_usage`: a promotion
-- absent from the latest message is not split any more, and the shop goes back
-- to enforcing the fleet's count. The fleet's count is still enforced beside
-- the allowance while one is held — the tighter of the two wins — so a limit
-- lowered below what was already granted still stops the offer.
--
-- Only RULE and CAMPAIGN. A coupon's limit is a handful of uses of one code,
-- and one that must not be exceeded is a coupon set checked online at the
-- counter, not an allowance split thirty ways.

CREATE TABLE IF NOT EXISTS commercial_usage_allowance (
    kind            TEXT    NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN')),
    key             TEXT    NOT NULL CHECK (trim(key) <> ''),
    -- What this shop may give away in total; NULL where that measure is not
    -- split and the fleet's count alone applies.
    budget_minor    INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
    max_uses        INTEGER CHECK (max_uses IS NULL OR max_uses >= 0),
    -- This shop's own sales under the limit, as the centre had counted them
    -- when it sent this — in the same instant as the rest of the message, so
    -- adding this till's uncounted rows neither misses nor repeats a sale.
    own_uses        INTEGER NOT NULL CHECK (own_uses >= 0),
    own_spent_minor INTEGER NOT NULL CHECK (own_spent_minor >= 0),
    as_of           TEXT    NOT NULL,
    PRIMARY KEY (kind, key)
);
