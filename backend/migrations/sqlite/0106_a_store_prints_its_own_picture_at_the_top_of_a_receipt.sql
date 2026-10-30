-- 0106: the picture at the top of this store's receipts (postgres 1009).
--
-- It arrives on the auth policy (`AuthPolicySnapshot.receipt_header`) as the
-- two widths the paper has, one bit a dot, and is stored whole. `render`
-- prints it in place of CENTRAL, the shop's name and its address.
CREATE TABLE IF NOT EXISTS receipt_header_state (
    singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
    version      INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
