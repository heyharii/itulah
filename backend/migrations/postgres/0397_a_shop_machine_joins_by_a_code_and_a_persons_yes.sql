-- A shop machine joins the fleet by a one-time code and a person's yes.
--
-- Until now a node was registered by somebody holding the master sync key:
-- `provision-store.sh`, or the hub's "Register a node" sheet, generated an
-- ingest key, sent it to `/sync/origins`, and printed it for a person to paste
-- onto the shop's box. The long-lived secret passed through human hands every
-- time, and the master key through a browser.
--
-- An enrolment replaces that with three steps, each its own columns:
--
--   1. ISSUED  — an Admin asks for a code for one site and role. Only the
--                code's SHA-256 is kept; the code is shown once.
--   2. CLAIMED — the machine sends the code with the SHA-256 of an ingest key
--                it minted itself, and what it says about itself. The code is
--                spent. The verification number derived from the code and the
--                key digest is kept so the hub can show it.
--   3. decided — an Admin approves (the origin is registered with the claimed
--                digest, at generation 1 or one past the machine it replaces),
--                rejects, or revokes.
--
-- See `backend/src/sync/enrolment.rs` for the protocol and
-- `STORE-SERVER-PLAN.md` §2 for why there are three secrets.
--
-- `origin_id` is not a foreign key to `sync_origin_credential`: the origin
-- does not exist until approval creates it, and a rejected enrolment must
-- leave no origin behind.

CREATE TABLE node_enrolment (
    enrolment_id      uuid PRIMARY KEY,
    site_id           text NOT NULL REFERENCES site(id),
    origin_id         text NOT NULL CHECK (btrim(origin_id) <> ''),
    node_role         text NOT NULL CHECK (node_role IN ('STORE', 'DC')),
    label             text,

    code_sha256       text NOT NULL UNIQUE,
    issued_by         text NOT NULL,
    issued_at         timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,

    claimed_at        timestamptz,
    key_sha256        text,
    verification      text,
    machine           jsonb,
    claimed_from      text,

    outcome           text CHECK (outcome IN ('APPROVED', 'REJECTED', 'REVOKED')),
    decided_by        text,
    decided_at        timestamptz,
    -- The generation the origin was registered at on approval: 1 for a first
    -- machine, one past the old one for a replacement.
    active_generation bigint,
    -- When the machine first read its approval. An approved enrolment the
    -- machine never picked up is a box that is still waiting, not a node.
    delivered_at      timestamptz,

    CONSTRAINT node_enrolment_expires_after_issue CHECK (expires_at > issued_at),
    -- A claim is all or nothing: the digest, the number and the time together.
    CONSTRAINT node_enrolment_claim_is_whole CHECK (
        (claimed_at IS NULL AND key_sha256 IS NULL AND verification IS NULL)
        OR (claimed_at IS NOT NULL AND key_sha256 IS NOT NULL AND verification IS NOT NULL)
    ),
    CONSTRAINT node_enrolment_decision_is_whole CHECK (
        (outcome IS NULL) = (decided_at IS NULL)
        AND (outcome IS NULL) = (decided_by IS NULL)
    ),
    -- Only a claim can be approved: approval registers the claimed key.
    CONSTRAINT node_enrolment_approval_needs_a_claim CHECK (
        outcome IS DISTINCT FROM 'APPROVED'
        OR (claimed_at IS NOT NULL AND active_generation IS NOT NULL)
    ),
    CONSTRAINT node_enrolment_delivery_follows_approval CHECK (
        delivered_at IS NULL OR outcome = 'APPROVED'
    )
);

-- One undecided enrolment per origin. Issuing a new code revokes the old one
-- in the same transaction, so a site never has two machines racing to become
-- it.
CREATE UNIQUE INDEX ux_node_enrolment_open_per_origin
    ON node_enrolment (origin_id) WHERE outcome IS NULL;

CREATE INDEX ix_node_enrolment_recent ON node_enrolment (issued_at DESC);
