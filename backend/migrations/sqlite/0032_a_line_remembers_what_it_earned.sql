-- 0032: A line remembers what it earned.
--
-- The till's copy. See the Postgres migration `0166`: a basket total can credit
-- an account and cannot debit one, because a return takes back one line's
-- points and dividing a total guesses at which.
ALTER TABLE sale_line ADD COLUMN points_earned INTEGER;
