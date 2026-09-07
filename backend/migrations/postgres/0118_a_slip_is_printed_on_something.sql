-- 0118: A slip is printed on something.
--
-- A Bukti Kas Keluar is a piece of paper that leaves the building. It carries
-- the company's name, its address and a telephone number at the top, the
-- document's own number and date, the two accounts, the amount in figures and
-- again in words, and three signature blocks — dibuat, diperiksa, disetujui.
--
-- Everything but the first line comes from the document. The first line has to
-- come from somewhere, and the two obvious somewheres are both wrong:
--
--   * A constant in Rust means the client's own address is in a release, and
--     the day they move office somebody has to ship a binary to print a slip.
--   * A general settings table means a screen of key/value pairs where a typo
--     in a key silently stops the letterhead appearing at all.
--
-- So: one table, one row, three columns that are exactly the three lines the
-- paper has. It is seeded with the header printed on the client's own chart of
-- accounts export (`Laporan_Master_Account1.csv`, rows 2-4), which is the same
-- header their existing system prints on every document.

CREATE TABLE company_letterhead (
    -- One row, enforced. A second letterhead would be a second answer to
    -- "whose paper is this", and nothing would say which to print.
    only_row  boolean PRIMARY KEY DEFAULT true CHECK (only_row),

    name      text NOT NULL CHECK (btrim(name) <> ''),
    address   text NOT NULL,
    phone     text NOT NULL,

    set_by    text NOT NULL DEFAULT 'migration' CHECK (btrim(set_by) <> ''),
    set_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO company_letterhead (name, address, phone)
VALUES ('CENTRAL FASHION STORE', 'JL. Moh Yamin No. 1', '0747 322806');

COMMENT ON TABLE company_letterhead IS
    'The three lines printed at the top of a cash slip. One row, because a company has one letterhead; seeded from the header on the clients own chart of accounts export.';
