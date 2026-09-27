-- A purchase order may be edited until it is finished, and every edit is kept.
--
-- An order used to be editable only while nothing had happened against it:
-- the first count at the DC froze it. The owner's rule (2026-09-26) is that an
-- order can be edited until it is completed — fully received, closed short or
-- cancelled — "yang penting ada log": what matters is that every change is on
-- record.
--
-- One row per saved edit: who, when, and what changed, as a list of
-- `{kind, item, field, from, to}` entries the order sheet reads back as a
-- history. The lines themselves are still the order's truth; this is the
-- account of how they came to read that way, and it is never rewritten.
CREATE TABLE purchase_order_revision (
    revision_id        uuid PRIMARY KEY,
    purchase_order_id  uuid NOT NULL REFERENCES purchase_order (purchase_order_id) ON DELETE CASCADE,
    revised_by         text NOT NULL,
    revised_at         timestamptz NOT NULL DEFAULT now(),
    changes            jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX ix_purchase_order_revision_order
    ON purchase_order_revision (purchase_order_id, revised_at DESC);
