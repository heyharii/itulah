-- 0086: Remove the counters frozen into a price book.
--
-- `commercial_coupon.used`, `commercial_campaign.used` and
-- `commercial_campaign.spent_minor` recorded what a promotion had given away —
-- inside the publication that declared its LIMIT. A publication is immutable,
-- so those numbers were true at the moment the book was written and never
-- again. The live count lives in `commercial_usage`, outside the publication,
-- for exactly that reason: a limit is a decision and a count is an observation.
--
-- Both were read. Each snapshot loader took the count from `commercial_usage`
-- when it had a row and fell back to these columns when it did not — one fact
-- with two sources, which is the shape of every serious fault this area has
-- produced. They agreed only because the authoring path always wrote nought,
-- so the column was never an answer, only a coincidence that matched one.
--
-- The fallback is now nought, which is not a default but the fact itself: no
-- row in `commercial_usage` means nothing has been redeemed or spent.
--
-- `write_authority.rs` has said `commercial_coupon.used` was dead since it was
-- written. This is that note carried out.
ALTER TABLE commercial_coupon   DROP COLUMN IF EXISTS used;
ALTER TABLE commercial_campaign DROP COLUMN IF EXISTS used;
ALTER TABLE commercial_campaign DROP COLUMN IF EXISTS spent_minor;

-- And the per-customer limit, which was never a limit.
--
-- `Caps::allows` compared it against `PricingContext::customer_rule_uses`, and
-- no caller has ever filled that map — so the engine read nought on every
-- basket and the cap could not bite. It was authorable, validated, stored,
-- dispatched to thirty shops and honoured by no till: the same shape as the
-- tier, the margin rule and the cumulative condition removed alongside it.
--
-- `commercial_usage_customer` stays. It is written from accepted sale facts and
-- read for the customer count on the usage screen, which is an observation
-- somebody looks at rather than a limit nothing enforced.
ALTER TABLE commercial_campaign DROP COLUMN IF EXISTS max_uses_per_customer;
