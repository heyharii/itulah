-- 0012: A pick event stops calling itself an allotment.
--
-- The name was accurate until picking changed. Fetching a SKU off the racks
-- used to consume allotment lines FIFO, so the event genuinely was an allotment
-- pick. It no longer touches one: which store a garment serves is settled when
-- it goes into a carton, and the allotment is consumed there.
--
-- A table that names something it no longer does is worse than an awkward name.
-- The next person to read it will believe it.

ALTER TABLE dc_allotment_pick_event RENAME TO dc_pick_event;
