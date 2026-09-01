-- Owner-bound immutable transfer evidence. It is a reconciliation/read-model
-- input and never merges an Edge ledger into Cloud's native ledger.
CREATE TABLE edge_transfer_claim (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    owner_site_id text NOT NULL,
    owner_node_role text NOT NULL CHECK (owner_node_role IN ('DC','STORE')),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    claim_kind text NOT NULL CHECK (claim_kind IN ('IN_TRANSIT','RECEIVED')),
    source_dc_id text,
    destination_store_id text NOT NULL,
    shipment_reference text,
    epc text NOT NULL,
    quantity bigint NOT NULL CHECK (quantity = 1),
    sku_code text NOT NULL,
    movement_group_id uuid NOT NULL,
    receipt_id uuid,
    occurred_at timestamptz NOT NULL,
    in_transit_progress_event_id uuid,
    in_transit_unit_ordinal bigint,
    applied_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id, generation, seq),
    CHECK (btrim(destination_store_id) <> ''),
    CHECK (source_dc_id IS NULL OR btrim(source_dc_id) <> ''),
    CHECK (shipment_reference IS NULL OR btrim(shipment_reference) <> ''),
    CHECK (btrim(epc) <> '' AND epc = upper(epc)),
    CHECK (btrim(sku_code) <> '' AND sku_code = upper(sku_code)),
    CHECK (
        (claim_kind='IN_TRANSIT' AND owner_node_role='DC' AND source_dc_id=owner_site_id
            AND receipt_id IS NULL AND in_transit_progress_event_id IS NOT NULL
            AND in_transit_unit_ordinal >= 1)
        OR
        (claim_kind='RECEIVED' AND owner_node_role='STORE' AND destination_store_id=owner_site_id
            AND receipt_id IS NOT NULL AND in_transit_progress_event_id IS NULL
            AND in_transit_unit_ordinal IS NULL)
    )
);
CREATE INDEX edge_transfer_claim_exact_match
    ON edge_transfer_claim(source_dc_id,destination_store_id,shipment_reference,epc,claim_kind);
CREATE INDEX edge_transfer_claim_owner_time
    ON edge_transfer_claim(owner_site_id,occurred_at DESC);
CREATE UNIQUE INDEX edge_transfer_claim_in_transit_movement_epc
    ON edge_transfer_claim(movement_group_id,epc) WHERE claim_kind='IN_TRANSIT';
CREATE UNIQUE INDEX edge_transfer_claim_in_transit_progress_unit
    ON edge_transfer_claim(in_transit_progress_event_id,in_transit_unit_ordinal)
    WHERE claim_kind='IN_TRANSIT';
CREATE TRIGGER edge_transfer_claim_append_only
BEFORE UPDATE OR DELETE ON edge_transfer_claim
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- Publication and authoritative DC application outcome. A rejected application
-- reserves zero lines: activation is atomic for the entire Allotment.
ALTER TABLE allotment
    ADD COLUMN activation_command_id uuid REFERENCES sync_command(command_id),
    ADD COLUMN activation_target_origin_id text,
    ADD COLUMN edge_application_status text CHECK (edge_application_status IN ('PENDING','ACCEPTED','REJECTED')),
    ADD COLUMN edge_application_result_id uuid,
    ADD COLUMN edge_application_received_at timestamptz;

CREATE TABLE edge_allotment_application_result (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    result_id uuid NOT NULL UNIQUE,
    activation_command_id uuid NOT NULL REFERENCES sync_command(command_id),
    allotment_id uuid NOT NULL REFERENCES allotment(id),
    source_site_id text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('ACCEPTED','REJECTED')),
    rejection_code text,
    reason text,
    lines jsonb NOT NULL,
    applied_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id,generation,seq),
    CHECK (
        (decision='ACCEPTED' AND rejection_code IS NULL AND reason IS NULL)
        OR
        (decision='REJECTED' AND rejection_code IS NOT NULL AND reason IS NOT NULL)
    )
);

