-- A tax month is a thing a notification can be about.
--
-- The tax deadline reminder (`reminder.tax_deadline`, reminders.rs) tells
-- head office that a month's PPh or PPN is due or late, and names the
-- `tax_period` row (0279) as the notification's subject so the bell can
-- point at the month. `record_kind` never carried the kind, so the insert
-- died on `notification_subject_kind_fkey` (0190) on every run: the claim was
-- stamped FAILED, retried a minute later, failed again, and nobody was told
-- that a tax payment was late (found on the demo rig, 17 Oct 2026).
--
-- A tax month is its own record — a fiscal period closes the books, a tax
-- period is what is owed to the state for one tax in one month — so it is
-- registered under its own word, as 0314 did for the integrity checks, rather
-- than filed under a kind that means something else. `RecordKind::TaxPeriod`
-- learns it in the same change; `migration_hygiene` compares the two.

INSERT INTO record_kind (code, label) VALUES
    ('tax_period', 'Tax period')
ON CONFLICT (code) DO NOTHING;
