-- id: finance.company_accounts_at_head_office
-- severity: high
-- rule: an account whose dimension is 'company' posts only in head office's books — the whole set, not only the external-party registry (1016, 1017, 1018, 2033, 6002 are Rust-only today)
-- enforced: Rust validate_account_posting (ledger.rs, dimension = company, no OPENING exemption); DB covers only the external_party_account subset
-- requires: journal_entry, journal_line, ledger_account, unit
-- mutate: UPDATE journal_line SET unit_id = (SELECT id FROM unit WHERE kind <> 'HO' ORDER BY id LIMIT 1) WHERE line_id = (SELECT l.line_id FROM journal_line l JOIN ledger_account a USING (account_code) WHERE a.dimension = 'company' ORDER BY l.line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, a.name, l.unit_id
  FROM journal_line l
  JOIN ledger_account a ON a.account_code = l.account_code
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE a.dimension = 'company'
   AND l.unit_id IS DISTINCT FROM head_office_unit_id()
   AND e.source_kind NOT IN ('OPENING', 'REVERSAL')
