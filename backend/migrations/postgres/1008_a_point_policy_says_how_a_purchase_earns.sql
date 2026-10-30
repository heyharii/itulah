-- 1008: a point policy says how many member points a purchase earns.
--
-- Until this migration a member earned only what a promotion said: an
-- EARN_POINTS rule in the price book. There was no everyday rate a shop could
-- leave running, so a basket with no points promotion earned nothing.
--
-- The owner's rules (30 Oct 2026):
--
--   * the point policy is Marketing's, beside the return policy, and has the
--     same shape: one setting every article falls back to, and exceptions for
--     a division, tags or articles;
--   * an exception may be limited to some stores and to a run of dates;
--   * when a sale matches both the point policy and a points promotion, the
--     points ADD UP. Policy points plus promotion points — never the larger of
--     the two, and one never replaces the other.
--
-- The setting starts off: turning on an everyday rate is a decision, and a
-- deploy must not start paying points nobody announced.
--
-- The edge resolves per line, most specific first (article beats tag beats
-- division beats the setting), and takes the BEST rate — fewest rupiah per
-- point — among equally specific matches. A policy that says "earns nothing"
-- wins over any rate at its own level. Unlike the return policy a target may
-- sit in more than one policy, because two policies for the same tag in
-- different months or different stores are a calendar, not a contradiction.

CREATE TABLE point_policy_setting (
    singleton        smallint PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
    enabled          boolean NOT NULL DEFAULT false,
    -- Rupiah spent for one point.
    spend_per_point  bigint NOT NULL CHECK (spend_per_point BETWEEN 1 AND 100000000),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text
);

INSERT INTO point_policy_setting (singleton, enabled, spend_per_point)
VALUES (1, false, 10000);

CREATE TABLE point_policy (
    policy_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL CHECK (btrim(name) <> ''),
    scope_kind       text NOT NULL CHECK (scope_kind IN ('DIVISION', 'TAG', 'ARTICLE')),
    spend_per_point  bigint NOT NULL CHECK (spend_per_point BETWEEN 1 AND 100000000),
    -- False: the goods it covers earn no points from the policy (a promotion
    -- may still give them some).
    earns            boolean NOT NULL DEFAULT true,
    -- Empty: every store.
    site_ids         text[] NOT NULL DEFAULT '{}',
    starts_on        date,
    ends_on          date,
    active           boolean NOT NULL DEFAULT true,
    note             text,
    created_by       text NOT NULL CHECK (btrim(created_by) <> ''),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text,
    UNIQUE (policy_id, scope_kind),
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE point_policy_target (
    policy_id  uuid NOT NULL,
    scope_kind text NOT NULL CHECK (scope_kind IN ('DIVISION', 'TAG', 'ARTICLE')),
    scope_code text NOT NULL CHECK (btrim(scope_code) <> ''),
    PRIMARY KEY (policy_id, scope_code),
    FOREIGN KEY (policy_id, scope_kind)
        REFERENCES point_policy (policy_id, scope_kind) ON DELETE CASCADE,
    CHECK (btrim(scope_code) = scope_code)
);

CREATE INDEX ix_point_policy_target_code ON point_policy_target (scope_kind, scope_code);

COMMENT ON TABLE point_policy IS
    'A points rate for a division, tags or articles, optionally for some stores and dates. Adds to promotion points (owner, 30 Oct 2026).';
COMMENT ON COLUMN point_policy_setting.spend_per_point IS
    'Rupiah spent for one point, for every article no policy speaks for.';
