-- A shop's server tells head office how it is, once a minute.
--
-- The node posts the snapshot its own console shows (`edge/status.rs`,
-- `sync/node_status.rs`) to `/api/v1/sync/heartbeat`. Head office keeps:
--
--   node_heartbeat      the latest snapshot per node, and what the last alert
--                       was about, so a condition is announced once and its end
--                       is announced once;
--   node_incident       what happened to the node — crashes, hangs, holds,
--                       stops — filed once each however many heartbeats repeat
--                       it;
--   node_health_sample  one judgement per heartbeat, for the Fleet page's
--                       "last four hours" strip; kept thirty days.
--
-- A node that goes quiet writes nothing, and that absence is the signal: the
-- Fleet page and the silence sweep read `received_at`, not a status the node
-- could only send while it was well.

CREATE TABLE node_heartbeat (
    origin_id     text PRIMARY KEY REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    received_at   timestamptz NOT NULL,
    status        jsonb NOT NULL,
    version       text NOT NULL,
    -- `sync::node_status::assess` of `status` at `received_at`.
    code          text NOT NULL,
    tone          text NOT NULL CHECK (tone IN ('OK', 'INFO', 'WARN', 'BAD')),
    -- The condition head office was last told about, and when; NULL when
    -- nothing is outstanding.
    alerted_code  text,
    alerted_at    timestamptz,
    CONSTRAINT node_heartbeat_alert_is_whole CHECK ((alerted_code IS NULL) = (alerted_at IS NULL))
);

CREATE TABLE node_incident (
    origin_id   text NOT NULL REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    at          timestamptz NOT NULL,
    kind        text NOT NULL,
    payload     jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, at, kind)
);

CREATE TABLE node_health_sample (
    origin_id text NOT NULL REFERENCES sync_origin_credential(origin_id) ON DELETE CASCADE,
    at        timestamptz NOT NULL,
    tone      text NOT NULL CHECK (tone IN ('OK', 'INFO', 'WARN', 'BAD')),
    code      text NOT NULL,
    PRIMARY KEY (origin_id, at)
);
CREATE INDEX ix_node_health_sample_at ON node_health_sample (at);

-- Two notification kinds: a node needs somebody, and it no longer does.
-- The list is 0386's, unchanged, plus these two.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
    CHECK (kind IN (
        'activity',
        'purchase.price_amendment.requested',
        'purchase.delivery.due_soon',
        'receipt.awaiting_identity',
        'receipt.excess_awaiting_decision',
        'finance.integrity.exception',
        'discussion.thread.opened',
        'discussion.thread.replied',
        'asset.assessment.overdue',
        'people.contract.expiring',
        'people.period.month_open',
        'people.roster.gap',
        'ga.contract.expiring',
        'ga.document.expiring',
        'finance.bill.due_soon',
        'finance.tax.deadline',
        'commercial.cap.near',
        'commercial.cap.reached',
        'commercial.rollout.failed',
        'commercial.rollout.stalled',
        'commercial.usage.stale',
        'commercial.guardrail.breached',
        'commercial.promotion.starting',
        'commercial.promotion.ending',
        'node.attention',
        'node.recovered'
    ));
