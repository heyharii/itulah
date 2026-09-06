-- 0108: A tender can be moved to the acquirer that actually took it.
--
-- # Why this is not an edit
--
-- Cashiers pick the wrong button. A sale settled on the BCA terminal gets
-- recorded as MANDIRI, or a debit swipe is rung as credit, and nobody notices
-- until the acquirer's settlement arrives and one receivable is short by
-- exactly what another is long by. The fix is real and routine, and it has
-- two completely different shapes depending on one thing: whether the day has
-- been posted.
--
--   * Before posting, nothing in the books says anything about that tender.
--     The tender row is corrected and the day is regenerated. There is
--     nothing to reverse because nothing was recorded.
--
--   * After posting, the books already carry `Piutang Debit MANDIRI`. Editing
--     the tender would leave the ledger saying one thing and the sale saying
--     another, and the ledger is append-only precisely so that cannot happen.
--     So the tender is corrected AND a reclassifying entry is written:
--     debit the receivable that should have had it, credit the one that did.
--
-- Both shapes leave a row here. That is the point of the table: a receivable
-- that moved between acquirers is exactly the kind of change somebody asks
-- about six weeks later, and "the row says MANDIRI now and the journal says
-- BCA" is not an answer anybody can act on.
--
-- # Why the tender is named by id and by source
--
-- There are two populations of tender — what a shop synced up
-- (`edge_sale_tender`) and what was rung up here (`sale_payment`) — and both
-- are real trade. A foreign key would have to point at one of them, so this
-- carries the id and says which table it came from instead. The alternative,
-- two nullable foreign keys and a CHECK that exactly one is set, is the same
-- fact spelled with more room to be inconsistent.

CREATE TABLE sale_tender_retender (
    retender_id   uuid PRIMARY KEY,

    -- `edge_sale_tender.tender_id` or `sale_payment.id`, depending.
    tender_id     uuid NOT NULL,
    tender_source text NOT NULL CHECK (tender_source IN ('EDGE', 'CENTRAL')),

    -- Copied rather than joined. The day this belongs to is what decides
    -- whether a journal was needed, and it must not move if a sale's
    -- timestamp is ever corrected.
    site_id       text NOT NULL REFERENCES site(id),
    business_date date NOT NULL,

    from_method    text NOT NULL,
    from_acquirer  text NOT NULL DEFAULT '',
    from_card_kind text,
    to_method      text NOT NULL,
    to_acquirer    text NOT NULL DEFAULT '',
    to_card_kind   text,

    amount_minor  bigint NOT NULL CHECK (amount_minor > 0),

    -- Required, and required to say something. A reclassification with no
    -- reason is a reclassification nobody can defend at an audit, and this is
    -- the only place the reason will ever live.
    reason        text NOT NULL CHECK (btrim(reason) <> ''),

    -- Set when the day had already been posted, so this correction had to be
    -- carried into the books as well as into the row. Null means the day was
    -- still a draft and regeneration was enough.
    journal_entry_id uuid REFERENCES journal_entry(entry_id),

    actor         text NOT NULL CHECK (btrim(actor) <> ''),
    at            timestamptz NOT NULL DEFAULT now(),

    -- Moving a tender to where it already was is not a correction, it is
    -- noise in the one place somebody goes looking for corrections.
    CONSTRAINT sale_tender_retender_actually_moves CHECK (
        from_method IS DISTINCT FROM to_method
        OR from_acquirer IS DISTINCT FROM to_acquirer
        OR from_card_kind IS DISTINCT FROM to_card_kind
    )
);

CREATE INDEX ix_retender_tender ON sale_tender_retender (tender_id);
CREATE INDEX ix_retender_day ON sale_tender_retender (site_id, business_date DESC);

COMMENT ON TABLE sale_tender_retender IS
    'Every time a settled tender was moved to another method or acquirer, who '
    'moved it, why, and the reclassifying entry when the day was already '
    'posted.';
