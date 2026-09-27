-- 0383: The clock tells head office what lapses.
--
-- Four things already have a date and a screen that computes their standing on
-- read, and nothing that tells anybody when the date comes near:
--
--   * a GA contract inside its own `reminder_days` (0360) — the contracts
--     screen says SEGERA_HABIS, to whoever happens to open it;
--   * a filed paper whose `expires_on` (0358) is close — the GA overview lists
--     it, and the STNK still lapses if nobody looks that week;
--   * a posted supplier bill whose next instalment falls due this week (0202);
--   * a tax month whose payment (the 15th) or return (the 20th, or month end
--     for PPN) is near or just passed (0279, PMK 81/2024).
--
-- `domain::reminder` decides each band and `postgres::reminders` raises it
-- once per subject, date and band, claimed through `scheduled_job_run` (0363)
-- like the HR nudges. These are the kinds that pass raises. A notification kind
-- is a closed set (0217) because the browser routes on it, so adding one is a
-- migration.
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
        'finance.tax.deadline'
    ));

-- The HR nudges were raised under their JOB names (`nudge.contract_expiry`)
-- rather than the kinds 0363 added (`people.contract.expiring`), so the check
-- above refused every one of them. The period and roster nudges stamped their
-- claim FAILED and will retry on their own. The contract nudge claimed per
-- person and did not: its rows sit as RAN with no finish, which reads as work
-- done. Mark those FAILED so the next pass re-claims them and the notice is
-- finally raised.
UPDATE scheduled_job_run
   SET outcome = 'FAILED',
       detail = jsonb_build_object('error', 'raised under the job name, refused by notification_kind_check (fixed in 0383)'),
       finished_at = now()
 WHERE job = 'nudge.contract_expiry'
   AND outcome = 'RAN'
   AND finished_at IS NULL;
