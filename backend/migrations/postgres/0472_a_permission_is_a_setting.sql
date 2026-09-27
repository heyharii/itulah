-- 0472: a permission is a setting, and so is an approval threshold.
--
-- Stage 6 of "Desain Fondasi Finance Dinamis", ERPNext's Role Permission
-- Manager and Workflow. Which role may call what was code
-- (`domain::auth::required_role`), and so were the amounts above which a
-- second person has to sign. Now:
--
--   * `role_permission` overrides the code's answer for a method and a path
--     prefix. The most specific prefix wins, an exact method beats `*`, and a
--     path no override covers keeps the code's default. The three roles stay
--     the ones Edge and Store speak (CASHIER, SUPERVISOR, ADMIN).
--   * Approval thresholds are finance settings: the store-expense amount a
--     store manager may approve alone, and the manual-journal amount from
--     which the person who drafted an entry may not also post it.

CREATE TABLE role_permission (
    method      text NOT NULL CHECK (method IN ('*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
    path_prefix text NOT NULL CHECK (path_prefix LIKE '/api/%'),
    min_role    text NOT NULL CHECK (min_role IN ('CASHIER', 'SUPERVISOR', 'ADMIN')),
    note        text,
    set_by      text NOT NULL CHECK (btrim(set_by) <> ''),
    set_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (method, path_prefix)
);

COMMENT ON TABLE role_permission IS
    'ERPNext Role Permission Manager (0472): the minimum role for a method and path prefix, overriding domain::auth::required_role. Most specific prefix wins; exact method beats *.';

INSERT INTO finance_setting (setting_key, value_numeric, unit, note, set_by) VALUES
    ('store_expense.manager_limit_minor', 500000, 'IDR',
     'A store manager (SUPERVISOR) approves a store expense up to this amount; above it head office finance (ADMIN) does.',
     'migration:0472'),
    ('journal.two_person_from_minor', 0, 'IDR',
     'From this total, the person who drafted a manual journal may not also post it; 0 turns the rule off.',
     'migration:0472')
ON CONFLICT (setting_key) DO NOTHING;
