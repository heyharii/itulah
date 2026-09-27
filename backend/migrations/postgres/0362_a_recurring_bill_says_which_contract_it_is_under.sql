-- 0362: a recurring bill says which contract it is under.
--
-- A recurring bill is the FINANCE side of a contract General Affairs holds:
-- the electricity subscription, the shop lease, the cleaning service each
-- raise the same invoice every month, and 0316's template already promises
-- that invoice. What the template could not say until now is WHOSE promise it
-- is serving — this column is the pointer, and it is what makes "billed for
-- this contract" a COUNT of rows instead of a copy of an amount someone
-- keeps in step by hand (brief §8.1; the per-month figure stays the
-- template's own, from 0316 — nothing here duplicates it).
--
-- Nullable: plenty of recurring bills answer to nobody's contract — the
-- water for a yard with no deal behind it, an alarm service nobody filed.
-- A contract is one REASON a bill recurs, not the only one.
ALTER TABLE bill_template
    ADD COLUMN contract_id uuid REFERENCES ga_contract (contract_id);
