# GA coverage audit against the three client workbooks

17 October 2026. Read-only review of supplied workbooks and local code. No import, cloud mutation, financial posting or production change was performed. Prototype coverage is not evidence that the corresponding cloud workflow exists or that live data has been imported.

Follow-up: the subsequently completed local prototype work is documented in `ga-prototype-coverage.md` under “Completed additions after owner scope decisions”. It addresses the prototype gaps in projects, reminders, utilities, operating receipts, quantity handovers and integrated rich letter writing. The production findings below remain separate; the original workbooks were not changed.

## Conclusion

The compact ten-menu structure can remain. The current prototype demonstrates the principal relationships, but it is not a complete GA operating system and has not passed every combination of end-to-end workflows. Asset taxonomy coverage is considerably stronger than workflow coverage.

### Owner scope decisions after this audit

- Business travel belongs to HR. Do not add a GA trip/request workflow; Finance still owns advances and settlement as applicable.
- Physical fixed-asset counts / stocktake are excluded. They are not a GA backlog requirement. Quantity and partial handover of grouped items remain a separate issue from stocktaking.
- Reminders are required. Attach them to the underlying obligation, its responsible person and its due date/reading, rather than creating a separate reminder for every menu containing the same record.
- Proposed renovation entry: Assets → Projects, presenting the operational work while linking the same existing Finance contractor-project record. Do not create a second project or independently accumulated CIP balance.

The rich letter writer was not deleted. `letter-writer-prototype.html` and `frontend-hub/src/screens/letters/{writer,editor}.tsx` remain; `letters.tsx` still renders `WrittenLetter` for the written forms. The GA relations prototype currently uses a simplified form/paper preview. Its new item references have not been merged into that rich writer. Preserve the rich writer and extend its item picker/side panel when implementing this proposal.

## Workbook evidence

| Source | Observed structure and implications |
| --- | --- |
| `/Users/hari/Downloads/Laporan_Master_Account1.xlsx` | Sheet `Laporan_Master_Account1`: 7,528 unique account codes. Names repeat by unit; accounts do not imply 7,528 separate features or menus. |
| `/Users/hari/Downloads/MASTER ASSET.xls` | Sheet `#.Var1#.19`, rows 10–1351: 1,342 register rows; 44 type labels; 668 rows classified Contract In Progress; 92 rows have quantity greater than one; 3 have zero quantity. All department values are `-`. Names include grouped and mixed entries. These rows are not a complete physical inventory with identified serials/custodians. |
| `/Users/hari/Downloads/Daftar asset.xls` | Sheet `ASSET_LIST`: 57 numbered class entries in rows 10–80, plus later annotations at rows 660/669. This is a class/depreciation layout, not another 57 individual assets. |

The prototype's 59 class names match the 59 corresponding class labels in the account workbook after ignoring case, spacing and punctuation: fixed assets (`10215…`), the two software classes (`1021701…`), Pre Opening (`1031802001`) and CIP (`1031803001`). Accumulated amortization is not an additional asset class. This establishes label coverage, not correct import, individual asset identification or complete lifecycle support.

The older class workbook disagrees with the account workbook in specific places:

| Older class list | Account workbook / current catalog | Treatment |
| --- | --- | --- |
| Boiler, row 24 | Eskalator, account `1021504003` | Different equipment; do not silently rename one to the other. Verify whether boiler still belongs in the current catalog. |
| Hanger Underware, row 74 | Hanger Gamis / Ibu, `1021507034` | Different class names; require an explicit mapping decision. |
| Hanger Jilbab, row 75 | PIN / Kawat Sensor, `1021507035` | Different objects; matching an old ordinal would be wrong. |
| Hak Pengelolaan Tanah, row 11 | Hak Sewa Tanah / HGB, `1021501002` | Preserve the source description and confirm the intended classification. |
| Intangible Asset, row 79 | Two named software classes | A general intangible label does not prove every item is one of those two applications. |
| FFE Engineering Tools, row 660 | No class with that exact name | Later annotation with a reused code; review instead of automatically creating a duplicate class. |

`MASTER ASSET` examples requiring treatment beyond a category selector include quantity lots, `PC,UPS,KEYBOARD` (row 1268), `FLASHDISK ,ANTIVIRUS` (row 681), `PRINTER DAN TONER` (row 1074), and `LOGAM MAS` under `OE - Box OB Besi` (rows 938–939). The latter is an unresolved description/class mismatch, not evidence that gold should automatically become GA equipment.

## Workflows suggested by the account list

Codes below are references to the supplied legacy chart, not instructions to post directly to those codes in today's mapped ledger.

