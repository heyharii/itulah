-- 0021: Remove the tier here too, for the reason migration 0080 gives at the
-- centre: a tier price could never apply, because no customer carries a tier.
--
-- A shop's copy matters more than the centre's did. This is the node that
-- actually charges people, so a level it could match but never would is a
-- price silently absent from a counter — and the shape of every expensive
-- fault in this domain is exactly that: authored, shipped, and doing nothing.
--
-- A surviving row with a tier in it now reads as a company price rather than
-- being skipped. A shop that cannot sell a shirt is worse than one that sells
-- it at the company's number.
ALTER TABLE commercial_price_rule DROP COLUMN tier;
ALTER TABLE commercial_markdown   DROP COLUMN tier;

