-- Drafts can be discussed, tagged, and audited before they are posted.
INSERT INTO record_kind (code, label)
VALUES ('journal_draft', 'Journal draft')
ON CONFLICT (code) DO NOTHING;
