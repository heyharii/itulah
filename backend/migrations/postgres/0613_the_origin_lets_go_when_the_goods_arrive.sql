-- 0613: the origin lets go of the goods when they arrive (inventory-fleet G3).
--
-- No movement crosses a node boundary, so a koli that left the Gudang stood in
-- the Gudang's in-transit pool for ever, even after the shop had counted it
-- in. The claims were paired centrally (`edge_transfer_allotment_attribution`)
-- and nothing told the origin.
--
-- Now, when a RECEIVED claim is paired with its IN_TRANSIT claim, head office
-- issues `inventory.in_transit.release.v1` to the origin node, which writes
-- its own movement out of in-transit — the origin's ledger is the origin's to
-- write, as with an official count. Only a node whose heartbeat says it
-- understands the command is sent it (an unknown command blocks a node's
-- stream); a pair matched while its origin runs an older build waits here,
-- with no command, and is issued when the node's heartbeat first carries the
-- capability.
--
-- A receipt that stops matching (a duplicate claim turns up) deletes its
-- attribution, and the release that was issued is not recalled: the goods
-- did arrive, and the origin let go of goods that are no longer its to hold.


-- ---------------------------------------------------------------------------
-- The release, per matched pair
-- ---------------------------------------------------------------------------

ALTER TABLE edge_transfer_allotment_attribution
    -- The origin node the release goes to: the IN_TRANSIT claim's origin.
    ADD COLUMN release_origin_id text REFERENCES sync_origin_credential (origin_id),
    -- The command that told it; NULL while it waits for a build that
    -- understands the command.
    ADD COLUMN release_command_id uuid REFERENCES sync_command (command_id),
    ADD COLUMN release_issued_at timestamptz,
    ADD CONSTRAINT edge_transfer_allotment_attribution_release_is_whole
        CHECK ((release_command_id IS NULL) = (release_issued_at IS NULL));

CREATE INDEX edge_transfer_attribution_release_waiting
    ON edge_transfer_allotment_attribution (release_origin_id)
    WHERE release_command_id IS NULL;

-- Pairs matched before this migration are owed a release too: that is the
-- stock G3 found standing in the Gudang's in-transit pool. They wait for the
-- origin's first capable heartbeat like any other.
UPDATE edge_transfer_allotment_attribution attribution
   SET release_origin_id = in_transit.origin_id
  FROM edge_transfer_claim in_transit
 WHERE in_transit.event_id = attribution.in_transit_event_id
   AND attribution.release_origin_id IS NULL;

COMMENT ON COLUMN edge_transfer_allotment_attribution.release_command_id IS
    'The inventory.in_transit.release.v1 command that told the origin to let go of this EPC (0612); NULL until its node can take one.';
