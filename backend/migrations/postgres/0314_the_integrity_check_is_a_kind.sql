-- The integrity checks are a thing a notification can be about.
--
-- `notify_transition` (integrity.rs) raises a notification whose subject is
-- the check that crossed -- `('integrity_check', key)` -- and the insert has
-- been dying on `notification_subject_kind_fkey` ever since the constraint
-- arrived (0190): `record_kind` never carried the kind. The failure ate the
-- nightly run's own news -- a check crossing into EXCEPTION or BLOCKED told
-- nobody, and the run recorded nothing, because the notification's refusal
-- rolled the crossing back.
--
-- The kind is real and the checks are permanent estate: register it rather
-- than point the writer at a kind that means something else.

INSERT INTO record_kind (code, label)
VALUES ('integrity_check', 'Integrity check')
ON CONFLICT (code) DO NOTHING;
