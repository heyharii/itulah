-- 0147: The Stock Ledger. One row per movement of value, and the layer it took
-- that value from.
--
-- # What this is for
--
-- `movement` in 0001 already records that a piece went from one place to
-- another. It is a physical fact and it carries no money, which is right: a
-- movement should not have to know what anything cost. The Stock Ledger is the
-- economic shadow of those movements — what entered, what left, which layer
-- paid for it, and what the article was worth afterwards.
--
-- Two ledgers rather than one column added to `movement`, because they answer
-- different questions and do not line up one-to-one: a sale of three that draws
-- from two layers is one movement and two Stock Ledger entries, and a price
-- correction is a Stock Ledger entry with no movement at all.
--
-- # Which quantity is running here
--
-- `qty_after` and `stock_value_after_minor` are the ARTICLE'S, for the whole
-- company. Not per pool, and not per site. A per-pool running total is exactly
-- the number that tempts somebody to value a DC-to-store transfer, and valuing
-- an internal transfer is how cost of goods gets posted for goods that never
-- left the company.
--
-- The pools are still recorded, because "where did it go" is a real question.
-- They are custody, not scope.
--
-- # What is deliberately not posted here
--
-- A goods receipt writes a layer and a Stock Ledger entry, and posts NO
-- journal. The debit to `1011201001 Persediaan Barang Dagangan` already has an
-- owner: the supplier's bill, in 0052. A second debit here would put the same
-- money into inventory twice, and both entries would balance.
--
-- A DC-to-store transfer writes a Stock Ledger entry, consumes no basis and
-- posts no cost of goods. It does not yet move value between the two sites'
-- inventory accounts either, and that is a known gap rather than a decision:
-- `101120100100` and `101120100101` are separate leaves in the client's chart,
-- so a sale at a store credits a leaf the goods' cost never reached. The
-- integrity query in `stock_ledger.rs` therefore compares COMPANY totals. The
-- fix is a transfer reclass under `source_kind = 'TRANSFER'`, which 0096
-- already reserved for exactly this and which no rule writes yet.

