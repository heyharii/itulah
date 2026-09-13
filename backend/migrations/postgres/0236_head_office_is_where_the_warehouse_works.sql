-- Head office is where the warehouse's people are posted.
--
-- Owner's ruling, 2026-09-13, in two parts: head office IS the cloud — the
-- organisation, not a building with a loading bay — and `dc` and `dc-01` are
-- one and the same thing, a warehouse that answers to two spellings because
-- the centre calls a site `dc` and the node calls itself `dc-01`.
--
-- 0230 acted on the first half: it moved every posting at the DC to `ho`,
-- because the warehouse is a department inside head office rather than a
-- fifteenth unit. What it deliberately left alone was `site`, since the DC is
-- still a node that receives goods and holds stock. That left `org_place.ho`
-- with no `site_id` at all — true of head office as an office, and wrong the
-- moment anything needs to ask "who works where the goods land".
--
-- # What this is for
--
-- Addressing. A purchase order destined for `dc-01` has to reach the people
-- who will clear a bay for it, and they are posted at `ho`. Before this row,
-- the question "who is posted where site `dc` is" had no answer, and a
-- delivery notice reached the two admins and none of the five supervisors who
-- actually receive deliveries — silently, because an Admin matches every place
-- and so the audience was never empty.
--
-- # Why a row and not a rule in code
--
-- Because it is a fact about this company that could change: a second
-- warehouse, or a DC that becomes its own unit with its own manager, is a row
-- here and not a deployment. `org_place` was built as the bridge between the
-- organisation and its sites (0060), and this is the bridge finally being
-- crossed for the one place that had none.

-- # The constraint said head office is not a site, and that was true
--
-- `org_place_site_matches_kind` required exactly that: kind HO means no site,
-- every other kind means one. It was a faithful record of 0060's world, where
-- head office was an office and the warehouse was a unit. The owner's ruling
-- merges those two, so head office MAY name a site — and every other kind
-- still must, because a store with no site is the mistake that rule was
-- written to catch.

ALTER TABLE org_place DROP CONSTRAINT org_place_site_matches_kind;
ALTER TABLE org_place ADD CONSTRAINT org_place_site_matches_kind
    CHECK (kind = 'HO' OR site_id IS NOT NULL);

UPDATE org_place SET site_id = 'dc' WHERE id = 'ho' AND site_id IS NULL;
