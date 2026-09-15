-- 0156: A slip remembers what explained it, not only where it landed.
--
-- # What was missing
--
-- `cash_document` (0115) records the two accounts and nothing about the
-- judgement behind them. That is enough to post and not enough to read back:
-- "what did we spend on couriers this quarter" becomes a question about
-- account codes, which means answering it correctly depends on nobody ever
-- having mapped two meanings onto one leaf — and the client's chart has at
-- least one leaf carrying two (`8010110007 Pendapatan (Biaya) Lain-Lain` is
-- both other income and the gain on disposing of an asset).
--
-- The category is the meaning; the account is where the meaning happens to be
-- filed this year. Keeping only the second is keeping the derived half.
--
-- # Nullable, and staying that way
--
-- Documents that predate categories exist, and documents that will never have
-- one exist too: a supplier payment's slip is explained by the bill it settles,
-- not by a category, and forcing one on it would mean inventing a category that
-- means "see the other document". So this is a label a document may carry, and
-- the refusal that matters — a bank line may not become a salary expense — sits
-- on `transaction_category.bank_postable` where it can be read, not here as a
-- NOT NULL that would only make drafts harder to key.
--
-- # Why the posted-document guard is not extended to it
--
-- `protect_posted_cash_document` freezes the amounts, the accounts, the number
-- and the entry, because the journal quotes them. It deliberately does NOT
-- freeze the memo, and this belongs on the same side of that line: correcting a
-- category is correcting a label on evidence that has not moved. What a
-- correction must not do is move money, and none of this can.

ALTER TABLE cash_document
    ADD COLUMN category_code text REFERENCES transaction_category(code);

COMMENT ON COLUMN cash_document.category_code IS
    'The meaning a person explained this by, when one did. The accounts say where it landed; this says what it was, and survives the account being remapped.';

-- Partial: most documents will carry one and the question asked of this index
-- is always "what was spent on X", never "what has no category".
CREATE INDEX ix_cash_document_category
    ON cash_document (category_code, doc_date DESC)
    WHERE category_code IS NOT NULL;
