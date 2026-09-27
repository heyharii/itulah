# The consistency catalogue

One file per rule. Each file is a `SELECT` that returns **the rows breaking the
rule**, so a healthy database returns nothing and whatever comes back is the
finding, already pointing at the rows.

This is the net under the rules, not the rules themselves. A rule belongs as
close to the data as it can go — a `CHECK`, a foreign key, a constraint trigger —
and the catalogue is for what cannot live there (sums across tables, one node
against another), plus a second look at what does, because a trigger can be
dropped by a migration and a table can be written with triggers off. Where each
rule is actually enforced is in `CONSISTENCY-MATRIX.md` at the repository root.

## Header

```sql
-- id: journal.entry_balances
-- severity: critical
-- rule: every journal entry balances (I3)
-- enforced: DB — constraint trigger journal_entry_balances (0051)
-- requires: journal_entry, journal_line
-- mutate: UPDATE journal_line SET debit_minor = debit_minor + 1 WHERE line_id = (SELECT line_id FROM journal_line WHERE debit_minor > 0 LIMIT 1)
SELECT ...
```

| key | meaning |
|---|---|
| `id` | unique, `area.name` |
| `severity` | `critical` (money or stock is wrong) · `high` (a rule the owner stated is broken) · `medium` · `low` |
| `rule` | the rule in one sentence, with its number in `FINANCE-HARD-RULES.md` when it has one |
| `enforced` | where the rule is enforced at write time — so a finding says which guard was bypassed |
| `requires` | tables the check reads; missing ones make the rule SKIP on an older database |
| `mutate` | one or more `INSERT`/`UPDATE`/`DELETE` statements (no `RETURNING`, one per line) that break the rule on a database holding data. Run with triggers off, always rolled back. |

## Running it

```bash
# read-only; safe on production
python3 scripts/check-invariants.py --db postgresql:///inventory_e2e

# prove every check can go red (local only; rolled back)
python3 scripts/check-invariants.py --db postgresql:///inventory_e2e --mutation-check
```

`backend/tests/invariant_catalogue.rs` runs every file against a freshly
migrated database — so a migration that renames a column the catalogue reads
turns a test red instead of turning a check into an `ERROR` on the night it is
needed — and runs the mutation check against data the real writers produced.
