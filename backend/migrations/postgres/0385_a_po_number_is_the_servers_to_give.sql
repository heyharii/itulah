-- A purchase order's number is given by the server, not guessed by a screen.
--
-- The composer used to read the order book, take the highest serial it could
-- see, add one and send that as `po_number`. Two buyers who opened New PO in
-- the same minute were shown the same number, and the second one to press
-- Create was refused by the UNIQUE on `purchase_order.po_number`. The serial
-- also never restarted with the day, and was read off one page of the book.
--
-- One row per day (Jakarta). `create_catalog_purchase_order` bumps it with an
-- upsert inside the order's own transaction, so concurrent orders queue on the
-- row and leave with consecutive serials, and a rolled-back order returns its
-- serial. A request that brings its own number (an import) does not touch it.
CREATE TABLE purchase_order_number_day (
    day          date PRIMARY KEY,
    last_serial  integer NOT NULL CHECK (last_serial > 0)
);
