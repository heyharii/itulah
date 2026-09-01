-- 0019: What a product IS, at the shop that sells it.
--
-- A markdown or a promotion can name a whole style, a division, or a tag —
-- "twenty per cent off everything in menswear", "clear the whole Lebaran
-- range". The pricing engine matches those against fields on the cart line,
-- and it is told them rather than deriving them: an engine that knew how a SKU
-- code is built would break the day that format changed.
--
-- Nothing told it. The catalogue this shop holds knew a product's code, its
-- name and its tax class, and nothing about what it belongs to — so every cart
-- line was built with the style, the division and the tags empty, and an
-- article-wide clearance matched nothing at any till in the fleet. It was
-- authored, validated, published, delivered, and silently did nothing.
--
-- These are the three facts, delivered with the catalogue that already carries
-- the name. They belong on the catalogue and not on the price book: a garment's
-- style does not change when its price does, and a season of repricing should
-- not have to restate what every garment is.

ALTER TABLE catalog_item ADD COLUMN article_code TEXT;
ALTER TABLE catalog_item ADD COLUMN division_code TEXT;

-- A JSON array of tag codes.
--
-- A child table would be the ordinary answer and is the wrong one here: this
-- table is replaced wholesale on every catalogue snapshot, in one transaction,
-- and a second table would have to be swapped in step with it or the two would
-- disagree about which generation they belong to. Nothing queries inside this
-- value — it is read once per product and handed straight to the engine.
ALTER TABLE catalog_item ADD COLUMN tags_json TEXT;

-- Finding everything in a division is the one lookup that is not by SKU code.
CREATE INDEX IF NOT EXISTS ix_catalog_item_article ON catalog_item(article_code)
    WHERE article_code IS NOT NULL;
