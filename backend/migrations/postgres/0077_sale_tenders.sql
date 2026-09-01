-- 0077: How a shop's sale was settled, and not only how much it took.
--
-- `edge_sale` carried `paid_minor` and `change_minor` — how much money, never
-- what form it took. That was honest while the till took cash and nothing else.
-- It stops being honest the moment a card is accepted, and it stops being
-- harmless earlier than that: a bank reconciliation matches statements against
-- transactions, and a takings figure with no tender behind it cannot be matched
-- to anything.
--
-- The shape is taken from both reference implementations, which arrived at the
-- same key independently: a tender has no natural id, so its POSITION in the
-- list the till captured is its identity. A fact delivered twice then
-- overwrites the same row instead of recording one payment twice — which
-- matters here because delivery is at-least-once by design.
--
-- Two things this does that neither reference does:
--
--   * `method` is constrained. Both leave it free text and pay for it in
--     reports that group 'card', 'CARD' and 'Card' as three tenders.
--   * the tenders are checked to add up to what the sale says was paid, at
--     ingest, where this system already re-checks a sale's arithmetic. Both
--     references store the list beside the paid figure and trust whatever wrote
--     them; the two then disagree silently, and it surfaces as money with no
--     transaction behind it — the hardest number in retail to chase.

CREATE TABLE edge_sale_tender (
    sale_id      uuid NOT NULL REFERENCES edge_sale(sale_id) ON DELETE CASCADE,
    tender_seq   integer NOT NULL CHECK (tender_seq >= 0),
    method       text NOT NULL CHECK (method IN ('CASH','CARD','QRIS','OTHER')),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    -- An acquirer, an issuing bank, an approval code — whatever the person
    -- reconciling this needs. Never an account number and never an instrument:
    -- the domain refuses a reference carrying twelve or more digits on the way
    -- in, because a card number that reaches a database is a card number that
    -- has to be erased from every backup of it.
    reference    text,
    PRIMARY KEY (sale_id, tender_seq)
);

-- "What did we take on cards last week" — the question this table exists for,
-- and the one a treasury asks every Monday.
CREATE INDEX ix_sale_tender_method ON edge_sale_tender (method);

COMMENT ON TABLE edge_sale_tender IS
    'How a shop''s sale was settled. Keyed by position because a tender has no '
    'natural id, so an at-least-once delivery overwrites rather than doubles.';

-- The same backfill, for the same reason: every sale the centre has already
-- projected was settled in cash, because that is all a till could take. A
-- report over last quarter must not read as if none of it was paid for.
INSERT INTO edge_sale_tender (sale_id, tender_seq, method, amount_minor, reference)
SELECT sale_id, 0, 'CASH', paid_minor, NULL
  FROM edge_sale
 WHERE paid_minor > 0
ON CONFLICT (sale_id, tender_seq) DO NOTHING;

-- A fleet-wide window, which is how both takings reports read this: "what did
-- the whole estate take between these two instants". The existing index leads
-- on site_id, so a query that names no site cannot use it and falls to a scan
-- of every sale ever recorded. That is survivable at thirty shops for one year
-- and stops being survivable at either larger number.
CREATE INDEX ix_edge_sale_time ON edge_sale (occurred_at);
