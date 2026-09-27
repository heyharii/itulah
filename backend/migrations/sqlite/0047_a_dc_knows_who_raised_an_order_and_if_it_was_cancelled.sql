-- A DC knows who raised a purchase order, and whether it was cancelled.
--
-- Who raised it: the owner's rule of 2026-09-26 is that the counts against an
-- order are verified by the person who raised it — they see the count, and
-- accept it, send it back, or close the rest short. The centre sends its
-- username with the order; NULL on orders activated before this, which any
-- second person may still verify.
--
-- Cancelled: head office may cancel an order nothing has arrived against. The
-- DC keeps its copy but takes it off the bay's worklist and refuses any new
-- count against it.
--
-- Applied only when `cancelled_at` is absent; see `edge::sqlite`.
ALTER TABLE purchase_order ADD COLUMN cancelled_at TEXT;
ALTER TABLE purchase_order ADD COLUMN created_by TEXT;