CREATE TABLE stock_ledger_entry (
    -- The order value moved in. Serial and not a timestamp: two entries in the
    -- same microsecond must still consume in a fixed order, or a rebuild
    -- produces a different allocation from the original run and the two are
    -- indistinguishable from a bug.
    fact_sequence   bigserial UNIQUE NOT NULL,
    entry_id        uuid PRIMARY KEY,

    -- The rows one economic event produced. A sale drawing from two layers is
    -- one group and two rows; this is what `explain` reads back.
    posting_group_id uuid NOT NULL,
    line_number      integer NOT NULL CHECK (line_number > 0),

    -- The FIFO scope. Always present, even when the movement named a SKU:
    -- colours and sizes are interchangeable for costing and the queue is the
    -- article's.
    article_id      uuid NOT NULL REFERENCES article(id),
    -- What actually moved, when the movement knew. A receipt does not: the SKU
    -- is worked out during identification, after the delivery was accepted.
    sku_id          uuid REFERENCES sku(id),
    -- Physical identity, for tracing a sold unit back to its delivery. It has
    -- NEVER chosen the cost layer and must not start: see 0146.
    epc             text,
    -- For goods that are counted rather than tagged.
    lot_reference   text,

    from_pool_id    text REFERENCES operational_pool(id),
    to_pool_id      text REFERENCES operational_pool(id),
    -- Whose books this belongs to. The site of the sale for a sale, the site
    -- holding the goods for a loss. Journal lines take their location from here.
    site_id         text NOT NULL REFERENCES site(id),

    -- Pieces that moved. Zero only for a value-only correction.
    quantity        bigint NOT NULL CHECK (quantity >= 0),
    -- What the company's own holding of this article changed by. Custody moves
    -- are zero, which is the entire point of the table.
    qty_delta       bigint NOT NULL,
    qty_after       bigint NOT NULL CHECK (qty_after >= 0),

    -- Which layer this took from, or put into. Null only on a transfer, which
    -- takes from none.
    cost_layer_id   uuid REFERENCES cost_layer(layer_id),

    -- What a piece cost coming IN. Set on a receipt; null on everything else,
    -- because nothing else brings a price with it.
    incoming_rate_minor  bigint CHECK (incoming_rate_minor IS NULL OR incoming_rate_minor >= 0),
    -- What this movement valued a piece at. Null on a transfer: a transfer
    -- values nothing, and a zero there would read as free goods.
    valuation_rate_minor bigint CHECK (valuation_rate_minor IS NULL OR valuation_rate_minor >= 0),

    -- What the company's stock of this article changed by, in money. Signed.
    -- Summing this column over a layer gives what is left of that layer; summing
    -- it over everything gives the Stock Ledger's value, which is what the
    -- inventory control account is reconciled against.
    stock_value_difference_minor bigint NOT NULL,
    stock_value_after_minor      bigint NOT NULL CHECK (stock_value_after_minor >= 0),

    -- One method, and a CHECK saying so. When a second one exists this is where
    -- it goes, and every historical row already says which method valued it.
    costing_method  text NOT NULL DEFAULT 'FIFO' CHECK (costing_method = 'FIFO'),

    event_kind      text NOT NULL CHECK (event_kind IN (
                        'RECEIPT', 'SALE', 'LOSS', 'WRITE_OFF', 'DISPOSAL',
                        'SUPPLIER_RETURN', 'TRANSFER', 'PRICE_CORRECTION')),
    -- The document behind it, in the caller's own vocabulary: GOODS_RECEIPT and
    -- a receipt id, SALE_DAY and a sales posting id, STOCK_COUNT and a count id.
    source_kind     text NOT NULL CHECK (btrim(source_kind) <> ''),
    source_id       text NOT NULL CHECK (btrim(source_id) <> ''),

    -- The date this belongs to in the books, which is not when it was written.
    economic_date   date NOT NULL,
    -- The journal this produced, when it produced one. Null on a receipt and on
    -- a transfer, for the reasons in the header.
    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
    actor           text NOT NULL CHECK (btrim(actor) <> ''),
    recorded_at     timestamptz NOT NULL DEFAULT now(),

    -- The same event delivered twice consumes once. Keyed on the line as well
    -- as the event, so a second attempt collides on line one rather than
    -- appending a duplicate allocation nobody would see.
    UNIQUE (idempotency_key, line_number),

    -- An entry takes all of what moved, none of it, or gives all of it back.
    CHECK (qty_delta = quantity OR qty_delta = -quantity OR qty_delta = 0),
    -- Only a price correction moves value without moving goods.
    CHECK (quantity > 0 OR event_kind = 'PRICE_CORRECTION'),
    -- Where the two ends are is what says whether the company's own holding
    -- changed. A custody move has both ends inside; anything that changes the
    -- total has exactly one end outside; a value-only correction has neither.
    CHECK (
        (qty_delta = 0 AND quantity > 0 AND from_pool_id IS NOT NULL AND to_pool_id IS NOT NULL)
     OR (qty_delta > 0 AND from_pool_id IS NULL AND to_pool_id IS NOT NULL)
     OR (qty_delta < 0 AND from_pool_id IS NOT NULL AND to_pool_id IS NULL)
     OR (quantity = 0 AND from_pool_id IS NULL AND to_pool_id IS NULL)
    ),
    -- Every entry that carries value names the layer it carried it from. A
    -- transfer carries none and names none: that pairing, enforced here, is what
    -- makes "an internal transfer consumed basis" impossible rather than merely
    -- unintended.
    CHECK ((cost_layer_id IS NULL) = (event_kind = 'TRANSFER')),
    CHECK ((event_kind = 'TRANSFER') = (valuation_rate_minor IS NULL)),
    -- A transfer moves no value. The converse is not asserted: goods that cost
    -- nothing, and a correction on a layer that has entirely sold out, both
    -- legitimately move zero.
    CHECK (event_kind <> 'TRANSFER' OR stock_value_difference_minor = 0),
    CHECK ((incoming_rate_minor IS NOT NULL) = (event_kind = 'RECEIPT'))
);

CREATE INDEX ix_stock_ledger_article ON stock_ledger_entry (article_id, fact_sequence);
CREATE INDEX ix_stock_ledger_layer ON stock_ledger_entry (cost_layer_id)
    WHERE cost_layer_id IS NOT NULL;
