-- A promotion is a record somebody can talk about.
--
-- `commercial_rule` is a promotion: it has a table, a route
-- (`/api/v1/commercial/rules`) and a sheet in the hub, and that sheet has been
-- passing `commercial_rule` as its subject the whole time. It was simply not a
-- word `record_kind` knew, so its history filed itself under a kind nothing
-- else used and the panel on that sheet could only ever be empty.
--
-- # Why this is its own file and not a line added to 0190
--
-- Because 0190 had already been applied. It went onto `inventory_rfid` — a
-- shared development database several lanes on this branch point at — within
-- minutes of the file appearing on disk, by whichever server happened to boot
-- next. Editing it then was not a tidy-up: `sqlx::migrate!` compares the
-- checksum of the file against the one it stored, so the next boot answered
--
--     Error: Migration(VersionMismatch(190))
--
-- and the node would not start at all. Against the database it had already
-- migrated, for a one-line change.
--
-- The rule this is a reminder of is the one `migration_hygiene` states in
-- prose: a number that has been applied cannot be edited, because its checksum
-- is the thing being compared. "Applied" includes a colleague's laptop, and on
-- a repository several sessions work at once, a file on disk is applied the
-- moment anybody's server restarts.

-- One row per line, opening with the tuple, because that is the shape the
-- guard in `migration_hygiene` reads the vocabulary out of — and a kind it
-- cannot see is a kind it will report as missing.
INSERT INTO record_kind (code, label) VALUES
    ('commercial_rule', 'Promotion')
ON CONFLICT (code) DO NOTHING;
