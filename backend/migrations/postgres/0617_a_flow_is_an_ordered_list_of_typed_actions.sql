-- A flow is an ordered list of typed actions, and each stage keeps its state.
--
-- Borrowed from Medusa's OrderChange / OrderChangeAction: every act on a flow
-- document is one `flow_action` row — a type, the stage it acts on, a
-- `details` object — in the order it was applied. The action types are
-- registered in code (`domain::flow::action`), each with `validate` and
-- `apply`; a preview replays the list in memory and a confirm writes the new
-- rows once, with everything its stage produced, in ONE transaction
-- (`postgres::flows`). There are no sagas: nothing written here is ever
-- compensated, and the rows are append-only.
--
-- `flow_stage_state` and `flow_stage_line` are the projection of that list
-- the database can hold rules against. The rules that decide whether goods
-- go wrong live here, not only in validation:
--
--   * one stage state per stage of the document, and each stage keeps an
--     idempotency key, `<document>:<STAGE_KIND>`, by which a parked stage (a
--     scan, an approval, a handover) is resumed — twice is once;
--   * receive is confirmed once (a unique index) and cannot be refused: the
--     only actions that may name a RECEIVE stage are the confirm and parking
--     it for the scan;
--   * the verifier is never the checker, and the approver never the person
--     who asked;
--   * nothing goes negative, and no stage passes on more than the stage
--     before it handed on — or, before any stage counted, than the document
--     asked for. A blind count has no ceiling: goods beyond the order are real
--     goods, and a count capped at the order is a count that saw it.

CREATE TABLE flow_stage_state (
    document_id     uuid NOT NULL REFERENCES flow_document (id),
    stage_index     integer NOT NULL CHECK (stage_index >= 0),
    stage_kind      text NOT NULL CHECK (stage_kind IN (
        'APPROVAL', 'PICK', 'PACK', 'CLOSE_KOLI', 'LOAD', 'DEPART', 'RECEIVE', 'INSPECT',
        'READY_FOR_PICKUP', 'HANDOVER_WITH_PROOF', 'ARRIVAL', 'BLIND_COUNT', 'VERIFICATION',
        'TAGGING', 'PUTAWAY'
    )),
    performer_role  text NOT NULL,
    status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARKED', 'DONE', 'SKIPPED')),
    park_reason     text CHECK (park_reason IN ('SCAN', 'APPROVAL', 'HANDOVER')),
    -- How a parked stage is resumed: the document and the stage, nothing else.
    idempotency_key text NOT NULL UNIQUE,
    -- When the stage became the one due, and by when it should be done.
    activated_at    timestamptz,
    deadline_at     timestamptz,
    parked_by       text,
    parked_at       timestamptz,
    done_by         text,
    done_at         timestamptz,
    skipped_by      text,
    skipped_at      timestamptz,
    skip_reason     text,
    -- ARRIVAL's delivery number; APPROVAL's decision.
    delivery_number text,
    decision        text CHECK (decision IN ('APPROVED', 'DECLINED')),
    proof           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(proof) = 'array'),
    note            text,
    updated_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (document_id, stage_index),
    UNIQUE (document_id, stage_kind),
    CONSTRAINT flow_stage_state_key_is_document_and_stage CHECK (
        idempotency_key = document_id::text || ':' || stage_kind
    ),
    CONSTRAINT flow_stage_state_parked_says_why CHECK (status <> 'PARKED' OR park_reason IS NOT NULL),
    CONSTRAINT flow_stage_state_done_says_who CHECK (
        status <> 'DONE' OR (done_by IS NOT NULL AND done_at IS NOT NULL)
    ),
    CONSTRAINT flow_stage_state_skipped_says_who_and_why CHECK (
        status <> 'SKIPPED'
        OR (skipped_by IS NOT NULL AND skipped_at IS NOT NULL AND btrim(skip_reason) <> '')
    ),
    CONSTRAINT flow_stage_state_never_skipped CHECK (
        status <> 'SKIPPED' OR stage_kind IN ('LOAD', 'INSPECT', 'READY_FOR_PICKUP', 'TAGGING', 'PUTAWAY')
    ),
    CONSTRAINT flow_stage_state_arrival_has_its_number CHECK (
        stage_kind <> 'ARRIVAL' OR status <> 'DONE' OR btrim(delivery_number) <> ''
    ),
    CONSTRAINT flow_stage_state_approval_decides CHECK (
        stage_kind <> 'APPROVAL' OR status <> 'DONE' OR decision IS NOT NULL
    )
);

