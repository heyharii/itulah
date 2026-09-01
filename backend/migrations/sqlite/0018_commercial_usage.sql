-- 0018: What promotions have already given away, as the centre last knew it.
--
-- The mirror of the centre's `commercial_usage`, and it is deliberately NOT
-- part of `commercial_publication`. A publication states a limit — a decision,
-- frozen with the price book, delivered on the rhythm of a season. A count is
-- an observation that changes with every sale, and putting one inside the other
-- is why no count was ever kept: there was nowhere to write, and no lane fast
-- enough to carry it if there had been.
--
-- What a shop holds here is always behind. It cannot be otherwise: no till can
-- know what the other shops sold this morning, and one that refused to sell
-- until it did would be useless. So a budget is a brake — it stops a promotion
-- some time after the money ran out, not at the rupiah. Anything that must not
-- be exceeded has to be checked where the counting happens, which is the
-- centre.

CREATE TABLE IF NOT EXISTS commercial_usage (
    kind        TEXT NOT NULL CHECK (kind IN ('RULE', 'CAMPAIGN', 'COUPON')),
    key         TEXT NOT NULL CHECK (trim(key) <> ''),
    uses        INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    spent_minor INTEGER NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    -- When the centre last counted. Shown so an operator can see how stale the
    -- brake is rather than assuming it is current.
    as_of       TEXT NOT NULL,
    PRIMARY KEY (kind, key)
);
