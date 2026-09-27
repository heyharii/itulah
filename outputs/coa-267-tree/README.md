# 267-account tree proposal

This review bundle is generated from the supplied account tree and client workbook. Migrations 0348–0350 have been applied to the local `inventory` and `inventory_marketing_dogfood` databases. Migration 0349 was applied as the ordered prerequisite to 0350.

## Structure

- 8 existing statement roots (`1`–`8`), 45 new groups, and 267 posting leaves (320 nodes including roots).
- Proposed codes are four digits for every new group and posting account. The first digit preserves the client statement class; `parent_code` defines the actual tree.
- All 43 currently active four-digit account codes are reserved and are not reused. Historical journal lines can keep referencing them.
- New codes are allocated in chart order within each root class, skipping reserved account numbers.

## Source matching

- Client workbook rows read: 7,528 unique account codes. The 267 leaves have 264 direct name matches and 3 reviewed aliases.
- `source-match-review.csv` records candidate source codes and the selected match. Duplicate labels are compared against ancestor names in the source hierarchy. The two goods-in-transit leaves map to the client family branches `1011203` and `1011204`; site and counter-site remain separate journal dimensions.
- 261 leaves have all 14 site-coded source variants and are unit-scoped. Six leaves have no site-coded variants and are provisionally company/HQ scoped; Finance should confirm those six before opening balances are loaded. `requires_counterparty_candidate` is true for the two goods-in-transit accounts and inter-unit affiliate receivables/payables.
- Contra and normal-balance columns are candidates derived from account class and name. `Selisih pembulatan` and `Pendapatan (Biaya) Lain-Lain` keep a null normal balance until Finance decides their direction; posting does not enforce that field.

## Cutover boundary

- The existing 43 four-digit posting accounts, the separate `6010210014 Klaim Karyawan` account, and old intermediate headings retain their codes as inactive history; historical journals are not reassigned by changing account names or codes. The eight statement roots remain active alongside the replacement groups.
- Migration 0346 adds a central gate seeded with automatic posting off. Migration 0348 installs the new chart and crosswalk, preserving the former account codes as inactive history and hiding legacy headings from the active chart. While the gate is off, source-document operations that depend on automatic journals return a conflict and roll back. Migration 0350 also enforces the pause at the database journal boundary, including for older app processes; `MANUAL` entries and explicit `REVERSAL` requests remain allowed. Existing account mappings remain pointed at their old inactive accounts until Finance remaps them.
- Existing journal entries keep their old codes and amounts. A reviewed opening/reclassification journal is still needed before old balances appear under the new leaves.

## Files

- The source workbook has 6,908 posting codes: 6,894 map to the 267 leaves. The remaining 14 `Laba (Rugi) bulan berjalan` codes are derived results and intentionally have no posting account.
- `source-match-review.csv`: source-code match candidates for each target leaf.
- `client-source-account-crosswalk.csv`: all 6,908 source posting accounts, including site and goods-in-transit counter-site.

Source: `Pasted text.txt` supplied in the conversation and `Laporan_Master_Account1 (1).xlsx` supplied in the conversation.
