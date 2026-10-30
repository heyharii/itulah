-- 1003: MD edits an allotment the Gudang server holds (GUDANG-SERVER-PLAN.md
-- step 4; sqlite 0099, `edge::dc_allotment`, `cloud::postgres::allotment_node`).
--
-- Once the pen has moved, Central does not write the Gudang's allotments
-- itself. MD's edit made here is forwarded to the server as
-- `inventory.allotment.amend.v1` and kept as a request until the server's
-- `inventory.allotment.amended.v1` answers it: PENDING is "waiting for the
-- Gudang", APPLIED or REJECTED (with the server's reason) is the answer.
-- What the edit did — `allotment_amendment` rows, the line progress — is
-- written from the fact, never from the request.
--
-- An edit MD makes on the server itself, over the LAN, arrives as the same
-- fact with no request; and an allotment she raises there arrives as
-- `inventory.allotment.created.v1`. Both are kept by event id, so a fact
-- applied twice changes nothing the second time.

CREATE TABLE IF NOT EXISTS allotment_amendment_request (
    id              uuid        PRIMARY KEY,
    allotment_id    uuid        NOT NULL REFERENCES allotment(id),
    origin_id       text        NOT NULL,
    command_id      uuid        NOT NULL UNIQUE REFERENCES sync_command(command_id),
    status          text        NOT NULL DEFAULT 'PENDING'
                                CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED')),
    -- MD's request as she sent it, for the screen while it waits.
    request         jsonb       NOT NULL,
    requested_by    text        NOT NULL CHECK (btrim(requested_by) <> ''),
    requested_at    timestamptz NOT NULL,
    -- The server's refusal, in its words.
    refusal         text,
    result_event_id uuid,
    answered_at     timestamptz,
    idempotency_key text        NOT NULL,
    CHECK ((status = 'PENDING') = (answered_at IS NULL)),
    CHECK (status <> 'REJECTED' OR refusal IS NOT NULL)
);
-- One edit waits at a time: the next one is decided on what the Gudang did
-- with this one.
CREATE UNIQUE INDEX IF NOT EXISTS allotment_amendment_request_one_pending
    ON allotment_amendment_request (allotment_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS edge_allotment_amended_fact (
    event_id     uuid        PRIMARY KEY,
    origin_id    text        NOT NULL,
    generation   bigint      NOT NULL,
    seq          bigint      NOT NULL,
    event_type   text        NOT NULL,
    allotment_id uuid        NOT NULL,
    outcome      text        NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (origin_id, generation, seq)
);
