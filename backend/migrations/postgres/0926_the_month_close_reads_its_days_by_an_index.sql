-- The month close reads one calendar month of till sales — a distinct
-- (site, day) pair per shop that traded. A half-open range on business_date
-- answers from an index; the EXTRACT(YEAR/MONTH) spelling it replaces could
-- only be answered by scanning the whole book, which at a million sales a
-- year means a full read of the till ledger on every close screen.
CREATE INDEX ix_edge_sale_business_date_site
    ON edge_sale (business_date, site_id);
