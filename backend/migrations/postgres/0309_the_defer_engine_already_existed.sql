-- The defer engine already existed. This migration unburies it.
--
-- 0306 built `defer_schedule`/`defer_schedule_month` as the generalisation of
-- 0278's monthly spread. Reading `prepaid.rs` beside them shows the
-- generalisation was never missing:
--
--   * a schedule names ANY pair of accounts — prepaid asset and expense —
--     with their categories, frozen at write time ("a meaning resolved afresh
--     at posting time could send March somewhere February did not go");
--   * the monthly run (`prepaid_allocate`) is idempotent per month, keyed
--     twice over — the allocation row and the journal's own
--     (source_kind, source_id, purpose) — and closes the schedule when the
--     spread is spent;
--   * everything posts through the one door.
--
-- Two tables answering one question is the defect this chain keeps refusing
-- (0115, 0270, and the audit's §7). The tables 0306 added are empty — they
-- existed for minutes — and they go. The one real gap prepaid.rs has is its
-- gate: the prepaid side must be mapped to `prepaid_expense`, which is a
-- documented statement about tax (see the module note) rather than a missing
-- feature. Widening that gate is the prepaid lane's decision, on its file.
--
-- So 0305 (budget) and 0307 (health) stand; 0306's tables go, and the plan's
-- "mesin defer" item is recorded as ALREADY SATISFIED by `prepaid.rs`.

DROP TABLE IF EXISTS defer_schedule_month;
DROP TABLE IF EXISTS defer_schedule;
