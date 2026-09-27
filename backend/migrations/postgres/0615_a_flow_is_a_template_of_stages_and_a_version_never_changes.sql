-- A flow is a template of stages, and a version of it never changes.
--
-- The owner's decision of 2026-09-27 (CONTEXT.md, "Flow templates"): flows
-- of goods are TEMPLATES. What a stage means — pick, pack, close koli (KOLI),
-- ship (the surat jalan, SJ, one per destination), load (onto a dispatch,
-- DSP), depart, receive, inspect, ready for pickup, handover with proof,
-- approval, and the receiving stages arrival, blind count, verification,
-- tagging, putaway — is code (`cloud::domain::flow::stage`). Which stages a route runs,
-- in what order, who starts it, who performs each stage, the proof and the
-- deadline each asks, what may be skipped and which pool role goods land in
-- is data, edited by Admin, and it lives here.
--
-- A plan is not a stage: the allotment (or, from a supplier, the purchase
-- order) is the document a flow RUNS (0616's `source_kind`), and a
-- template's `starters` are who may raise that source for its route.
--
-- # Versions
--
-- A template is edited by saving a new version. A version and its stages are
-- never updated or deleted (the trigger below refuses both), and a running
-- document names the version it started on (0616), so a document started
-- under yesterday's rules finishes under them. `current_version_id` is which
-- version new documents start on.
--
-- # The invariants, held here as well as in Rust
--
-- `domain::flow::validate_template` checks a draft before it is saved and
-- tells the editor what is wrong, row by row. The same rules that decide
-- whether goods can go wrong are held a second time below, because a template
-- can also be written by a migration or by hand:
--
--   * the route: goods from a supplier arrive only at a head-office site, and
--     a supplier return leaves only from one (stores never deal with
--     suppliers); no route runs from one outside party to another;
--   * each stage kind at most once per version (nothing counted twice), and
--     the stages that are never skipped are never marked skippable;
--   * goods travelling between our own sites travel under a surat jalan:
--     SHIP is present and not skippable (the SJ is what the destination signs
--     and what the handover is counted from — allotment ALT-D01);
--   * how it ends (deferred, so a version and its stages are checked
--     together at commit): a flow to our own site has the stage that accepts
--     custody — RECEIVE between our sites, VERIFICATION from a supplier — and
--     after it only INSPECT, TAGGING or PUTAWAY; a flow to an outside party
--     ends in HANDOVER_WITH_PROOF, with a signature or a signed return note,
--     and the signed return note when the party is a supplier;
--   * parameters are an object and carry no account (FINANCE-HARD-RULES I9:
--     a template names meanings, never accounts). There is no account column
--     anywhere in these tables.
--
-- Route ends are spelled as `site.kind` spells a site (`HO`, `STORE`) or as
-- the party (`SUPPLIER`, `CUSTOMER`). When the premises vocabulary lands
-- (OFFICE / WAREHOUSE / SHOP), the checks on `origin_kind` and
-- `destination_kind` widen with it.

CREATE TABLE flow_template (
    id                 uuid PRIMARY KEY,
    -- What a person and a log line read: KIRIM_GUDANG_TOKO.
    code               text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    name               text NOT NULL CHECK (btrim(name) <> ''),
    origin_kind        text NOT NULL CHECK (origin_kind IN ('HO', 'STORE', 'SUPPLIER', 'CUSTOMER')),
    destination_kind   text NOT NULL CHECK (destination_kind IN ('HO', 'STORE', 'SUPPLIER', 'CUSTOMER')),
    status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
    -- The one template a creation path picks for this route when it names
    -- none (`postgres::flows::choose_flow_template_tx`).
    is_default         boolean NOT NULL DEFAULT false,
    current_version_id uuid,
    created_by         text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_by         text NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    retired_by         text,
    retired_at         timestamptz,

    CONSTRAINT flow_template_touches_our_site CHECK (
        origin_kind IN ('HO', 'STORE') OR destination_kind IN ('HO', 'STORE')
    ),
    CONSTRAINT flow_template_supplier_goods_arrive_at_head_office CHECK (
        origin_kind <> 'SUPPLIER' OR destination_kind = 'HO'
    ),
    CONSTRAINT flow_template_supplier_return_leaves_head_office CHECK (
        destination_kind <> 'SUPPLIER' OR origin_kind = 'HO'
    ),
    CONSTRAINT flow_template_retired_is_whole CHECK (
        (status = 'RETIRED') = (retired_at IS NOT NULL)
        AND (retired_at IS NULL) = (retired_by IS NULL)
    ),
    CONSTRAINT flow_template_retired_is_not_default CHECK (NOT (is_default AND status = 'RETIRED'))
);

CREATE UNIQUE INDEX flow_template_one_default_per_route
    ON flow_template (origin_kind, destination_kind) WHERE is_default;

COMMENT ON TABLE flow_template IS
    'A flow of goods as a template (0615): a route and, through its versions, the ordered stages it runs. Stage meanings are code (domain::flow::stage); this is the data an Admin edits.';

CREATE TABLE flow_template_version (
    id                    uuid PRIMARY KEY,
    template_id           uuid NOT NULL REFERENCES flow_template (id),
    version               integer NOT NULL CHECK (version >= 1),
    -- Who may start a document on it (domain::flow::FlowRole codes).
    starters              text[] NOT NULL CHECK (
        cardinality(starters) >= 1
        AND starters <@ ARRAY['HO_MD', 'HO_BUYER', 'HO_ADMIN', 'GUDANG_STAFF', 'GUDANG_SUPERVISOR',
                              'HO_DELIVERY', 'STORE_STAFF', 'STORE_MANAGER']::text[]
    ),
    -- The role of the pool goods land in at our destination; absent when the
    -- destination is an outside party.
    destination_pool_role text CHECK (destination_pool_role IN (
        'PENDING', 'WAREHOUSE', 'RETURN', 'REJECT', 'STOCKROOM', 'FLOOR'
    )),
    notes                 text,
    created_by            text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            timestamptz NOT NULL DEFAULT now(),

    UNIQUE (template_id, version),
    -- For the composite keys below: a document names a version AND its
    -- template, so a version of one template cannot be run under another.
    UNIQUE (id, template_id)
);

ALTER TABLE flow_template
    ADD CONSTRAINT flow_template_current_version_is_its_own
    FOREIGN KEY (current_version_id, id) REFERENCES flow_template_version (id, template_id)
    DEFERRABLE INITIALLY DEFERRED;

COMMENT ON TABLE flow_template_version IS
    'One saved version of a flow template (0615). Never updated or deleted: a running document keeps the version it started on.';

CREATE TABLE flow_template_stage (
    version_id     uuid NOT NULL REFERENCES flow_template_version (id),
    ordinal        integer NOT NULL CHECK (ordinal >= 0),
    stage_kind     text NOT NULL CHECK (stage_kind IN (
        'APPROVAL', 'PICK', 'PACK', 'CLOSE_KOLI', 'SHIP', 'LOAD', 'DEPART', 'RECEIVE', 'INSPECT',
        'READY_FOR_PICKUP', 'HANDOVER_WITH_PROOF', 'ARRIVAL', 'BLIND_COUNT', 'VERIFICATION',
        'TAGGING', 'PUTAWAY'
    )),
    performer_role text NOT NULL CHECK (performer_role IN (
        'HO_MD', 'HO_BUYER', 'HO_ADMIN', 'GUDANG_STAFF', 'GUDANG_SUPERVISOR', 'HO_DELIVERY',
        'STORE_STAFF', 'STORE_MANAGER'
    )),
    proof          text[] NOT NULL DEFAULT '{}' CHECK (
        proof <@ ARRAY['RFID_SCAN', 'MANUAL_COUNT', 'PHOTO', 'SIGNATURE', 'SIGNED_RETURN_NOTE']::text[]
    ),
    deadline_hours integer CHECK (deadline_hours BETWEEN 1 AND 720),
    skippable      boolean NOT NULL DEFAULT false,
    params         jsonb NOT NULL DEFAULT '{}'::jsonb,

    PRIMARY KEY (version_id, ordinal),
    -- Nothing counted twice: a stage kind once per version.
    UNIQUE (version_id, stage_kind),
    CONSTRAINT flow_template_stage_never_skipped CHECK (
        NOT skippable OR stage_kind IN ('SHIP', 'LOAD', 'INSPECT', 'READY_FOR_PICKUP', 'TAGGING', 'PUTAWAY')
    ),
    CONSTRAINT flow_template_stage_one_count_method CHECK (
        NOT ('RFID_SCAN' = ANY (proof) AND 'MANUAL_COUNT' = ANY (proof))
    ),
    CONSTRAINT flow_template_stage_params_are_an_object CHECK (jsonb_typeof(params) = 'object'),
    -- I9: a template names meanings, never accounts. Any key that reads like
    -- an account, at any depth, is refused.
    CONSTRAINT flow_template_stage_params_name_no_account CHECK (
        NOT jsonb_path_exists(
            params,
            '$.**.keyvalue() ? (@.key like_regex "account|akun|^coa$" flag "i")',
            '{}'::jsonb,
            true
        )
    )
);

COMMENT ON TABLE flow_template_stage IS
    'The ordered stages of one template version, with their parameters (0615). Stage meaning is code; performer, proof, deadline and skippable are data. No account, ever (I9).';

-- A version is never edited. Saving a template writes the next one.
CREATE FUNCTION flow_template_version_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'a flow template version is never changed or removed; save a new version instead (0615)';
END
$$;

CREATE TRIGGER flow_template_version_never_changes
    BEFORE UPDATE OR DELETE ON flow_template_version
    FOR EACH ROW EXECUTE FUNCTION flow_template_version_is_immutable();

CREATE TRIGGER flow_template_stage_never_changes
    BEFORE UPDATE OR DELETE ON flow_template_stage
    FOR EACH ROW EXECUTE FUNCTION flow_template_version_is_immutable();

-- How a version ends, checked with its stages at commit.
CREATE FUNCTION flow_template_version_holds(checked_version uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    origin      text;
    destination text;
    stage_count integer;
    accepting   text;
    accepted_at integer;
    last_kind   text;
    handover    text[];
BEGIN
    SELECT t.origin_kind, t.destination_kind
      INTO origin, destination
      FROM flow_template_version v
      JOIN flow_template t ON t.id = v.template_id
     WHERE v.id = checked_version;

    SELECT count(*) INTO stage_count FROM flow_template_stage WHERE version_id = checked_version;
    IF stage_count = 0 THEN
        RAISE EXCEPTION 'flow template version % has no stages (0615)', checked_version;
    END IF;

    IF destination IN ('HO', 'STORE') THEN
        accepting := CASE WHEN origin = 'SUPPLIER' THEN 'VERIFICATION' ELSE 'RECEIVE' END;
        SELECT ordinal INTO accepted_at
          FROM flow_template_stage
         WHERE version_id = checked_version AND stage_kind = accepting;
        IF accepted_at IS NULL THEN
            RAISE EXCEPTION 'a flow to our own site ends in %: version % has none (0615)',
                accepting, checked_version;
        END IF;
        IF EXISTS (SELECT 1 FROM flow_template_stage
                    WHERE version_id = checked_version
                      AND ordinal > accepted_at
                      AND stage_kind NOT IN ('INSPECT', 'TAGGING', 'PUTAWAY')) THEN
            RAISE EXCEPTION 'after % only INSPECT, TAGGING or PUTAWAY may follow (version %, 0615)',
                accepting, checked_version;
        END IF;
        IF EXISTS (SELECT 1 FROM flow_template_stage
                    WHERE version_id = checked_version AND stage_kind = 'HANDOVER_WITH_PROOF') THEN
            RAISE EXCEPTION 'a flow to our own site is received, not handed over (version %, 0615)', checked_version;
        END IF;
        IF origin IN ('HO', 'STORE')
           AND NOT EXISTS (SELECT 1 FROM flow_template_stage
                            WHERE version_id = checked_version AND stage_kind = 'SHIP' AND NOT skippable) THEN
            RAISE EXCEPTION 'goods between our own sites travel under a surat jalan: SHIP, not skippable (version %, 0615)',
                checked_version;
        END IF;
    ELSE
        SELECT stage_kind, proof INTO last_kind, handover
          FROM flow_template_stage
         WHERE version_id = checked_version
         ORDER BY ordinal DESC
         LIMIT 1;
        IF last_kind <> 'HANDOVER_WITH_PROOF' THEN
            RAISE EXCEPTION 'a flow to an outside party ends in HANDOVER_WITH_PROOF, not % (version %, 0615)',
                last_kind, checked_version;
        END IF;
        IF NOT (handover && ARRAY['SIGNATURE', 'SIGNED_RETURN_NOTE']::text[]) THEN
            RAISE EXCEPTION 'a handover asks for a signature or a signed return note (version %, 0615)', checked_version;
        END IF;
        IF destination = 'SUPPLIER' AND NOT ('SIGNED_RETURN_NOTE' = ANY (handover)) THEN
            RAISE EXCEPTION 'a handover to a supplier asks for the signed return note (version %, 0615)', checked_version;
        END IF;
        IF EXISTS (SELECT 1 FROM flow_template_stage
                    WHERE version_id = checked_version AND stage_kind = 'RECEIVE') THEN
            RAISE EXCEPTION 'a flow to an outside party is handed over, not received (version %, 0615)', checked_version;
        END IF;
    END IF;
END
$$;

CREATE FUNCTION flow_template_stage_checks_its_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'flow_template_version' THEN
        PERFORM flow_template_version_holds(NEW.id);
    ELSE
        PERFORM flow_template_version_holds(NEW.version_id);
    END IF;
    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER flow_template_version_ends_right
    AFTER INSERT ON flow_template_version
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION flow_template_stage_checks_its_version();

CREATE CONSTRAINT TRIGGER flow_template_stage_ends_right
    AFTER INSERT ON flow_template_stage
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION flow_template_stage_checks_its_version();

-- A template's route is its identity: the creation paths pick a template by
-- it. A different route is a different template.
CREATE FUNCTION flow_template_keeps_its_route() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.code <> OLD.code
       OR NEW.origin_kind <> OLD.origin_kind
       OR NEW.destination_kind <> OLD.destination_kind THEN
        RAISE EXCEPTION 'a flow template keeps its code and its route; make a new template for another route (0615)';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER flow_template_route_is_fixed
    BEFORE UPDATE ON flow_template
    FOR EACH ROW EXECUTE FUNCTION flow_template_keeps_its_route();
