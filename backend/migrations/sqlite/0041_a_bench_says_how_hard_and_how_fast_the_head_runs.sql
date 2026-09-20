-- Darkness and speed belong to the machine, not to the job.
--
-- They describe the ribbon, the stock and the head — things that change when
-- somebody loads a reel and never because of what is being printed. Kept on the
-- session anyway, because a session is the only record of what a pass was
-- actually told: the node cannot read these back from a printer over a one-way
-- queue, so without this column a label that came out too light has no evidence
-- of what was asked for.
--
-- Nullable on purpose. Absent means "leave the machine on whatever it was
-- calibrated to", which is the honest default when the stored value is
-- unreadable; a NOT NULL with a default would overwrite a bench's own setting
-- the first time anybody pressed Print.
ALTER TABLE print_session ADD COLUMN darkness INTEGER;
ALTER TABLE print_session ADD COLUMN speed_ips INTEGER;
