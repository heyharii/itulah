-- 0815: no uniform or ID card comes back at separation.
--
-- The owner dropped uniforms on 2026-09-30, and the company issues no ID
-- card. 0806 retired the two onboarding tasks; the separation checklist still
-- asked for both to be returned. Retired, not deleted: checklists already
-- opened keep the task as history.

UPDATE lifecycle_task_template
   SET retired_at = now(),
       retired = '{"actor": "system", "action_key": "people.lifecycle.manage", "at": "2026-10-01T00:00:00Z", "reason": "no uniforms and no ID card (owner, 2026-10-01)"}'
 WHERE id = 'seragam-kembali' AND retired_at IS NULL;
