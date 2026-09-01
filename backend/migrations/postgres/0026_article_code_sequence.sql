-- Where an article code comes from.
--
-- An article code is EIGHT DIGITS, and those digits are ours. A supplier
-- names their product however they like; that name belongs on the order as
-- `supplier_wording`, so the warehouse can match a carton to a line. It is
-- not an identity, because two suppliers will happily use the same one and a
-- supplier will happily change theirs between shipments.
--
-- The code is minted here instead, from a single sequence, because a SKU is
-- this code plus a colour digit plus a size code — so an article code that
-- did not come from us is an article that can never have a SKU, and therefore
-- can never be tagged, priced or sold.
--
-- # Gaps are fine
--
-- A sequence does not roll back: a transaction that draws 42 and then fails
-- leaves 42 unused forever. That is correct here. An article code is a name,
-- not a document number — nobody audits article codes for completeness, and
-- the alternative (a counter under a lock) would serialise every new article
-- in the company behind one row to buy a property nobody needs.
--
-- Compare `epc_serial_counter`, which IS under a lock: there, two readers
-- getting the same number puts one identity on two garments.

CREATE SEQUENCE article_code_seq
    AS bigint
    START WITH 1
    MINVALUE 1
    -- Eight digits, and no rollover. Running out is a real event that should
    -- stop the line loudly rather than quietly reissuing 00000001 to a second
    -- product.
    MAXVALUE 99999999
    NO CYCLE;

COMMENT ON SEQUENCE article_code_seq IS
    'Mints the 8-digit article codes that SKUs are built from. Gaps are expected and harmless; reuse is not possible.';
