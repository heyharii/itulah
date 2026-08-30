-- Multi-store sync (30 stores -> one cloud).
--
-- Two additions on the RECEIVING side:
--
-- 1. Per-origin ingest credentials. A single shared key cannot tell stores
--    apart, so any compromised store could upload facts claiming another
--    store's origin_id. A registered origin is only accepted with ITS key
--    (stored as a SHA-256 digest, never plaintext); unregistered origins fall
--    back to the master SYNC_INGEST_KEY for bootstrap/demo.
--
-- 2. The apply watermark. Receipt (sync_ingest_watermark) proves transport;
--    application proves the fact reached this node's ledger. They are separate
--    contiguous prefixes per stream — a transport receipt must never
--    masquerade as a domain effect. `blocked_*` is pure observability: the
--    applier always retries from applied_seq + 1, so a block heals itself the
--    moment its cause (usually missing master data) is fixed.

CREATE TABLE sync_origin_credential (
    origin_id         text PRIMARY KEY,
    ingest_key_sha256 text NOT NULL,
    label             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    rotated_at        timestamptz
);

CREATE TABLE sync_applied_watermark (
    origin_id      text NOT NULL,
    generation     bigint NOT NULL,
    applied_seq    bigint NOT NULL DEFAULT 0 CHECK (applied_seq >= 0),
    blocked_at_seq bigint,
    blocked_reason text,
    blocked_since  timestamptz,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origin_id, generation)
);