CREATE INDEX ix_flow_stage_state_due ON flow_stage_state (deadline_at)
    WHERE status IN ('PENDING', 'PARKED') AND deadline_at IS NOT NULL;

COMMENT ON TABLE flow_stage_state IS
    'Each stage of a flow document: pending, parked, done or skipped, who and when, its deadline, and the idempotency key (document:STAGE_KIND) a parked stage is resumed by (0617).';

-- What one stage did with one SKU. `quantity` is what it handled and passes
-- on (at receive: what was found); `missing_quantity` is handed over and not
-- found (receive only); `reject_quantity` is found and unsaleable, part of
-- `quantity`.
CREATE TABLE flow_stage_line (
    document_id      uuid NOT NULL,
    stage_index      integer NOT NULL,
    sku_id           uuid NOT NULL REFERENCES sku (id),
    quantity         bigint NOT NULL CHECK (quantity >= 0),
    missing_quantity bigint NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
    reject_quantity  bigint NOT NULL DEFAULT 0 CHECK (reject_quantity >= 0),

    PRIMARY KEY (document_id, stage_index, sku_id),
    FOREIGN KEY (document_id, stage_index) REFERENCES flow_stage_state (document_id, stage_index),
    CONSTRAINT flow_stage_line_reject_is_part_of_it CHECK (reject_quantity <= quantity)
);

-- No stage passes on more than the stage before handed on.
CREATE FUNCTION flow_stage_line_within_upstream() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    this_kind      text;
    upstream_index integer;
    ceiling        bigint;
BEGIN
    SELECT s.stage_kind INTO this_kind
      FROM flow_stage_state s
     WHERE s.document_id = NEW.document_id AND s.stage_index = NEW.stage_index;

    IF this_kind = 'BLIND_COUNT' THEN
        -- Blind: no ceiling. Excess is real goods.
        RETURN NEW;
    END IF;
    IF NEW.missing_quantity > 0 AND this_kind <> 'RECEIVE' THEN
        RAISE EXCEPTION 'only a receipt records goods handed over and not found (0617)';
    END IF;

    SELECT max(s.stage_index) INTO upstream_index
      FROM flow_stage_state s
     WHERE s.document_id = NEW.document_id
       AND s.stage_index < NEW.stage_index
       AND s.status = 'DONE'
       AND EXISTS (SELECT 1 FROM flow_stage_line l
                    WHERE l.document_id = s.document_id AND l.stage_index = s.stage_index);

    IF upstream_index IS NULL THEN
        SELECT d.quantity INTO ceiling
          FROM flow_document_line d
         WHERE d.document_id = NEW.document_id AND d.sku_id = NEW.sku_id;
    ELSE
        SELECT l.quantity INTO ceiling
          FROM flow_stage_line l
         WHERE l.document_id = NEW.document_id
           AND l.stage_index = upstream_index
           AND l.sku_id = NEW.sku_id;
    END IF;

    IF NEW.quantity + NEW.missing_quantity > COALESCE(ceiling, 0) THEN
        RAISE EXCEPTION 'stage % of flow % passes on % of SKU % where the stage before handed on % (0617)',
            NEW.stage_index, NEW.document_id, NEW.quantity + NEW.missing_quantity, NEW.sku_id,
            COALESCE(ceiling, 0);
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER flow_stage_line_counts_once
    BEFORE INSERT OR UPDATE ON flow_stage_line
    FOR EACH ROW EXECUTE FUNCTION flow_stage_line_within_upstream();

-- Two people, where the stage says two people.
CREATE FUNCTION flow_stage_state_two_people() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'DONE' AND NEW.stage_kind = 'VERIFICATION'
       AND EXISTS (SELECT 1 FROM flow_stage_state b
                    WHERE b.document_id = NEW.document_id
                      AND b.stage_kind = 'BLIND_COUNT'
                      AND b.done_by = NEW.done_by) THEN
        RAISE EXCEPTION 'the verifier is never the checker (0617)';
    END IF;
    IF NEW.status = 'DONE' AND NEW.stage_kind = 'APPROVAL'
       AND EXISTS (SELECT 1 FROM flow_document d
                    WHERE d.id = NEW.document_id AND d.requested_by = NEW.done_by) THEN
        RAISE EXCEPTION 'the approver is never the person who asked (0617)';
    END IF;
    -- A stage that is done stays done. Only a recount reopens the blind count,
    -- and nothing else moves backwards.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('DONE', 'SKIPPED') AND NEW.status <> OLD.status
           AND NOT (OLD.stage_kind = 'BLIND_COUNT' AND NEW.status = 'PENDING') THEN
            RAISE EXCEPTION 'stage % of flow % is % and stays so (0617)',
                OLD.stage_kind, OLD.document_id, OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER flow_stage_state_is_checked
    BEFORE INSERT OR UPDATE ON flow_stage_state
    FOR EACH ROW EXECUTE FUNCTION flow_stage_state_two_people();

