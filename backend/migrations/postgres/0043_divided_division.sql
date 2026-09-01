-- 0043: A division for the young-fashion range.
--
-- 0022 seeded five divisions along two axes at once: who a garment is for
-- (Menswear, Womenswear, Kids) and what it is (Footwear, Accessories). A
-- supplier feed that carries a young-fashion line fits neither: it is sold to
-- everyone, so it is not Menswear or Womenswear, and it is clothing, so it is
-- not Footwear or Accessories.
--
-- Until now those items were left unclassified, which 0038 permits — but 484
-- of 2806 items in the first real supplier feed landed there, and a facet that
-- a fifth of the catalogue falls out of is a facet buyers stop trusting.
--
-- Named for the range rather than the shopper on purpose. It sits last in the
-- display order because it is a newer, narrower slice than the four that
-- describe the bulk of the estate.

INSERT INTO division (code, label, display_order) VALUES
    ('DIVIDED', 'Divided', 60)
ON CONFLICT (code) DO NOTHING;
