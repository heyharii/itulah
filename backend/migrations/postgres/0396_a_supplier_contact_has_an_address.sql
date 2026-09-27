-- A contact person at a supplier can have an address of their own.
--
-- The supplier's export names a contact address beside the contact's name,
-- role, phone and email (owner, 2026-09-26): the person who takes the order
-- is not always at the company's registered address — a sales office, a
-- warehouse across town. Optional, like the rest of a contact's details.
ALTER TABLE supplier_contact ADD COLUMN address text;
