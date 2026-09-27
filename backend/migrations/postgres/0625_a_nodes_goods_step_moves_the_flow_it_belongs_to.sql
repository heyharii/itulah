-- A node's step with a flow's goods moves the flow it belongs to.
--
-- A flow document's stages are done on the nodes that own the sites'
-- ledgers (0615–0619, `domain::flow::stage`). Most of what they do already
-- reaches the centre as facts — picks, koli packed, shipped, loaded and
-- departed, a supplier's delivery accepted, a tagging job confirmed — and the
-- centre now reads those to move the flow a node's work belongs to
-- (`postgres::flow_stages`). Three steps had no fact the centre kept:
--
--   RECEIVED   a site of ours received an announced delivery, in its one
--              confirm: per allotment line, what came off the lorry and what
--              of it was found (`inventory.inbound.received.v1`). The per-EPC
--              transfer claims say which garments were found; a garment that
--              was not found writes no claim, so only this says what was
--              handed over (allotment ALT-D01).
--   INSPECTED  the Gudang inspected a store's return: good goods to the
--              racks, damaged goods to reject (`inventory.return.inspected.v1`).
--   PUT_AWAY   the Gudang put a tagged job's goods away (`inventory.putaway.v1`).
--
-- They are kept here, one row per fact and its lines, written once and never
-- changed: a flow reads them, and nothing reads them to move a ledger. The
-- movements themselves travel as movement facts.
--
-- # Why a stage can be refused, and where that is said
--
-- A node's work does not wait for the flow: the Gudang may pack a supplier
-- return before head office approved it, and a template may ask for proof a
-- node cannot give (a photo of an inspection). The node's fact is applied
-- whatever the flow says — a flow must never stop a node's stream — and the
-- flow takes what it can. What it could not take is written on the stage
-- (`flow_stage_state.sync_problem`) until the next fact or the next hub act
-- takes it, so the hub can say why a document is not moving.

CREATE TABLE edge_goods_step (
    event_id           uuid PRIMARY KEY,
    origin_id          text NOT NULL REFERENCES sync_origin_credential (origin_id),
    generation         bigint NOT NULL CHECK (generation >= 1),
    seq                bigint NOT NULL CHECK (seq >= 1),
    kind               text NOT NULL CHECK (kind IN ('RECEIVED', 'INSPECTED', 'PUT_AWAY')),
    -- The site it happened at, in the centre's spelling (the node's own site,
    -- read from its registration, never from the fact). Not a foreign key: a
    -- spelling the centre cannot place must not stop the node's stream; the
    -- flow simply finds no document for it.
    site_id            text NOT NULL CHECK (btrim(site_id) <> ''),
    -- RECEIVED and INSPECTED: the delivery the goods came in, as the node
    -- keys it, and where it came from.
    delivery_id        text,
    source_site_id     text,
    shipment_reference text,
    -- PUT_AWAY: the tagging job whose goods were put away.
    tagging_job_id     uuid,
    actor_id           text NOT NULL CHECK (btrim(actor_id) <> ''),
    occurred_at        timestamptz NOT NULL,
    payload            jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    recorded_at        timestamptz NOT NULL DEFAULT now(),

    UNIQUE (origin_id, generation, seq),
    CONSTRAINT edge_goods_step_names_its_goods CHECK (
        CASE kind
            WHEN 'PUT_AWAY' THEN tagging_job_id IS NOT NULL
            ELSE delivery_id IS NOT NULL AND btrim(delivery_id) <> ''
        END
    )
);

CREATE INDEX ix_edge_goods_step_delivery ON edge_goods_step (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX ix_edge_goods_step_job ON edge_goods_step (tagging_job_id) WHERE tagging_job_id IS NOT NULL;

COMMENT ON TABLE edge_goods_step IS
    'A step a node took with goods a flow counts (0625): a delivery received, a store return inspected, a tagged job put away. One row per fact, written once; read by postgres::flow_stages, never to move a ledger.';

CREATE TABLE edge_goods_step_line (
    event_id          uuid NOT NULL REFERENCES edge_goods_step (event_id),
    line_no           integer NOT NULL CHECK (line_no >= 1),
    -- RECEIVED and INSPECTED: the allotment line the goods travelled on, as
    -- the centre announced it. Not a foreign key, for the reason above.
    allotment_line_id uuid,
    sku_code          text NOT NULL CHECK (btrim(sku_code) <> ''),
    -- RECEIVED: what came off the lorry for this line, found or not.
    expected          bigint NOT NULL DEFAULT 0 CHECK (expected >= 0),
    -- RECEIVED: found. INSPECTED: inspected (good and damaged). PUT_AWAY: put away.
    quantity          bigint NOT NULL CHECK (quantity >= 0),
    -- INSPECTED: found unfit to sell, part of `quantity`.
    damaged           bigint NOT NULL DEFAULT 0 CHECK (damaged >= 0),

    PRIMARY KEY (event_id, line_no),
    CONSTRAINT edge_goods_step_line_damaged_is_part CHECK (damaged <= quantity)
);

CREATE INDEX ix_edge_goods_step_line_allotment
    ON edge_goods_step_line (allotment_line_id) WHERE allotment_line_id IS NOT NULL;

COMMENT ON TABLE edge_goods_step_line IS
    'The lines of a node''s goods step (0625). expected is what came off the lorry for the line (a receipt); quantity what was found, inspected or put away; damaged the unsaleable part of an inspection.';

CREATE FUNCTION edge_goods_step_is_written_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'a node''s goods step is a fact: written once and never changed (0625)';
END
$$;

CREATE TRIGGER edge_goods_step_never_changes
    BEFORE UPDATE OR DELETE ON edge_goods_step
    FOR EACH ROW EXECUTE FUNCTION edge_goods_step_is_written_once();

CREATE TRIGGER edge_goods_step_line_never_changes
    BEFORE UPDATE OR DELETE ON edge_goods_step_line
    FOR EACH ROW EXECUTE FUNCTION edge_goods_step_is_written_once();

-- Why the nodes' work could not move this stage, until it can.
ALTER TABLE flow_stage_state
    ADD COLUMN sync_problem    text,
    ADD COLUMN sync_problem_at timestamptz,
    ADD CONSTRAINT flow_stage_state_sync_problem_is_dated CHECK (
        (sync_problem IS NULL) = (sync_problem_at IS NULL)
    );

COMMENT ON COLUMN flow_stage_state.sync_problem IS
    'Why the nodes'' work could not move this stage when last tried (0625): waiting for an approval, a proof a node cannot give, a count the flow refused. Cleared when a later try succeeds.';