| Work | Chart evidence | Current coverage / required connection |
| --- | --- | --- |
| Electricity, water, phone/internet | `6010310005–0007`; related accruals `2012201006–0008` | Contracts → Subscriptions, site, provider and readings exist in cloud. GA can send a draft invoice; recurring templates are Finance-owned. Prototype lacks the complete monthly expected bill → due → posted → paid feedback loop. |
| Cleaning, stationery, household, store/office, electrical, tools, telephone and mess supplies | `6010310001–0003`, `0013`, `0015`, `0018`, `0020`, `0024` | Cleaning agreement and supply requests exist. Receipt/issue/return/balance for quantities and partial deliveries are not demonstrated by the prototype's single-item request ladder. Do not confuse purchasing with ongoing custody/consumption. |
| Vehicle and generator operating expenses | `6010310016` tyres/tubes; `0017` fuel/oil; `0019` grease/generator fuel | Repairs/schedules cover maintenance, but routine fuelling and operating consumption need an appropriate log/request with asset/site, date, quantity, reading and receipt. A routine fuel purchase should not require inventing a broken-item repair. Finance expense categories already provide accounting vocabulary. |
| Repairs across ten objects | `6010410001–0010` | Asset/site repair, supplier and optional maintenance agreement are modeled. Evidence, completion, bill and posting/payment references need a tested end-to-end path. Some prototype workflows are proposals beyond current cloud. |
| Rent, insurance, business/vehicle permits, PBB, advertising tax | `7010110001–0004`; `7010310001–0002`; `7020310003/0005`; `6010310010/0023`; prepaid `1011301001–0006/0008` | Agreement types are represented. GA owns coverage, papers and renewal dates; Finance owns invoices, prepaid allocation, accruals, tax and payment. Prototype does not reproduce those complete financial flows. |
| Contractor advances, renovations and CIP close-out | `1011303003`, `1031803001`, `1031802001` | Cloud already has contractor-project advance/invoice/close and asset assessment/reclassification. The GA prototype shows a CIP asset but not the complete project → contractor bill → resulting assets/expense linkage. Reuse Finance's project owner. |
| Business travel and local transport | `6010310008–0009`, `1011303001` | Owner decision: business travel stays in HR; advances/settlement stay in Finance. No additional GA trip workflow is required. |
| Income from letting assets | `8010110004–0005` | Leased-out contract types exist. Prototype has no complete tenant charge/receivable/receipt path. The current cloud hub also labels a supplier-bill total as received income; see confirmed issue below. |
| Consultant, donations, miscellaneous operational requests | `6010310021–0022`, `6010310099` | Finance has categories and bill/expense mechanisms. If GA administers these, provide a request/work context and Finance handoff. This does not require a new top-level menu per account. |
| Asset counts | Asset register plus quantity lots; stock-count accounts `6010310014`, `8010110006` | Excluded by the owner after review. The chart does not require adding physical fixed-asset stocktake to GA. |

## Important implementation gaps

1. **Letters:** merge validated optional item references into the existing rich writer, keeping printable snapshots. The simplified GA preview is not a replacement for that editor.
2. **Lots and individual units:** the registration request/backend accepts quantity and the importer carries it, but `GaAssetRow` does not expose quantity and the prototype asset form has no lot/unit workflow. Partial movement and handing out a few units cannot be inferred from a single asset holder. This does not add physical stocktake, which the owner excluded.
3. **Legacy migration:** category label coverage is not an import guarantee. Preserve source row identity; resolve class conflicts, zero quantities, inactive status and grouping before mapping. The existing importer coerces zero quantity to one (`scripts/import_client_assets.py:251`), which needs explicit review for this source. No importer was run during this audit.
4. **Projects and financial asset facts:** the cloud already has more Finance functionality than this prototype shows: capitalization, useful life/rate, opening depreciation, disposal and contractor projects. Link these views rather than duplicating financial fields owned by Finance.
5. **Overview:** the prototype attention filter currently includes open repairs, requested supplies, expiring documents and disposal requests. It does not yet aggregate due services, expiring contracts, outstanding original returns and monthly bill/payment obligations.
6. **Lifecycle and robustness:** real files, permissions, concurrent edits, cross-site coverage, historical claim evidence and all financial settlement paths have not been validated by local sample-form tests.

## Confirmed leased-out financial-label issue

`frontend-hub/src/screens/contracts/hub.tsx:329` calls `row.billed_minor` “Received to date” for `DISEWAKAN`. `backend/src/cloud/postgres/ga_contracts.rs:678` calculates that value from posted `supplier_invoice_expense_line` joined to `supplier_invoice`. Those are supplier bills, not tenant cash receipts. Therefore this label/value pair cannot substantiate collected rent. The income side needs its own validated receivable/receipt references and measures. No fix was applied in this read-only audit.

## Boundary with other functions

The chart also contains payroll/employee BPJS, bank charges/interest, bad debts, taxes, promotion/decorating/advertising, freight/courier, merchandise inventory and commercial supplier returns. They may share documents or approvals with GA, but their presence in the chart does not automatically transfer ownership to GA. Keep financial postings in Finance, people benefits in the people/payroll flow, merchandise in inventory/operations, and campaign work with its actual business owner.

Recommended sequence: preserve/integrate the writer; complete the utility bill/status journey and obligation reminders; add suitable routine operating expense contexts and quantity/partial-handover workflows; connect contractor/CIP and leased-out income correctly; then run end-to-end scenarios using representative real-source rows. Travel stays in HR and physical stocktake is excluded. None of these conclusions establishes that every live cloud record is correct; the audit examined local source and the supplied files.
