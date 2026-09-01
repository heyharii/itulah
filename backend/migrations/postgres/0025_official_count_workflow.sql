-- Edge-owned Official Count workflow state and plural movement evidence.
-- Count result/completion rows remain immutable facts; current inventory comes
-- only from the referenced Edge movement facts.

ALTER TABLE official_count
    ADD COLUMN edge_adjustment_status text
        CHECK (edge_adjustment_status IN ('PENDING','APPLIED','REJECTED'));

CREATE UNIQUE INDEX official_count_edge_result_unique
    ON official_count(edge_result_id) WHERE edge_result_id IS NOT NULL;
CREATE UNIQUE INDEX official_count_adjustment_unique
    ON official_count(adjustment_id) WHERE adjustment_id IS NOT NULL;
CREATE UNIQUE INDEX official_count_adjustment_completion_unique
    ON official_count(edge_adjustment_completion_id)
    WHERE edge_adjustment_completion_id IS NOT NULL;

ALTER TABLE official_count
    ADD CONSTRAINT official_count_edge_adjustment_shape CHECK (
        edge_adjustment_status IS NULL
        OR (
            activation_target_origin_id IS NOT NULL
            AND adjustment_id IS NOT NULL
            AND adjustment_command_id IS NOT NULL
            AND adjustment_target_origin_id = activation_target_origin_id
            AND (
                (edge_adjustment_status = 'PENDING'
                    AND edge_adjustment_completion_id IS NULL
                    AND edge_adjustment_received_at IS NULL)
                OR
                (edge_adjustment_status IN ('APPLIED','REJECTED')
                    AND edge_adjustment_completion_id IS NOT NULL
                    AND edge_adjustment_received_at IS NOT NULL)
            )
        )
    );

ALTER TABLE edge_official_count_adjustment_result
    ADD COLUMN movement_group_ids jsonb;

-- Preserve any pre-existing single-group evidence while moving the wire and
-- read models to the plural contract.
UPDATE edge_official_count_adjustment_result
SET movement_group_ids = CASE
    WHEN movement_group_id IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(movement_group_id)
END;

ALTER TABLE edge_official_count_adjustment_result
    ALTER COLUMN movement_group_ids SET NOT NULL,
    ALTER COLUMN movement_group_ids SET DEFAULT '[]'::jsonb,
    ADD CONSTRAINT edge_count_adjustment_movement_groups_array
        CHECK (jsonb_typeof(movement_group_ids) = 'array'),
    ADD CONSTRAINT edge_count_adjustment_result_plural_shape CHECK (
        status = 'APPLIED'
        OR (status = 'REJECTED'
            AND movement_group_ids = '[]'::jsonb
            AND reason IS NOT NULL)
    );

CREATE UNIQUE INDEX edge_official_count_one_result_per_count
    ON edge_official_count_result(count_id);
CREATE UNIQUE INDEX edge_official_count_one_adjustment_per_count
    ON edge_official_count_adjustment_result(count_id);
CREATE UNIQUE INDEX edge_official_count_adjustment_command_unique
    ON edge_official_count_adjustment_result(adjustment_command_id);
