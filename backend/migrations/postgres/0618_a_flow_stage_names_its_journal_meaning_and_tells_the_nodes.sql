-- A flow stage names its journal meaning, and tells the nodes what it did.
--
-- A stage's writes are one transaction: the action, the stage's state, the
-- journal meaning it produced, and the outbox row that carries its movement
-- to the node that owns the site's ledger. These are the last two.
--
-- # flow_posting: a meaning, never an account
--
-- FINANCE-HARD-RULES I9: a rule names a meaning; the account map decides the
-- account. So a flow writes WHAT happened — inter-unit goods dispatched,
-- inter-unit goods received, goods handed back to a supplier — with the
-- units and the quantities, and Finance's poster values it at provenance cost
-- and resolves the accounts through `account_link` (0460). There is no
-- account column here, and no template can put one anywhere.
--
-- # Crossing units posts inter-unit automatically
--
-- A document that crosses units (`flow_document.crosses_units`, generated
-- from the two ends' units — 0616) cannot have its depart or its receive
-- done without the inter-unit meaning beside it, and a supplier return
-- cannot be handed over without its own. Checked at commit by a deferred
-- trigger, so the stage and its posting are written in either order within
-- the one transaction, and a transaction that wrote one without the other
-- does not commit.
--
-- # flow_event: the outbox
--
-- Every effect a stage produced, in order, for whoever relays it. A stage
-- executed on a node (pick, pack, depart, receive…) has already written its
-- movement in that node's own transaction; its event here is the flow's
-- record of it. A stage executed in the hub (an approval, a handover's proof)
-- carries its movement to the owning node from here. `relayed_at` is set by
-- the relay once the event has gone where it goes.

CREATE TABLE flow_posting (
    id               uuid PRIMARY KEY,
    document_id      uuid NOT NULL REFERENCES flow_document (id),
    stage_index      integer NOT NULL,
    meaning          text NOT NULL CHECK (meaning IN (
        'INTERUNIT_GOODS_DISPATCHED', 'INTERUNIT_GOODS_RECEIVED', 'SUPPLIER_RETURN_HANDED_OVER'
    )),
    -- Whose books: the unit the goods left, the unit that took them.
    from_unit_id     text REFERENCES unit (id),
    to_unit_id       text REFERENCES unit (id),
    -- [{sku_id, quantity}]: quantities only. Value is Finance's, at provenance
    -- cost, when it posts.
    lines            jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
    status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'POSTED')),
    journal_entry_id uuid,
    posted_at        timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (document_id, stage_index) REFERENCES flow_stage_state (document_id, stage_index),
    UNIQUE (document_id, stage_index, meaning),
    CONSTRAINT flow_posting_interunit_crosses CHECK (
        meaning NOT LIKE 'INTERUNIT_%'
        OR (from_unit_id IS NOT NULL AND to_unit_id IS NOT NULL AND from_unit_id <> to_unit_id)
    ),
    CONSTRAINT flow_posting_supplier_return_is_head_office_s CHECK (
        meaning <> 'SUPPLIER_RETURN_HANDED_OVER' OR (from_unit_id IS NOT NULL AND to_unit_id IS NULL)
    ),
    CONSTRAINT flow_posting_posted_is_whole CHECK (
        (status = 'POSTED') = (journal_entry_id IS NOT NULL)
        AND (journal_entry_id IS NULL) = (posted_at IS NULL)
    )
);

CREATE INDEX ix_flow_posting_pending ON flow_posting (created_at) WHERE status = 'PENDING';

COMMENT ON TABLE flow_posting IS
    'The journal MEANING a flow stage produced (0618): inter-unit goods on depart/receive when units are crossed, supplier return on handover. Quantities only; Finance values and posts it through the account map. Never an account (I9).';

CREATE TABLE flow_event (
    id             bigserial PRIMARY KEY,
    document_id    uuid NOT NULL REFERENCES flow_document (id),
    stage_index    integer,
    event_type     text NOT NULL CHECK (event_type IN (
        'STAGE_DONE', 'STAGE_SKIPPED', 'STAGE_PARKED', 'STAGE_REOPENED',
        'MOVEMENT', 'CLAIM', 'JOURNAL', 'STATUS'
    )),
    -- Who executed the stage: the NODE that owns the site's ledger (the event
    -- records what it already wrote) or the HUB (the event carries the
    -- movement to that node).
    executed_at    text NOT NULL CHECK (executed_at IN ('NODE', 'HUB')),
    -- The site whose node the event concerns, when it concerns one.
    target_site_id text REFERENCES site (id),
    payload        jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    relayed_at     timestamptz
);

CREATE INDEX ix_flow_event_unrelayed ON flow_event (id) WHERE relayed_at IS NULL;
CREATE INDEX ix_flow_event_document ON flow_event (document_id, id);

COMMENT ON TABLE flow_event IS
    'The flow outbox (0618): every effect a stage produced, written in the stage''s own transaction, in order, for the relay to carry on.';

-- Crossing units posts inter-unit; a supplier handover posts its return.
CREATE FUNCTION flow_stage_posts_its_meaning() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    crosses     boolean;
    to_supplier boolean;
    needed      text;
BEGIN
    IF NEW.status <> 'DONE' THEN
        RETURN NULL;
    END IF;
    SELECT d.crosses_units, d.destination_party_kind = 'SUPPLIER'
      INTO crosses, to_supplier
      FROM flow_document d
     WHERE d.id = NEW.document_id;

    needed := CASE
        WHEN NEW.stage_kind = 'DEPART' AND crosses THEN 'INTERUNIT_GOODS_DISPATCHED'
        WHEN NEW.stage_kind = 'RECEIVE' AND crosses THEN 'INTERUNIT_GOODS_RECEIVED'
        WHEN NEW.stage_kind = 'HANDOVER_WITH_PROOF' AND to_supplier THEN 'SUPPLIER_RETURN_HANDED_OVER'
        ELSE NULL
    END;
    IF needed IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM flow_posting p
                        WHERE p.document_id = NEW.document_id
                          AND p.stage_index = NEW.stage_index
                          AND p.meaning = needed) THEN
        RAISE EXCEPTION 'stage % of flow % is done without its % posting: crossing units posts inter-unit automatically (0618)',
            NEW.stage_kind, NEW.document_id, needed;
    END IF;
    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER flow_stage_posts_when_it_crosses
    AFTER INSERT OR UPDATE ON flow_stage_state
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION flow_stage_posts_its_meaning();
