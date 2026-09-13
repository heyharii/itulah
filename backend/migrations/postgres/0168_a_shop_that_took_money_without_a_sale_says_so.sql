-- 0168: A shop that took money without a sale says so.
--
-- The one failure a shop cannot fix by itself, and the one the centre would
-- otherwise never hear about.
--
-- A card settles, the sale is never written — the process died between the
-- terminal's answer and the commit, or a second tender declined and the first
-- could not be reversed at the counter. The shopper has been charged. The shop
-- has money in its takings with nothing behind it, which means **the shop's own
-- Z report balances**: the cash is there, the card batch is there, and nothing
-- looks wrong locally. The only party who can see a problem is the customer,
-- and they find out on their statement.
--
-- So the till escalates it. `checkout` and `checkout_tender` live at the shop
-- (sqlite 0033) because a stuck checkout has to be worked at the counter with
-- the customer still there, on a node that may have no network. This table is
-- what arrives here afterwards: not every unresolved checkout, but the ones a
-- person already looked at and closed as FAILED while money had settled.
--
-- Deliberately not "every checkout". A checkout in FINALIZING is a till
-- mid-payment, which is the ordinary state of every till several times a
-- minute; syncing those would bury the real ones and cost a row per sale.

CREATE TABLE IF NOT EXISTS edge_checkout_exception (
    -- The shop's own checkout id, which is also the sync event id. One row per
    -- escalation, so a fact delivered twice overwrites rather than reports the
    -- same lost payment again.
    checkout_id UUID PRIMARY KEY,
    origin_id TEXT NOT NULL,
    site_id TEXT,
    -- Who closed it at the counter, which is who to ask what happened.
    actor_id TEXT NOT NULL,
    -- What the shopper was told they owed.
    total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
    -- What actually settled and is now in the shop's takings with nothing
    -- against it. This is the number a refund is measured from, and it is
    -- strictly positive: a checkout that took nothing is not an exception, it
    -- is an abandoned basket.
    money_held_minor BIGINT NOT NULL CHECK (money_held_minor > 0),
    opened_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    -- How head office answered for it: still open, refunded, or written off
    -- after the acquirer confirmed nothing settled after all. An exception with
    -- no outcome column is a list nobody can finish working.
    resolution TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (resolution IN ('OPEN', 'REFUNDED', 'RECOVERED_AS_SALE', 'WRITTEN_OFF')),
    resolution_note TEXT,
    resolved_by TEXT,
    resolution_at TIMESTAMPTZ,

    CHECK (
        (resolution = 'OPEN' AND resolution_at IS NULL AND resolved_by IS NULL)
     OR (resolution <> 'OPEN' AND resolution_at IS NOT NULL AND resolved_by IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS edge_checkout_exception_tender (
    checkout_id UUID NOT NULL REFERENCES edge_checkout_exception(checkout_id) ON DELETE CASCADE,
    -- Position, matching the shop's own `checkout_tender.tender_seq`, so the
    -- two nodes name the same tender without a second identifier.
    tender_seq BIGINT NOT NULL,
    method TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    -- The same five words `sale_return_payment.status` uses (0164).
    status TEXT NOT NULL CHECK (status IN
        ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    -- The acquirer's own reference. Without it head office has an amount, a
    -- shop and a date, which is not enough to find one transaction in a day's
    -- batch — and finding it is the entire job.
    external_reference TEXT,
    last_error TEXT,

    PRIMARY KEY (checkout_id, tender_seq)
);

-- The working list: what is still owed, oldest first. Partial, because the
-- answer should almost always be empty and the ones that matter are the ones
-- nobody has closed.
CREATE INDEX IF NOT EXISTS ix_edge_checkout_exception_open
    ON edge_checkout_exception (resolved_at)
    WHERE resolution = 'OPEN';

-- And per shop, because "which of my thirteen branches keeps doing this" is the
-- question that turns a list of incidents into a fix.
CREATE INDEX IF NOT EXISTS ix_edge_checkout_exception_site
    ON edge_checkout_exception (site_id, resolved_at DESC);