-- Fact-derived line projection. Current Allotted is accepted-picked-cancelled;
-- snapshot Allotted is only compared against that result as an audit check.
CREATE TABLE edge_allotment_line_progress (
    allotment_line_id uuid PRIMARY KEY REFERENCES allotment_line(id),
    allotment_id uuid NOT NULL REFERENCES allotment(id),
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    source_site_id text NOT NULL,
    source_pool_id text NOT NULL,
    destination_type text NOT NULL CHECK (destination_type IN ('STORE','DC','SUPPLIER')),
    destination_id text NOT NULL,
    sku_code text NOT NULL,
    planned_quantity bigint NOT NULL CHECK (planned_quantity > 0),
    accepted_quantity bigint NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
    picked_quantity bigint NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
    packed_quantity bigint NOT NULL DEFAULT 0 CHECK (packed_quantity >= 0),
    shipment_quantity bigint NOT NULL DEFAULT 0 CHECK (shipment_quantity >= 0),
    dispatched_quantity bigint NOT NULL DEFAULT 0 CHECK (dispatched_quantity >= 0),
    in_transit_quantity bigint NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),
    received_quantity bigint NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    cancelled_quantity bigint NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
    last_generation bigint NOT NULL CHECK (last_generation >= 1),
    last_seq bigint NOT NULL CHECK (last_seq >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (allotment_id,allotment_line_id),
    CHECK (accepted_quantity IN (0,planned_quantity)),
    CHECK (picked_quantity + cancelled_quantity <= accepted_quantity),
    CHECK (packed_quantity <= picked_quantity),
    CHECK (shipment_quantity <= packed_quantity),
    CHECK (dispatched_quantity <= shipment_quantity),
    CHECK (in_transit_quantity <= dispatched_quantity),
    CHECK (received_quantity <= in_transit_quantity)
);
CREATE INDEX edge_allotment_line_fifo
    ON edge_allotment_line_progress(origin_id,source_pool_id,sku_code,allotment_id);
CREATE INDEX edge_allotment_line_destination
    ON edge_allotment_line_progress(destination_type,destination_id,sku_code);

CREATE TABLE edge_allotment_pick_fact (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    pick_id uuid NOT NULL UNIQUE,
    source_site_id text NOT NULL,
    source_pool_id text NOT NULL,
    sku_code text NOT NULL,
    quantity bigint NOT NULL CHECK (quantity > 0),
    actor_id text NOT NULL,
    occurred_at timestamptz NOT NULL,
    allocations jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id,generation,seq)
);

-- Package is a logistics aggregate: one destination, many Allotments.
CREATE TABLE edge_fulfillment_package (
    package_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    source_site_id text NOT NULL,
    destination_store_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('PACKED','SHIPMENT','DISPATCHED','IN_TRANSIT')),
    shipment_reference text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    last_generation bigint NOT NULL CHECK (last_generation >= 1),
    last_seq bigint NOT NULL CHECK (last_seq >= 1),
    CHECK ((status='PACKED' AND shipment_reference IS NULL) OR (status<>'PACKED' AND shipment_reference IS NOT NULL))
);
CREATE TABLE edge_fulfillment_package_unit (
    package_id uuid NOT NULL REFERENCES edge_fulfillment_package(package_id),
    epc text NOT NULL,
    sku_code text NOT NULL,
    allotment_id uuid NOT NULL REFERENCES allotment(id),
    allotment_line_id uuid NOT NULL REFERENCES allotment_line(id),
    current_stage text NOT NULL CHECK (current_stage IN ('PACKED','SHIPMENT','DISPATCHED','IN_TRANSIT')),
    stage_rank smallint NOT NULL CHECK (stage_rank BETWEEN 2 AND 5),
    packed_at timestamptz NOT NULL,
    shipment_at timestamptz,
    dispatched_at timestamptz,
    in_transit_at timestamptz,
    released_at timestamptz,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (package_id,epc)
);
CREATE UNIQUE INDEX edge_active_package_epc
    ON edge_fulfillment_package_unit(epc) WHERE released_at IS NULL;
CREATE INDEX edge_package_unit_allotment
    ON edge_fulfillment_package_unit(allotment_line_id,stage_rank,epc);

CREATE TABLE edge_fulfillment_progress_fact (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    progress_id uuid NOT NULL UNIQUE,
    package_id uuid NOT NULL,
    source_site_id text NOT NULL,
    destination_store_id text NOT NULL,
    stage text NOT NULL CHECK (stage IN ('PACKED','SHIPMENT','DISPATCHED','IN_TRANSIT')),
    shipment_reference text,
    movement_group_id uuid NOT NULL,
    actor_id text NOT NULL,
    occurred_at timestamptz NOT NULL,
    units jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id,generation,seq)
);

-- Relational immutable membership for claim binding. JSON remains the wire
-- image, while these rows make EPC order and identity enforceable by SQL.
CREATE TABLE edge_fulfillment_progress_unit (
    progress_event_id uuid NOT NULL REFERENCES edge_fulfillment_progress_fact(event_id),
    package_id uuid NOT NULL,
    unit_ordinal bigint NOT NULL CHECK (unit_ordinal >= 1),
    epc text NOT NULL CHECK (btrim(epc) <> '' AND epc = upper(epc)),
    sku_code text NOT NULL CHECK (btrim(sku_code) <> '' AND sku_code = upper(sku_code)),
    allotment_id uuid NOT NULL REFERENCES allotment(id),
    allotment_line_id uuid NOT NULL REFERENCES allotment_line(id),
    PRIMARY KEY (progress_event_id,epc),
    UNIQUE (progress_event_id,unit_ordinal),
    UNIQUE (progress_event_id,unit_ordinal,epc,sku_code)
);