CREATE INDEX ix_stock_ledger_group ON stock_ledger_entry (posting_group_id);
CREATE INDEX ix_stock_ledger_source ON stock_ledger_entry (source_kind, source_id);
CREATE INDEX ix_stock_ledger_journal ON stock_ledger_entry (journal_entry_id)
    WHERE journal_entry_id IS NOT NULL;
CREATE INDEX ix_stock_ledger_date ON stock_ledger_entry (economic_date);

COMMENT ON TABLE stock_ledger_entry IS
    'The economic shadow of a stock movement: what entered or left, which cost layer paid for it, and what the article was worth afterwards. Running totals are the article''s across the whole company, never per pool.';
COMMENT ON COLUMN stock_ledger_entry.qty_delta IS
    'The change in the COMPANY''S holding. A DC-to-store transfer is zero: custody moved, nothing entered or left, and no basis was consumed.';
COMMENT ON COLUMN stock_ledger_entry.epc IS
    'Physical identity, for tracing a sold unit back to its delivery. Never selects the cost layer: specific identification is not available for interchangeable goods.';

-- Append-only, for the same reason the journal is. A cost that was corrected in
-- place leaves no trace of having been wrong.
CREATE TRIGGER stock_ledger_entry_append_only
    BEFORE UPDATE OR DELETE ON stock_ledger_entry
    FOR EACH ROW EXECUTE FUNCTION protect_journal();

-- ---------------------------------------------------------------------------
-- What is left of each layer
-- ---------------------------------------------------------------------------
--
-- One view, and everything that needs the answer reads it: the FIFO queue, the
-- valuation, the layer listing, the integrity check. Kept as one definition
-- because the direction rule — which entries take from a layer and which give
-- back to it — is the thing four separate copies would eventually disagree
-- about, and the disagreement would look like a rounding difference.
--
-- Derived, never stored. A residual column IS the authority the moment somebody
-- updates it, and then the entries underneath become decoration.
--
-- Money and quantity come from the same place but not from the same arithmetic.
-- Quantity is what moved; value is `stock_value_difference_minor`, which already
-- carries the layer's own opening cost on its receipt row and the corrections
-- appended since. That is why a partly consumed layer never loses a rupiah to
-- rounding: the value that stays behind stays with the pieces that stay behind.
CREATE VIEW cost_layer_remaining AS
SELECT l.layer_id,
       l.article_id,
       l.site_id,
       l.economic_date,
       l.recorded_at,
       l.quantity                                  AS received_quantity,
       l.unit_cost_minor,
       l.opening_cost_minor,
       -- Cast back to bigint, and not for tidiness. `SUM(bigint)` in Postgres
       -- is `numeric`, so without this the residual columns come out of a view
       -- over bigint columns as a type nothing that reads them expects — and
       -- the reader's complaint is about decoding a column, which points at the
       -- caller rather than at the SUM three joins away that caused it.
       COALESCE(e.qty, 0)::bigint                  AS remaining_quantity,
       COALESCE(e.value, 0)::bigint                AS remaining_value_minor,
       -- What the layer says the goods cost in total, corrections folded in.
       -- Not the same as the remaining value: this one ignores what has already
       -- gone out, and is what a person means by "what did we pay for these".
       (l.opening_cost_minor + COALESCE(adj.total, 0))::bigint AS effective_cost_minor
  FROM cost_layer l
  LEFT JOIN LATERAL (
      SELECT SUM(s.qty_delta)                     AS qty,
             SUM(s.stock_value_difference_minor)  AS value
        FROM stock_ledger_entry s
       WHERE s.cost_layer_id = l.layer_id
  ) e ON TRUE
  LEFT JOIN LATERAL (
      SELECT SUM(a.amount_minor) AS total
        FROM cost_layer_adjustment a
        JOIN cost_component_type t ON t.component_type = a.component_type
       WHERE a.layer_id = l.layer_id AND a.superseded_by IS NULL AND NOT t.is_opening
  ) adj ON TRUE;

COMMENT ON VIEW cost_layer_remaining IS
    'What is left of each cost layer, in pieces and in money, derived from its stock ledger entries. The one definition of residual basis; nothing stores it.';
