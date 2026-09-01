-- 0038: What a supplier's product IS, not just what it is called.
--
-- A sourcing screen exists to answer "what can we buy" — and nobody browses a
-- catalogue by supplier code. They browse by kind: shirts, trousers, menswear.
-- Without those, the only filters a sourcing screen can offer are the supplier
-- and the status, which is a list you can only walk, not search.
--
-- Both borrow the vocabulary that already exists rather than inventing a second
-- one. A supplier's shirt and our own shirt must be the same word, or the two
-- catalogues cannot be compared at all — and comparing them is the entire
-- point of sourcing.
--
-- Nullable, because a classification is a judgement somebody makes and a
-- supplier's feed may arrive without one. Unclassified is a real state, not a
-- fault, and it is better shown than guessed.

ALTER TABLE supplier_item
    ADD COLUMN division_code text REFERENCES division(code);

CREATE INDEX ix_supplier_item_division
    ON supplier_item (division_code) WHERE division_code IS NOT NULL;

CREATE TABLE supplier_item_tag (
    supplier_item_id uuid NOT NULL REFERENCES supplier_item(supplier_item_id) ON DELETE CASCADE,
    tag_code         text NOT NULL REFERENCES tag(code),
    PRIMARY KEY (supplier_item_id, tag_code)
);

CREATE INDEX ix_supplier_item_tag_tag ON supplier_item_tag (tag_code);

COMMENT ON COLUMN supplier_item.division_code IS
    'Which part of the range this belongs to, in the same vocabulary our own '
    'articles use. NULL means nobody has classified it yet — a real state, not '
    'a fault.';