ALTER TABLE edge_transfer_claim
    ADD CONSTRAINT edge_transfer_claim_progress_unit_fk
    FOREIGN KEY (in_transit_progress_event_id,in_transit_unit_ordinal,epc,sku_code)
    REFERENCES edge_fulfillment_progress_unit(progress_event_id,unit_ordinal,epc,sku_code);

CREATE UNIQUE INDEX edge_fulfillment_package_stage
    ON edge_fulfillment_progress_fact(package_id,stage);
CREATE UNIQUE INDEX edge_fulfillment_progress_movement
    ON edge_fulfillment_progress_fact(movement_group_id);

CREATE TABLE edge_allotment_cancellation_result (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    result_id uuid NOT NULL UNIQUE,
    cancellation_id uuid NOT NULL,
    cancellation_command_id uuid NOT NULL REFERENCES sync_command(command_id),
    allotment_id uuid NOT NULL REFERENCES allotment(id),
    source_site_id text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('APPLIED','PARTIALLY_APPLIED','REJECTED')),
    reason text,
    lines jsonb NOT NULL,
    applied_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id,generation,seq),
    CHECK ((outcome='APPLIED' AND reason IS NULL) OR (outcome<>'APPLIED' AND reason IS NOT NULL))
);

-- Receipt attribution is a Cloud read-model join, not a mutation of either
-- owner's immutable transfer claim.
CREATE TABLE edge_transfer_allotment_attribution (
    receipt_event_id uuid PRIMARY KEY REFERENCES edge_transfer_claim(event_id),
    package_id uuid NOT NULL REFERENCES edge_fulfillment_package(package_id),
    allotment_id uuid NOT NULL REFERENCES allotment(id),
    allotment_line_id uuid NOT NULL REFERENCES allotment_line(id),
    epc text NOT NULL,
    matched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE official_count
    ADD COLUMN activation_command_id uuid REFERENCES sync_command(command_id),
    ADD COLUMN activation_target_origin_id text,
    ADD COLUMN edge_result_id uuid,
    ADD COLUMN edge_result_received_at timestamptz,
    ADD COLUMN adjustment_id uuid,
    ADD COLUMN adjustment_command_id uuid REFERENCES sync_command(command_id),
    ADD COLUMN adjustment_target_origin_id text,
    ADD COLUMN edge_adjustment_completion_id uuid,
    ADD COLUMN edge_adjustment_received_at timestamptz;

CREATE TABLE edge_official_count_result (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    result_id uuid NOT NULL UNIQUE,
    count_id uuid NOT NULL REFERENCES official_count(id),
    site_id text NOT NULL,
    pool_id text NOT NULL,
    actor_id text NOT NULL,
    submitted_at timestamptz NOT NULL,
    lines jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id,generation,seq)
);
CREATE TABLE edge_official_count_adjustment_result (
    event_id uuid PRIMARY KEY,
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id),
    generation bigint NOT NULL CHECK (generation >= 1),
    seq bigint NOT NULL CHECK (seq >= 1),
    completion_id uuid NOT NULL UNIQUE,
    adjustment_id uuid NOT NULL,
    adjustment_command_id uuid NOT NULL REFERENCES sync_command(command_id),
    count_id uuid NOT NULL REFERENCES official_count(id),
    site_id text NOT NULL,
    pool_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('APPLIED','REJECTED')),
    movement_group_id uuid,
    actor_id text NOT NULL,
    reason text,
    applied_at timestamptz NOT NULL,
    lines jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id,generation,seq),
    CHECK (
        (status='APPLIED')
        OR
        (status='REJECTED' AND movement_group_id IS NULL AND reason IS NOT NULL)
    )
);

CREATE TRIGGER edge_allotment_application_result_append_only BEFORE UPDATE OR DELETE ON edge_allotment_application_result FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER edge_allotment_pick_fact_append_only BEFORE UPDATE OR DELETE ON edge_allotment_pick_fact FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER edge_fulfillment_progress_fact_append_only BEFORE UPDATE OR DELETE ON edge_fulfillment_progress_fact FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER edge_fulfillment_progress_unit_append_only BEFORE UPDATE OR DELETE ON edge_fulfillment_progress_unit FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER edge_allotment_cancellation_result_append_only BEFORE UPDATE OR DELETE ON edge_allotment_cancellation_result FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER edge_official_count_result_append_only BEFORE UPDATE OR DELETE ON edge_official_count_result FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER edge_official_count_adjustment_result_append_only BEFORE UPDATE OR DELETE ON edge_official_count_adjustment_result FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
