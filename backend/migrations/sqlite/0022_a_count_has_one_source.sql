-- 0022: Remove the counters frozen into a price book.
--
-- What a promotion has given away is counted in `commercial_usage` and arrives
-- on its own lane, because it changes with every sale while the book that
-- declared its LIMIT is immutable. Held here as well, it was one fact with two
-- sources — and the snapshot loader overwrote one with the other every time it
-- ran, so these columns had never decided anything.
--
-- The fallback is now nought, which is not a default but the fact itself: no
-- row in `commercial_usage` means nothing has been redeemed or spent.
--
-- Its own file rather than appended to 0021, because each of these is applied
-- behind a guard that asks whether its column is still there. Two drops behind
-- one guard cannot tell a database that has had half of them from one that has
-- had none.
ALTER TABLE commercial_coupon   DROP COLUMN used;
ALTER TABLE commercial_campaign DROP COLUMN used;
ALTER TABLE commercial_campaign DROP COLUMN spent_minor;

-- And the per-customer limit, for the reason 0086 gives at the centre: nothing
-- has ever filled the map it was compared against, so it read nought on every
-- basket and never refused anything.
ALTER TABLE commercial_campaign DROP COLUMN max_uses_per_customer;
