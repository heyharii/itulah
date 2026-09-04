-- 0087: A campaign may hold markdowns, not only rules.
--
-- The vocabulary does not grow here, and that is deliberate. This system has
-- five words — price list, markdown, rule, coupon, campaign — and what a
-- marketplace calls a "flash sale" is not a sixth: it is a set of MARKDOWNS
-- under one campaign. Naming it separately would invite a sixth table, a sixth
-- lifecycle and a sixth thing to keep in step with the price book.
--
-- Every part of it already existed except the thread between them.
-- `commercial_campaign` is the envelope, and it had only ever enveloped
-- promotion RULES (`Rule.campaign_id`). A markdown could name no campaign at
-- all, so a shop holding two thousand cleared SKUs could not be told that four
-- hundred of them are one event with one clock and one switch.
--
-- Two things are added, and they are deliberately on different tables for the
-- reason 0073 gives:
--
--   * `commercial_campaign` is NOT frozen after publication, because its
--     `status` is the lever the business pulls when it says "stop the promo".
--     A headline, a photograph and a terms line belong with that lever — they
--     describe the offer to a shopper rather than deciding money, and a typo in
--     a banner must be fixable without cutting a new price book.
--
--   * `commercial_markdown` IS frozen, and stays frozen. `campaign_id` names
--     which campaign a clearance belongs to, and that IS a decision about money:
--     move a markdown into a campaign after dispatch and the centre would think
--     it is paused while every till went on charging the cleared price.
--     Adding the column is DDL and does not touch the row trigger.
--
-- The engine gate for this is deliberately the OPPOSITE way round from the one
-- on rules, and the asymmetry is the whole safety argument — see
-- `PriceIndex::campaign_allows`. A rule under a campaign a shop does not hold
-- fails closed: no discount, the shopper pays list, nobody is harmed. A
-- markdown that failed closed would charge MORE than the ticket on the garment
-- and more than the poster in the window, at the counter, in front of the
-- customer, at the shop most behind on sync. So an absent campaign leaves the
-- cleared price standing; only a campaign the shop actually holds, and that
-- actually says PAUSED, puts the price back up.

ALTER TABLE commercial_campaign
    -- The banner. A key into catalogue media, the same shape `article.image_url`
    -- carries, so one uploader and one proxy serve both.
    ADD COLUMN image_url text,
    -- What the poster says, when that is not the campaign's internal name.
    -- "Lebaran Sale" is filed as `CMP-LEB-26`; a shopper reads the former.
    ADD COLUMN headline  text,
    -- The small print, as one block of text rather than a modelled thing.
    -- Terms differ per promotion, per season and per regulator, and a schema
    -- that tried to model them would be wrong before it shipped.
    ADD COLUMN terms     text;

ALTER TABLE commercial_markdown ADD COLUMN campaign_id text;

-- No foreign key, on purpose, and for the same reason the shop has none: a
-- campaign is scoped per publication here and keyed by its business id there,
-- so the reference is by NAME across books rather than by row. The engine's
-- gate is what enforces it, and it fails safe when the name resolves to
-- nothing.
CREATE INDEX ix_markdown_campaign ON commercial_markdown (campaign_id)
    WHERE campaign_id IS NOT NULL;

COMMENT ON COLUMN commercial_markdown.campaign_id IS
    'The campaign this price drop belongs to, by business id. Absent means the '
    'markdown stands on its own, which is every markdown written before 0087.';