CREATE TABLE flow_action (
    id           uuid PRIMARY KEY,
    document_id  uuid NOT NULL REFERENCES flow_document (id),
    -- The order it was applied in: 1, 2, 3… per document, without holes.
    seq          integer NOT NULL CHECK (seq >= 1),
    stage_index  integer NOT NULL,
    stage_kind   text NOT NULL,
    action_type  text NOT NULL CHECK (action_type IN (
        'RECORD_COUNT', 'PARK_STAGE', 'COMPLETE_STAGE', 'SKIP_STAGE', 'DECIDE_APPROVAL',
        'CONFIRM_RECEIVE', 'HANDOVER', 'REQUEST_RECOUNT', 'CANCEL_FLOW'
    )),
    details      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    -- Who applied it, and on which rung: a replay reproduces the decision
    -- as it was taken, not as the actor's rung reads today.
    actor        text NOT NULL CHECK (btrim(actor) <> ''),
    actor_role   text NOT NULL CHECK (actor_role IN ('CASHIER', 'SUPERVISOR', 'ADMIN')),
    -- The confirm (or resume) call that wrote it.
    request_key  text NOT NULL CHECK (btrim(request_key) <> ''),
    applied_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE (document_id, seq),
    FOREIGN KEY (document_id, stage_index) REFERENCES flow_stage_state (document_id, stage_index),
    -- Receive cannot be refused: the confirm, or waiting for the scan.
    CONSTRAINT flow_action_receive_is_never_refused CHECK (
        stage_kind <> 'RECEIVE' OR action_type IN ('CONFIRM_RECEIVE', 'PARK_STAGE')
    ),
    CONSTRAINT flow_action_confirm_is_receive_s CHECK (
        action_type <> 'CONFIRM_RECEIVE' OR stage_kind = 'RECEIVE'
    ),
    CONSTRAINT flow_action_handover_is_handover_s CHECK (
        action_type <> 'HANDOVER' OR stage_kind = 'HANDOVER_WITH_PROOF'
    ),
    CONSTRAINT flow_action_decision_is_approval_s CHECK (
        action_type <> 'DECIDE_APPROVAL' OR stage_kind = 'APPROVAL'
    ),
    CONSTRAINT flow_action_recount_is_verification_s CHECK (
        action_type <> 'REQUEST_RECOUNT' OR stage_kind = 'VERIFICATION'
    )
);

-- One confirm at receive. A second is refused, not added.
CREATE UNIQUE INDEX flow_action_receive_confirmed_once
    ON flow_action (document_id, stage_index) WHERE action_type = 'CONFIRM_RECEIVE';

COMMENT ON TABLE flow_action IS
    'A flow document as an ordered list of typed actions (0617), Medusa OrderChangeAction-style. Types are registered in code with validate and apply; rows are written once, applied, and never changed.';

CREATE FUNCTION flow_action_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'an applied flow action is never changed or removed; the next action corrects it (0617)';
END
$$;

CREATE TRIGGER flow_action_never_changes
    BEFORE UPDATE OR DELETE ON flow_action
    FOR EACH ROW EXECUTE FUNCTION flow_action_is_append_only();

-- The action carries the kind of the stage it names, and it is that stage's.
CREATE FUNCTION flow_action_names_its_stage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM flow_stage_state s
                    WHERE s.document_id = NEW.document_id
                      AND s.stage_index = NEW.stage_index
                      AND s.stage_kind = NEW.stage_kind) THEN
        RAISE EXCEPTION 'flow action % names stage % as %, which it is not (0617)',
            NEW.action_type, NEW.stage_index, NEW.stage_kind;
    END IF;
    IF NEW.seq <> COALESCE((SELECT max(a.seq) FROM flow_action a WHERE a.document_id = NEW.document_id), 0) + 1 THEN
        RAISE EXCEPTION 'flow actions are applied in order without holes (0617)';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER flow_action_is_in_order
    BEFORE INSERT ON flow_action
    FOR EACH ROW EXECUTE FUNCTION flow_action_names_its_stage();
