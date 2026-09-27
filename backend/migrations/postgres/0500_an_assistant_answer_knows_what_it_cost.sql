-- 0500: an assistant answer knows what it cost, and the month has a ceiling.
--
-- The assistant now answers with Gemma 4 through OpenRouter (see
-- `cloud/http/assistant.rs`), which makes it the first thing on this node
-- that is paid for by the question. Three things follow, and each is data
-- rather than code so the owner changes them from a screen:
--
--   * Every answer keeps what it cost: the model and the host that produced
--     it, how many model calls the turn took, the tokens each way, and the
--     price the gateway reported. Without them "is this worth it" is a guess,
--     and the ceiling below would have nothing to count.
--   * `assistant_monthly_budget_usd` is the most the assistant may spend in
--     one local calendar month. A question asked past it is refused before a
--     token is spent. 0 stops the assistant. A finance setting because it is
--     a spending limit, and Accounts settings is where limits are changed.
--   * `POST /api/v1/assistant/ask` needs ADMIN, as a `role_permission` row
--     (0472): the owner asks first. Removing the row opens the question box
--     to supervisors, whose reads are cut to the site they are posted to; the
--     reads no per-site cut makes safe (the ledger, reports, the schema, SQL)
--     stay Admin-only in code either way.

ALTER TABLE assistant_message
    ADD COLUMN model             text,
    ADD COLUMN provider          text,
    ADD COLUMN rounds            integer CHECK (rounds >= 0),
    ADD COLUMN prompt_tokens     integer CHECK (prompt_tokens >= 0),
    ADD COLUMN completion_tokens integer CHECK (completion_tokens >= 0),
    ADD COLUMN cached_tokens     integer CHECK (cached_tokens >= 0),
    -- Millionths of a US dollar. An integer for the reason every amount in
    -- this schema is one; OpenRouter reports cost in credits, and a credit is
    -- one dollar.
    ADD COLUMN cost_usd_micros   bigint CHECK (cost_usd_micros >= 0);

COMMENT ON COLUMN assistant_message.cost_usd_micros IS
    'What the model calls behind this answer cost, in millionths of a US dollar, as the gateway reported it (0500). NULL on a question and on an answer from a gateway that reports no price.';

-- The ceiling is checked before every question by summing the month so far,
-- which should read an index rather than every transcript ever kept.
CREATE INDEX assistant_message_cost_by_time
    ON assistant_message (created_at)
    WHERE cost_usd_micros IS NOT NULL;

INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by) VALUES
    ('assistant_monthly_budget_usd', 10, 'USD',
     'The most the hub assistant may spend on its model in one local calendar month, in US dollars. A question past it is refused; 0 stops the assistant.',
     'migration:0500')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO role_permission (method, path_prefix, min_role, note, set_by) VALUES
    ('POST', '/api/v1/assistant/ask', 'ADMIN',
     'Admins only for now. Remove this to open the assistant to supervisors: their reads are cut to their own site, and the ledger, reports and SQL stay Admin-only in code.',
     'migration:0500')
ON CONFLICT (method, path_prefix) DO NOTHING;
