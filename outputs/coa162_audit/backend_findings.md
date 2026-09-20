# Backend coverage audit — COA 162

Date: 2026-09-15  
Workbook: `/Users/hari/Downloads/Retail_OS_COA_v1_162_Merged_Master.xlsx`  
Backend: Rust/Axum `cloud` binary, PostgreSQL, Render service declared as `itulah-cloud.onrender.com`.

## Access and interpretation

The cloud health endpoint was live (HTTP 200, authentication enabled). Every finance read attempted without a session returned HTTP 401: account list, account map, periods, trial balance and attention. No production bearer or direct database connection was available. The two edge hosts checked were suspended (HTTP 503). Therefore `cloud_account_presence` is `unverified` for all 162 workbook rows.

The `status` field in [backend_coverage.json](./backend_coverage.json) is code-level implementation coverage only:

- `covered`: an active backend posting path uses a semantic key for the business meaning.
- `partial`: a related key or generic direct-account route exists, but an event, qualifier, policy, control or reconciliation dependency is missing.
- `missing`: no corresponding key or source posting path was found.
- Exact workbook 7-digit code matches are false: the backend chart is the client's imported legacy chart, mostly 10-digit codes, resolved through `account_map`.

## Result

- **covered**: 40\n- **partial**: 89\n- **missing**: 32\n- **unverified**: 1

## Material backend findings

1. **Chart identity mismatch.** The workbook's 162 seven-digit design codes are not the deployed chart's code identity. The backend imports the client's legacy chart and resolves semantic meanings through `account_map` ([0050_ledger.sql](../../backend/migrations/postgres/0050_ledger.sql), [ledger.rs](../../backend/src/cloud/postgres/ledger.rs)). A legacy hint is not evidence that a corresponding 162 code exists in production.
2. **Production mapping and account flags are unverified.** Without an authenticated read, no row-level check is possible for `ledger_account.is_active`, `is_group`, `account_map`, site/qualifier coverage, journals, balances, or live module events.
3. **Sales/COGS gap.** `sale_day.rs:590-652` posts tender receivables/fees, revenue and output VAT, while its own comments say COGS is outside the entry. COA 5101001 is consequently partial until an inventory cost-of-sale event is demonstrated.
4. **Revenue tender gap.** Migration 0255 adds the client's tender revenue leaves but deliberately leaves them unbound because acquirer/card-kind data is empty. COA 4101001 is conditionally covered; per-tender correctness remains blocked.
5. **Voucher, affiliate and loan gaps.** Voucher settlement exists but issuance is absent; affiliate keys are declared but payables states no rule writes them; loan principal and interest keys are declarations without a loan/lease schedule poster.
6. **Tax gaps.** Input VAT and output VAT have posting paths. PPh 21/23/25/29, PBB and current income tax accounts have no corresponding semantic/source posting implementation in the inspected backend.
7. **Pre-opening and reserve gaps.** 1202802/1202892 have no semantic/schedule implementation. 1202691 has a replacement-reserve charge path, but formation policy is explicitly pending. Do not import an unfiltered opening balance or infer correctness from account presence.
8. **Generic expense fallback.** Many 610*/710* rows can be named by the generic expense-bill direct-account path. That gives a postable leaf with a supplier/document row, but does not prove account-specific automation, normal-balance enforcement, or a dedicated subledger.

## Invariants that are implemented in code/schema

The inspected schema and poster enforce leaf-only foreign-key posting, active/postable checks before posting, one debit or credit per line, balanced entries, open periods, required site dimension and supplier reference where provided, semantic resolution and append-only journal corrections. These invariants make bad rows fail; they do not create missing account mappings or source events.

## Required production read-only evidence

A final coverage claim needs an authenticated snapshot/query of:

`ledger_account` (all 162 semantic targets/legacy counterparts, `is_group`, `is_active`, parent, root, dimension, site), `account_map` (semantic key, qualifier, site, account code, set_by), finance journal lines and entries by account/source/rule, fiscal periods, and source-module/subledger controls for sales, inventory/COGS, AP, tax, fixed assets, loans and vouchers. Capture the deployment commit/image digest and migration version alongside the snapshot.

The JSON contains one row for every workbook account with its static status, required dimensions and concrete evidence references/blocker.

