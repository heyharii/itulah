-- 0157: A rule proposes a category, and the category knows the account.
--
-- # What was wrong, and why fixing it now is free
--
-- 0116 gave `bank_rule` its own `semantic_key` and `qualifier`, and
-- `bank_rule_proposal` its own copy of both. That was right when it was
-- written: there was nowhere else for a rule to point. With 0155 there is, and
-- leaving it would leave meaning declared in two places that can disagree.
--
-- Concretely: the seeded rule for `PAJAK BUNGA` points at `tax_on_interest`,
-- and so does the category `finance_tax_on_interest`. The day finance decides
-- PPh on jasa giro should go somewhere else, they repoint the category — and
-- the rule keeps proposing the old key, silently, because nothing connects
-- them. The rule would be right about which line it is and wrong about what
-- that line means, which is the worst of the two ways to be wrong: the
-- proposal still looks reasonable on the screen.
--
-- No rows exist outside these three seeds and nothing is merged, so this costs
-- an ALTER and three UPDATEs. In six months it costs a data migration over
-- somebody's real rule list, and a decision about what to do with the rules
-- whose key no category claims.
--
-- # Why an ALTER rather than editing 0116 where it stands
--
-- The obvious move — go back and write `category_code` into 0116 — cannot
-- work: 0116 runs before 0155, so the table it would reference does not exist
-- yet. Renumbering 0155 down below 0116 was the alternative and is worse:
-- migration numbers here are labels handed out by several sessions at once
-- (`migration_hygiene` says so at length), and moving one is how two of them
-- collide. So the column arrives here, after the master, and the seeds are
-- repointed in the same file that adds it.
--
-- # The direct key stays, as a fallback and nothing more
--
-- A rule may still name a key with no category behind it. That is not a
-- loophole, it is the honest state of a system whose category list is fifty
-- long and whose chart is seven thousand: somebody will need a rule for a
-- narration that means something nobody has made a category for yet, and the
-- alternative to letting them is making them invent a category to hold one
-- rule. What is refused is a rule that names NEITHER — a rule that proposes
-- nothing is a rule that recognises a line and then shrugs at it.
--
-- Where both are present the CATEGORY wins, and it wins in the query rather
-- than by a rule somebody has to remember: `bank_rules.rs` reads the key
-- through `COALESCE(c.semantic_key, r.semantic_key)`.

ALTER TABLE bank_rule
    ADD COLUMN category_code text REFERENCES transaction_category(code);

-- Now that a category can carry the meaning, the direct key is optional.
ALTER TABLE bank_rule ALTER COLUMN semantic_key DROP NOT NULL;
ALTER TABLE bank_rule DROP CONSTRAINT bank_rule_semantic_key_check;
ALTER TABLE bank_rule ADD CONSTRAINT bank_rule_semantic_key_check
    CHECK (semantic_key IS NULL OR btrim(semantic_key) <> '');
-- One or the other, and at least one. A rule with neither proposes nothing.
ALTER TABLE bank_rule ADD CONSTRAINT bank_rule_proposes_something
    CHECK (category_code IS NOT NULL OR semantic_key IS NOT NULL);

COMMENT ON COLUMN bank_rule.category_code IS
    'The meaning this rule proposes, in the words a person uses. Preferred over semantic_key, which stays for the rule whose narration no category covers yet.';
COMMENT ON COLUMN bank_rule.semantic_key IS
    'A meaning named directly, for a rule no category covers. Ignored when category_code is set; a rule must have one or the other.';

-- The proposal carries the category too, copied at the moment it was made for
-- exactly the reason it already copies the key: a rule that is later repointed
-- must not silently repoint every proposal a person has read and not yet acted
-- on. Two rules of provenance, not one — what the rule said, and what it said
-- it about.
ALTER TABLE bank_rule_proposal
    ADD COLUMN category_code text REFERENCES transaction_category(code);
ALTER TABLE bank_rule_proposal ALTER COLUMN semantic_key DROP NOT NULL;
ALTER TABLE bank_rule_proposal DROP CONSTRAINT bank_rule_proposal_semantic_key_check;
ALTER TABLE bank_rule_proposal ADD CONSTRAINT bank_rule_proposal_semantic_key_check
    CHECK (semantic_key IS NULL OR btrim(semantic_key) <> '');
ALTER TABLE bank_rule_proposal ADD CONSTRAINT bank_rule_proposal_proposes_something
    CHECK (category_code IS NOT NULL OR semantic_key IS NOT NULL);

COMMENT ON COLUMN bank_rule_proposal.category_code IS
    'The category the rule proposed, frozen when the proposal was made. Accepting posts through this, so repointing the rule afterwards cannot change what a person already agreed to.';

-- ---------------------------------------------------------------------------
-- The three seeds, repointed
-- ---------------------------------------------------------------------------
--
-- Same three lines, same three meanings, said once instead of twice. Each
-- category resolves to the key the rule used to name directly, so the accounts
-- these propose do not move; what moves is where the answer comes from.
--
-- The direct key is cleared rather than left beside the category. Leaving it
-- would leave the disagreement this migration exists to remove, sitting quietly
-- in three rows as the example everybody copies.

UPDATE bank_rule
   SET category_code = 'finance_tax_on_interest', semantic_key = NULL, qualifier = '',
       updated_by = 'migration', updated_at = now()
 WHERE rule_id = '9e1a0e4a-6c1f-4a05-9d4b-3f3f0a2b0001';

UPDATE bank_rule
   SET category_code = 'ops_bank_charges', semantic_key = NULL, qualifier = '',
       updated_by = 'migration', updated_at = now()
 WHERE rule_id = '9e1a0e4a-6c1f-4a05-9d4b-3f3f0a2b0002';

UPDATE bank_rule
   SET category_code = 'income_bank_interest', semantic_key = NULL, qualifier = '',
       updated_by = 'migration', updated_at = now()
 WHERE rule_id = '9e1a0e4a-6c1f-4a05-9d4b-3f3f0a2b0003';

-- A rule that proposes a category a person may not choose is a rule that only
-- ever produces refusals. It is not forbidden — a client who wants "recognise
-- the payroll transfer so it stops being unrecognised" gets exactly that, and
-- the proposal then says find the payroll payment — but it is worth being able
-- to see, so the read side reports it rather than the schema forbidding it.
COMMENT ON TABLE bank_rule IS
    'How to recognise a bank line nobody booked. A rule proposes a category; it never posts. Lowest priority number is asked first and the first match wins.';
