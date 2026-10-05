-- id: finance.external_party_at_head_office
-- severity: high
-- rule: a unit never holds a supplier payable or a lender (2002, 2004, 2035–2040, 2043–2048); only an OPENING entry may carry history there (I4)
-- enforced: DB — trigger journal_line_external_party_is_head_office (0376, narrowed 0380; by the unit's kind since 0605); Rust validate_account_posting (dimension = company)
-- requires: journal_entry, journal_line, external_party_account, unit
-- mutate: UPDATE journal_line SET unit_id = (SELECT id FROM unit WHERE kind <> 'HO' ORDER BY id LIMIT 1) WHERE line_id = (SELECT l.line_id FROM journal_line l JOIN external_party_account x USING (account_code) ORDER BY l.line_id LIMIT 1)
SELECT l.entry_id, e.entry_number, e.source_kind, l.line_number, l.account_code, x.kind, l.unit_id
  FROM journal_line l
  JOIN external_party_account x ON x.account_code = l.account_code
  JOIN journal_entry e ON e.entry_id = l.entry_id
 WHERE l.unit_id IS DISTINCT FROM head_office_unit_id()
   AND e.source_kind <> 'OPENING'
   AND NOT (e.source_kind = 'REVERSAL'
            AND EXISTS (SELECT 1 FROM journal_entry o WHERE o.entry_id = e.reversal_of AND o.source_kind = 'OPENING'))
