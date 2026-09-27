-- 0054: A delivery knows the pool it lands in.
--
-- Until the owner's routes of 2026-09-27 every announced delivery went to a
-- shop and landed in its stockroom, so there was nothing to say. A shop's
-- return now goes to the Gudang and lands in THAT store's own return pool
-- there, to be inspected (postgres `0610`). Head office names the pool on the
-- announcement (`destination_pool_id`, in this node's own spelling) and the
-- delivery keeps it until the receipt books against it.
--
-- NULL on every delivery announced before this and on every delivery to a
-- shop: the stockroom, as it always was.
--
-- An ALTER: applied once, probed by the column it adds.

ALTER TABLE store_inbound_delivery ADD COLUMN destination_pool_id TEXT;
