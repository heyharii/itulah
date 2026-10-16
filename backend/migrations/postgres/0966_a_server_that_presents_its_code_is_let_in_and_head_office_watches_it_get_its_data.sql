-- A store's server that presents the install code is let in at once, and head
-- office watches it take its first data.
--
-- The owner's decision of 10 Oct 2026: no number is matched. The install code,
-- issued from the store's page by an Admin and good for one claim and an hour,
-- is the proof. A claim of an unexpired, unused code is approved in the same
-- flow, attributed to the Admin who issued it (`node_enrolment.issued_by`,
-- 0397), and the approve/refuse endpoints stay for the System > Store Servers
-- register and for a claim that could not be approved by itself.
--
-- What head office needs to see afterwards is written down on the enrolment:
--
--   bootstrap_*        the first data the cloud queued for the new server
--                      (`bootstrap_origin`): when, the command range it took on
--                      that server's lane (`sync_command_delivery.seq`, from
--                      exclusive to inclusive), whether any stream failed, and
--                      the report itself. The server is READY once its
--                      acknowledged position (`sync_command_cursor.acked_seq`)
--                      reaches `bootstrap_seq`; until then it is SYNCING.
--   bootstrap_retried_at  the one automatic second attempt when a stream
--                      failed or the first attempt never ran to the end.
--   ready_at           the first time the server was ready - the moment head
--                      office is told, once.
--   disconnected_*     an Admin disconnected the machine from the store's page:
--                      its key no longer works and the enrolment no longer
--                      stands for a server (`POST .../server/disconnect`).
--
-- `sync_origin_credential.revoked_at` is the other half of a disconnect: the
-- credential row stays (the origin's history hangs on it, and a replacement
-- machine is enrolled under the same origin), its key is replaced by one nobody
-- holds, and this says why. The next approval for the origin clears it.
--
-- Every enrolment approved before this ran already has its data: it is marked
-- ready, so nothing that is working today is shown as "getting data".

ALTER TABLE node_enrolment
    ADD COLUMN bootstrap_at         timestamptz,
    ADD COLUMN bootstrap_from_seq   bigint CHECK (bootstrap_from_seq IS NULL OR bootstrap_from_seq >= 0),
    ADD COLUMN bootstrap_seq        bigint CHECK (bootstrap_seq IS NULL OR bootstrap_seq >= 0),
    ADD COLUMN bootstrap_failed     boolean NOT NULL DEFAULT false,
    ADD COLUMN bootstrap_report     jsonb,
    ADD COLUMN bootstrap_retried_at timestamptz,
    ADD COLUMN ready_at             timestamptz,
    ADD COLUMN disconnected_at      timestamptz,
    ADD COLUMN disconnected_by      text,
    ADD CONSTRAINT node_enrolment_first_data_follows_approval
        CHECK (
            (bootstrap_at IS NULL AND ready_at IS NULL AND NOT bootstrap_failed)
            OR COALESCE(outcome = 'APPROVED', false)
        ),
    ADD CONSTRAINT node_enrolment_disconnect_is_whole
        CHECK (
            (disconnected_at IS NULL) = (disconnected_by IS NULL)
            AND (disconnected_at IS NULL OR COALESCE(outcome = 'APPROVED', false))
        );

UPDATE node_enrolment
   SET bootstrap_at = decided_at,
       ready_at     = COALESCE(delivered_at, decided_at)
 WHERE outcome = 'APPROVED';

ALTER TABLE sync_origin_credential
    ADD COLUMN revoked_at timestamptz;

COMMENT ON COLUMN node_enrolment.bootstrap_seq IS
    'The command position (sync_command_cursor.next_seq) once the first data had been queued for the server. READY when sync_command_cursor.acked_seq reaches it.';
COMMENT ON COLUMN node_enrolment.ready_at IS
    'The first time the server had taken its first data and was sending heartbeats; head office is told once, then.';
COMMENT ON COLUMN sync_origin_credential.revoked_at IS
    'Head office disconnected the machine that held this credential (POST /api/v1/stores/{unit}/server/disconnect); its key was replaced. Cleared when a replacement is approved.';

-- Two notification kinds: a store's server was let in, and it is ready.
--
-- ADDED to whatever the check holds when this runs rather than written out in
-- full (see 0648): other lanes add kinds in the same hours, and a list copied
-- from an older migration would silently take theirs away again.
--
-- The check reads back in one of two forms, and this takes both. Until 0648
-- it was the `ARRAY['a'::text, ...]` of an `IN (...)`; 0648 wrote it as one
-- array literal, `'{a,b,...}'::text[]`, and that is what it is now. 0648's own
-- way of reading it would take that literal for a single kind.

DO $$
DECLARE
    def   text;
    kinds text[];
BEGIN
    SELECT pg_get_constraintdef(c.oid)
      INTO def
      FROM pg_constraint c
     WHERE c.conrelid = 'notification'::regclass
       AND c.conname = 'notification_kind_check';

    IF def IS NULL THEN
        RAISE EXCEPTION '0966: notification_kind_check is not where 0648 left it';
    END IF;

    IF def ~ '''\{[^}]*\}''' THEN
        kinds := string_to_array(
            replace((regexp_match(def, '''\{([^}]*)\}'''))[1], '"', ''), ',');
    ELSE
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
          INTO kinds
          FROM regexp_matches(def, '''([^'']+)''', 'g') AS m;
    END IF;

    IF kinds IS NULL OR cardinality(kinds) = 0 THEN
        RAISE EXCEPTION '0966: could not read the kinds from %', def;
    END IF;

    kinds := ARRAY(
        SELECT DISTINCT k
          FROM unnest(kinds || ARRAY['store.server.connected', 'store.server.ready']) AS k
         ORDER BY k
    );

    ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
    EXECUTE format(
        'ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind = ANY (%L::text[]))',
        kinds
    );
END
$$;
