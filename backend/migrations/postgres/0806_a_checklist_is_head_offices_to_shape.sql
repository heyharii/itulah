-- 0806: the onboarding and separation checklists are head office's to shape.
--
-- 0359 seeded eight onboarding tasks and no way to change them. Talenta's
-- Onboarding checklist is a list the company writes, so the templates gain
-- the same retirement every master here has: a task nobody does any more is
-- retired, never deleted — the checklists already opened keep it, as history.
--
-- The two uniform tasks are retired here: the owner dropped uniforms on
-- 2026-09-30 ("kita ga butuh seragam").

ALTER TABLE lifecycle_task_template
    ADD COLUMN defined     jsonb,
    ADD COLUMN retired_at  timestamptz,
    ADD COLUMN retired     jsonb,
    ADD CONSTRAINT lifecycle_task_template_retirement_is_signed
        CHECK ((retired_at IS NULL) = (retired IS NULL));

UPDATE lifecycle_task_template
   SET retired_at = now(),
       retired = '{"actor": "system", "action_key": "people.lifecycle.manage", "at": "2026-10-01T00:00:00Z", "reason": "uniforms dropped by the owner, 2026-09-30"}'
 WHERE id IN ('size', 'seragam');
