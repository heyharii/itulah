-- A flow tells its nodes what it did, and books the meanings it produced.
--
-- 0618 gave every flow stage an outbox (`flow_event`) and a place for its
-- journal meanings (`flow_posting`), and left both for later: nothing carried
-- an event anywhere and nothing posted a meaning. `flow_stages::after_stage_tx`
-- now does both in the stage's own transaction.
--
-- # The outbox, relayed
--
-- Each event goes to the node of each site it concerns — its stage's site, or
-- for the document's own status both ends — as one sync command per node and
-- document (`inventory.flow.events.v1`, through `issue_command_tx`). Only a
-- node whose heartbeat advertises `inventory.flows.v1` is sent one: an older
-- build blocks its whole command stream on a type it does not know. The rest
-- wait, and are sent when the node's heartbeat first says it can. A site with
-- no node has nobody to tell. `flow_event.relayed_at` is set once every node
-- the event concerns has it; which node has which event, and in which
-- command, is kept here.
--
-- # The meanings, posted
--
-- Inter-unit goods dispatched and received are booked per unit in the SJD
-- shape the client accountant set (25 Sep), through the poster and in
-- meanings only (I9) — the same lines the allotment sweep books, recorded in
-- the same `stock_transfer_posting`, so a move is booked once whichever of the
-- two gets to it first. Goods handed back to a supplier go back to the receipt
-- they came from (`stock_ledger_return_to_supplier`). What cannot be posted —
-- a closed period, a paused source, a store-to-store move (which crosses
-- through head office, I8, and has no rule yet), a supplier return whose
-- receipt is not certain — stays PENDING with the reason, and is tried again;
-- it is marked, never defaulted (FINANCE-HARD-RULES §3).

CREATE TABLE flow_event_delivery (
    event_id   bigint NOT NULL REFERENCES flow_event (id),
    origin_id  text NOT NULL REFERENCES sync_origin_credential (origin_id),
    command_id uuid NOT NULL REFERENCES sync_command (command_id),
    relayed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, origin_id)
);

CREATE INDEX ix_flow_event_delivery_command ON flow_event_delivery (command_id);
CREATE INDEX ix_flow_event_waiting_site ON flow_event (target_site_id) WHERE relayed_at IS NULL;

COMMENT ON TABLE flow_event_delivery IS
    'Which node has which flow outbox row, and in which sync command (0626). An event is relayed (flow_event.relayed_at) once every node it concerns has it.';

ALTER TABLE flow_posting
    ADD COLUMN note         text,
    ADD COLUMN attempted_at timestamptz;

COMMENT ON COLUMN flow_posting.note IS
    'Why a meaning is still PENDING when last tried, or how it was posted (0626): marked, never defaulted.';

-- The entries a posting made. `journal_entry_id` on the posting keeps the
-- first, as 0618's check asks of a POSTED row; a return of several articles
-- to a supplier makes one entry per receipt it goes back to.
CREATE TABLE flow_posting_entry (
    posting_id       uuid NOT NULL REFERENCES flow_posting (id),
    journal_entry_id uuid NOT NULL REFERENCES journal_entry (entry_id),
    PRIMARY KEY (posting_id, journal_entry_id)
);

COMMENT ON TABLE flow_posting_entry IS
    'The journal entries one flow posting made (0626): per allotment line for inter-unit goods, per receipt for a supplier return.';
