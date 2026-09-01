-- A Cloud cancellation request for an Edge-owned Allotment is asynchronous.
-- The header binds one whole-Allotment request to its exact command and result;
-- reservation counters remain Edge facts and are not changed while PENDING.
ALTER TABLE allotment
    ADD COLUMN cancellation_id uuid UNIQUE,
    ADD COLUMN cancellation_command_id uuid UNIQUE REFERENCES sync_command(command_id),
    ADD COLUMN edge_cancellation_status text
        CHECK (edge_cancellation_status IN ('PENDING','APPLIED','PARTIALLY_APPLIED','REJECTED')),
    ADD COLUMN edge_cancellation_result_id uuid UNIQUE
        REFERENCES edge_allotment_cancellation_result(result_id),
    ADD COLUMN edge_cancellation_received_at timestamptz,
    ADD CONSTRAINT allotment_edge_cancellation_shape_check CHECK (
        (cancellation_id IS NULL
         AND cancellation_command_id IS NULL
         AND edge_cancellation_status IS NULL
         AND edge_cancellation_result_id IS NULL
         AND edge_cancellation_received_at IS NULL)
        OR
        (cancellation_id IS NOT NULL
         AND cancellation_command_id IS NOT NULL
         AND edge_cancellation_status = 'PENDING'
         AND edge_cancellation_result_id IS NULL
         AND edge_cancellation_received_at IS NULL)
        OR
        (cancellation_id IS NOT NULL
         AND cancellation_command_id IS NOT NULL
         AND edge_cancellation_status IN ('APPLIED','PARTIALLY_APPLIED','REJECTED')
         AND edge_cancellation_result_id IS NOT NULL
         AND edge_cancellation_received_at IS NOT NULL)
    );

-- Cancellation requests are immutable audit facts but have no reservation
-- delta. Only the Edge result emits ALLOTMENT_CANCELLED for actual quantity.
DO $$
DECLARE constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'allotment_event'::regclass
          AND contype = 'c'
          AND position('event_type' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format('ALTER TABLE allotment_event DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END $$;

ALTER TABLE allotment_event
    ADD CONSTRAINT allotment_event_type_cancellation_workflow_check CHECK (event_type IN (
        'ALLOTMENT_CREATED',
        'ALLOTMENT_EXECUTED',
        'ALLOTMENT_CANCELLATION_REQUESTED',
        'ALLOTMENT_CANCELLED',
        'ALLOTMENT_SHORTAGE',
        'ALLOTMENT_PICKED',
        'ALLOTMENT_PARTIALLY_PICKED'
    )),
    ADD CONSTRAINT allotment_event_semantics_cancellation_workflow_check CHECK (
        (event_type = 'ALLOTMENT_CREATED'
         AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL
         AND remaining_delta = quantity AND movement_group_id IS NULL)
        OR
        (event_type IN ('ALLOTMENT_EXECUTED','ALLOTMENT_PICKED','ALLOTMENT_PARTIALLY_PICKED')
         AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL
         AND remaining_delta = -quantity AND movement_group_id IS NOT NULL)
        OR
        (event_type = 'ALLOTMENT_CANCELLATION_REQUESTED'
         AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL
         AND remaining_delta = 0 AND movement_group_id IS NULL)
        OR
        (event_type = 'ALLOTMENT_CANCELLED'
         AND allotment_id IS NOT NULL AND allotment_line_id IS NOT NULL
         AND (remaining_delta = -quantity
              OR (remaining_delta = 0
                  AND reference_type = 'ALLOTMENT_CANCELLATION'))
         AND movement_group_id IS NULL)
        OR
        (event_type = 'ALLOTMENT_SHORTAGE'
         AND remaining_delta = 0 AND movement_group_id IS NOT NULL)
    );

COMMENT ON COLUMN allotment.edge_cancellation_status IS
    'Exact-target Edge cancellation workflow state; PENDING never changes reservation counters.';
