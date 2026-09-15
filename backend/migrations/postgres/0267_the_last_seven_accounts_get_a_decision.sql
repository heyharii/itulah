-- The last seven accounts get a decision.
--
-- After the semantic bridge (0264's siblings) and the four restored affiliate
-- natures, 178 of the chart's 185 postable accounts carry a policy from
-- `COA 162 Config`. Seven did not, and the reason was the same for all of them:
-- the workbook files each as `Hierarki — cek posting aktual` with no target — its
-- own way of saying somebody has to look.
--
-- Permissive is a fine state while migrating and a poor one to ship. So these are
-- owner decisions, written here rather than derived from a spreadsheet, and after
-- this no postable account sits on the default by accident.
--
--   1011302003  Prepaid - PPh Pasal 29        migration only. A balance that came
--               across and must not grow: the prepayment and the obligation
--               (0265) are two balances, and offsetting them is a tax return
--               nobody has filed. `OPENING` is the only document permitted.
--
--   3013001001  Modal Setor                   kept, controlled. Paid-in capital
--               moves rarely and by decision, so a person may key it — through an
--               approved correction, never a plain journal. The owner/principal
--               reference it will eventually carry does not exist yet.
--
--   3013001003  Laba (Rugi) bulan berjalan     system only. A generated result,
--               not equity anybody posts to. Nothing hand-keyed, at all.
--
--   3013001004  Prive                          kept, controlled. Owner drawings,
--               same shape as Modal Setor and the same future reference.
--
--   6010310018  Tools (Peralatan)              its family's policy, and the
--               identity question left open — see the note below.
--
--   7010216002  Biaya Amortisasi Pre Opening   system only, from the schedule.
--               `AMORTIZATION_RUN` (0266) and `OPENING`, and nothing else: there
--               is no pre-opening engine yet, so until there is, only the
--               migration reaches it.
--
--   8010110007  Pendapatan (Biaya) Lain-Lain   kept, controlled. Four meanings
--               land here — bad debt, other income and expense, disposal result,
--               cash variance — so rules must reach it. What must NOT happen is
--               it becoming the plug: `OVERRIDE` means a person needs an approved
--               correction rather than a journal line, which is the difference
--               between explaining a difference and hiding one.
--
-- # Tools (Peralatan): what the evidence does and does not say
--
-- The instruction was not to guess, and to inspect actual posting, balance and
-- history first. **None of those exist in anything available here.** The client's
-- export (`Laporan_Master_Account1.csv`) is a chart master: code, name, an
-- active flag, and the ladder. No balances, no transactions. So the question
-- "should this merge into Supplies, merge into R&M, or go dormant" cannot be
-- answered from it, and is not answered here.
--
-- What the chart DOES say, and it points one way:
--
--   * The client marks it ACTIVE (`Y`), as they mark all 25 of its family.
--   * Its immediate neighbours are `6010310016 Tire & Tubes`,
--     `6010310017 Fuel & Oil`, `6010310019 Lubrication & Grease / genset fuel`
--     and `6010310023 Vehicle licence` — a vehicle-and-plant consumables cluster.
--   * "Supplies" in their chart is elsewhere and means something else:
--     `6010310013 Perlengkapan Toko dan Kantor` and `6010110001 Customer
--     Supplies`.
--   * Repair and maintenance is a separate FAMILY, `6010410*` — FFE, software,
--     computer, building, staff house, vehicle, air-conditioning, lift. Those are
--     repairs OF an asset; a tool is a thing bought.
--
-- So on chart evidence the account stands on its own, and merging it into either
-- candidate would flatten a distinction the client themselves keeps. It is given
-- its family's policy — `SEMI_AUTO` / `YES`, which every one of the other 24
-- carries from the workbook — so it is classified rather than defaulted, and the
-- merge question stays open pending a trial balance or a general-ledger extract
-- for the account. That extract is the whole evidence needed; it is one query
-- against the client's own system.

UPDATE ledger_account SET posting_mode = 'AUTO_ONLY', manual_je_policy = 'NO'
 WHERE account_code IN ('1011302003', '3013001003', '7010216002');

UPDATE ledger_account SET posting_mode = 'MANUAL', manual_je_policy = 'OVERRIDE'
 WHERE account_code IN ('3013001001', '3013001004', '8010110007');

UPDATE ledger_account SET posting_mode = 'SEMI_AUTO', manual_je_policy = 'YES'
 WHERE account_code = '6010310018';

-- And the documents the two migration-only accounts accept, which is what makes
-- "no normal posting path" a refusal rather than a note.
INSERT INTO account_source_rule (account_code, source_kind, effect, set_by, note) VALUES
    ('1011302003', 'OPENING', 'ALLOW', '0267',
     'migration only: the prepayment came across and must not grow. Offsetting it against 2012101006 is a tax return nobody has filed.'),
    ('7010216002', 'AMORTIZATION_RUN', 'ALLOW', '0267',
     'from the pre-opening schedule, once there is one'),
    ('7010216002', 'OPENING', 'ALLOW', '0267',
     'and the migration, which is the only thing that reaches it today')
ON CONFLICT (account_code, source_kind) DO NOTHING;
