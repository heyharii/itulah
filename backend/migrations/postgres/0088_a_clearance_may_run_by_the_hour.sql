-- 0088: A clearance may run on chosen days, between chosen hours.
--
-- A rule has been able to do this since it was written — `Conditions` carries
-- `days` and `time_window`, which is how "Promo Sabtu" and "diskon jam makan
-- siang" are expressed. A markdown could not. It had an absolute start and an
-- absolute end and nothing in between, so a flash sale running noon to two for
-- five days was five markdown rows per product, cut by hand, and the sixth day
-- was a row somebody forgot.
--
-- The two columns are the same two facts a rule already carries, read the same
-- way: in the SHOP's local time. "Twelve to two" means noon where the shop is,
-- and a business at UTC+7 that read them in UTC would run the sale from seven
-- in the evening to nine — right for nobody, every day, with nothing on any
-- screen saying so. The pricing engine is handed the offset rather than
-- assuming one.
--
-- A NOTE THAT IS NOT ABOUT THE SCHEMA, and belongs here because this is where
-- somebody will look for it: a scheduled markdown makes THE PRICE change at
-- two in the afternoon. A promotion that does this is invisible until the
-- counter; a markdown is printed on the ticket stapled to the garment. A shop
-- running one has a label that is wrong for twenty-two hours of the day. That
-- is a merchandising decision and the system will not make it for anybody —
-- but the till's own screens follow it to the minute, so at least the shop and
-- the counter agree.

ALTER TABLE commercial_markdown
    -- ISO weekdays: Monday is 1, Sunday is 7 — the numbering people already
    -- write down, rather than a zero-based one that reads correctly only to
    -- whoever wrote the code. Empty means every day, and that is the default
    -- every markdown written before today already means.
    ADD COLUMN iso_weekdays smallint[] NOT NULL DEFAULT '{}',
    -- Minutes since local midnight. `from` greater than `to` wraps past
    -- midnight, which a late-night sale genuinely wants and is not an error.
    ADD COLUMN from_minute integer,
    ADD COLUMN to_minute   integer,
    -- `ADD CONSTRAINT`, not a bare `CONSTRAINT`: inside an ALTER TABLE every
    -- clause is its own action, and the table-definition spelling parses
    -- nowhere. It cost a round of red Postgres tests to notice, which is the
    -- argument for having them.
    ADD CONSTRAINT markdown_hours_come_in_pairs
        CHECK ((from_minute IS NULL) = (to_minute IS NULL)),
    ADD CONSTRAINT markdown_hours_are_within_a_day
        CHECK (from_minute IS NULL
               OR (from_minute BETWEEN 0 AND 1439 AND to_minute BETWEEN 0 AND 1439)),
    ADD CONSTRAINT markdown_weekdays_are_iso
        CHECK (iso_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]);
