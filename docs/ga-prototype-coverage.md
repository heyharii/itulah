# GA workspace prototype — review coverage

Updated 17 October 2026. This is a standalone interaction prototype using fictional in-memory data. It does not change the cloud API, database or production frontend. Reload resets sample writes.

Open `http://127.0.0.1:8766/ga-asset-relations-prototype.html`. Use **Review coverage** for connection explanations and a shortcut to every asset and agreement example. **Vehicle example**, **Insurance example** and **Phone preview** are review shortcuts.

## Menu and sheet coverage

| Menu | Form sheets | Detail and connections |
| --- | --- | --- |
| Overview | Actions belong to each source record | Attention list opens the underlying repair, request or expiring document |
| Supply Requests | Request, approve/reject, order, receive, Finance draft | Site, requester, category, supplier, order, receipt, documents and bills |
| Repairs | New/edit, budget approval, completion, cancel, maintenance selection, claim, replacement, Finance draft | Site, optional asset or facility object, inspection/task, agreement, evidence, claim and bills |
| Service Schedule | New/edit, completion, pause/resume | Asset or site target, provider, maintenance agreement, service history, findings and resulting repairs |
| Assets | All 11 build forms, edit, move/assign, inspection, repair, service, agreement, document, letter, replacement/disposal, vehicle reading | Identity → location/holder → documents → originals → agreements → service → inspections → repairs → lifecycle → bills → letters |
| Contracts | All 17 types, edit, renew, end, manage coverage, claim, usage, signed document and Finance draft | Counterparty/scope, compatible covered assets, period/value, type-specific facts, claims/service/usage, bills and renewal history |
| Sites | Edit existing facility facts; contextual asset/agreement/repair/service/supply/document forms | Existing site is the shared location, with related records visible from its detail |
| Suppliers | New/edit and contextual agreement/document forms | Identity/contact, agreements, repairs, service, bills and documents |
| Letters | All 10 forms, draft edit, reference selection, issue | Paper preview, recipient, form-specific facts and related records; issued letters are read-only |
| Files | File metadata, attach existing/new, edit, manage references, register original | Document subjects, optional digital attachment and separately controlled physical originals |

Overview is an aggregate, not a separate entity requiring a duplicate create form. Sites reuses existing locations; this prototype edits GA facility facts rather than creating a second location master.

## Asset forms

The prototype uses the actual 59 asset classes from migrations 0287/0356, grouped into 11 builds. Kind filters may group several builds under the same menu category.

| Build | Form |
| --- | --- |
| LAND | Land |
| BUILDING | Building |
| TECH | Technical equipment |
| VEHICLE | Vehicle |
| FFE | Furniture & fixtures |
| IT | IT hardware |
| AUDIO | Audio |
| OE | Operating equipment |
| SOFTWARE | Software |
| DEFERRED | Deferred expenditure |
| CIP | Construction in progress |

Each build has its own specification fields and valid class choices. Deferred expenditure and construction in progress do not display physical maintenance actions. Physical originals are an additional controlled-item view in Assets; they are not silently capitalized as fixed assets.

## All agreement types

| Group | Exact type codes |
| --- | --- |
| Leases | `SEWA_TANAH`, `SEWA_TOKO`, `SEWA_RUMAH`, `SEWA_KENDARAAN` |
| Services | `JASA_MAINTENANCE`, `JASA_CLEANING` |
| Insurance | `ASURANSI_PROPERTI`, `ASURANSI_KENDARAAN` |
| Permits | `IZIN_USAHA`, `IZIN_KENDARAAN`, `PAJAK_PBB`, `PAJAK_REKLAME` |
| Subscriptions | `LANGGANAN_LISTRIK`, `LANGGANAN_AIR`, `LANGGANAN_TELEKOM` |
| Leased out | `DISEWAKAN_GEDUNG`, `DISEWAKAN_PERALATAN` |

Insurance adds protection/deductible/premium and compatible insured objects. Utilities add a connection number and readings. Maintenance adds its object and related tasks/repairs. Leased-out agreements identify the tenant. Signed evidence is attached after saving, using the same document action throughout GA.

Supplies includes all 7 existing categories. Letters includes Goods out, Goods in, Handover, Authority to collect, Assignment, Warning, Employment certificate, Notice, Request and Blank, with appropriate additional fields.

## Relationship rules demonstrated

1. Contextual forms prefill their source: recording a repair from an asset keeps that asset/site; attaching evidence keeps the source record. Global forms ask the user to select the source.
2. Relationships have business meaning: repair asset, policy coverage, task target, document subjects, original custody and bill source are distinct fields. There is no universal Link records form.
3. A document has one canonical metadata record and can describe several records. Its scan is optional in this proposal. A physical original has separate custody history. Its custodian and the associated asset's holder can differ.
4. Service completion creates history, advances the next date or kilometre threshold, and can create a repair from findings. A fixed-asset task cannot complete against a different asset.
5. Selecting existing coverage changes the same agreement roster read from the asset and contract details. Asset compatibility and site scope are validated.
6. Claims reference a policy, insured object and optional repair. Repair completion, insurer approval and cash settlement are separate events.
7. Bills created from GA remain Finance drafts. The prototype does not post journals, pay suppliers, allocate claim cash or finalize financial disposal.
8. Issuing a letter does not move an asset or transfer custody. Those changes use explicit movement/custody actions.
9. Replacement preserves two asset records. Disposal is a request awaiting Finance review.

## Review performed

- JavaScript syntax checks for data and controller.
- Data integrity check after loading the workflow extension: 75 unique sample records; every build and contract type represented; record references resolve; 11 builds, 59 classes, 17 agreement types, 7 supply categories and 10 letter types.
- Browser checks: every asset build and agreement type changes the form; all 10 letter selections; primary form entry points for the 8 create menus; existing Site edit; source detail opening from all 10 menus.
- Browser workflow checks: vehicle service at 50,000 km creates inspection history and advances due to 60,000 km; BPKB handover changes original custodian while vehicle holder stays Dimas; repair invoice creates a Draft Finance bill.
- Dirty-form cancellation and desktop/phone sheet layout reviewed.

This is targeted prototype QA, not an exhaustive regression suite or cloud integration test. Real attachments, permissions, concurrent edits, financial posting and API persistence require implementation and integration validation. Claims, originals/custody, readings, expanded coverage and the aggregate detail responses are proposed additions described in `ga-asset-relations-cloud-plan.md`.

## Files

- `ga-asset-relations-prototype.html`: workspace shell and discard dialog.
- `ga-asset-relations-prototype.css`: desktop/phone sheet layout.
- `ga-asset-relations-data.js`: catalogs and fictional sample records.
- `ga-asset-relations-prototype.js`: forms, details, navigation and simulated workflows.

The reference `asset-detail-prototype.html?o=A&a=avanza&d=desk` remains unchanged. The expanded asset detail follows its one-scroll section layout.

## Letter contents and references update

Goods out, goods in, handover and collection authority now accept mixed item lines: registered assets, physical originals, document/copies and other free-text items. Supporting work is an optional separate reference. The sample **BPKB release · annual registration** demonstrates an original, a document copy and an unregistered item in one draft. Open it from Letters or the related vehicle/document/original.

The paper keeps its own wording, quantity/unit and notes. The referenced record opens from the item table; related Letters are visible from the source details. Issued letters lock their contents. Letter issue does not change custody or asset holder. Register genuinely new tracked assets/documents through their own forms before selecting them; an unregistered line does not invent an asset.

Browser review covered mixed original/free-text/document rows, asset selection, row removal, save, issue locking, and reverse navigation to the original with its custodian unchanged. Production letter item references remain a gap, documented in the cloud plan. The subsequent integration below adds an optional adapter to the reference writer; its standalone flow is preserved. Operational flows that generate system letters remain in their own source modules.

## Completed additions after owner scope decisions

Business travel remains in HR. Physical fixed-asset stocktake is excluded. Maintenance service findings remain part of service completion and repairs.

| Entry point | Added detail / action sheets |
| --- | --- |
| Assets → Projects, Start project, Project example | Operational project with the same Finance reference, contractor/site/PIC, scope/dates, milestones, progress, evidence/SPK, BAST acceptance, outstanding findings and due date, proposed outputs and closeout submission. Existing CIP record is linked rather than duplicated. |
| Project → Finance view | Read-only preview of the same project reference, advances, invoices, amounts outstanding and output proposals. No advance payment, journal posting or capitalization action is executed. |
| Overview | Computed reminders for renewal, document expiry, date/KM service, original return, work targets, project milestones/findings, supplies, claim follow-up, monthly utility duties, supplier payments and tenant collection. Source record opens directly; snooze requires a future date and reason. |
| Contracts → Subscriptions → Monthly obligations | Month, meter due, invoice expected-by, payment due, responsible person, readings, bill draft and Finance feedback. Ongoing subscriptions can have no agreement expiry. |
| Asset / site / supplier → Operating expenses | Fuel, tyres/parts, oil/lubricant, generator fuel, computer and other operating receipts, linked to site and optional/required compatible asset. Receipt evidence and Finance draft are separate actions. |
| Assets with quantity > 1 | Registered quantity/unit, available quantity, partial handover to recipient/site, partial return and history. Reject over-issue/over-return; block whole-lot movement while quantities are handed out. |
| Supply Requests | Partial receipt, outstanding-to-receive, available quantity and handout/consumption/return. No physical count/stocktake workflow is added. |
| Leased-out agreements | Tenant charge requests, actually received amount and unpaid balance are distinct from supplier bills. Sample receipt feedback resolves collection reminders. |
| Letters → Open letter writer / Open issued paper | Original rich paper editor with toolbar/formatting/printing, mixed item references and context links. Edits survive closing/reopening. Detail edits reconcile references/recipient without discarding edited paper. Issue locks the letter and returns status to GA. |

The writer's optional adapter is loaded only with `?ga=1`; the standalone writer keeps its existing behaviour. `ga-workspace-extension.js` contains workflow additions and fictional sample data, while `ga-letter-writer-adapter.js` synchronizes the embedded editor with the same letter record. Both are local prototype files.

Additional verification:

- Browser: project milestone completion removes its reminder; BAST acceptance + proposed output + Finance closeout preserves a reminder for unresolved findings.
- Browser: sample paid feedback clears water bill balance and payment reminder; returning the original clears its return reminder.
- Browser: partial handover of 5 then return of 2 leaves 3 held; registered quantity remains 24.
- Browser: operating receipt records against vehicle/site; asset registration exposes quantity/unit.
- Browser: rich paper edit survives reopening; updating detail recipient preserves edited body; issue locks writer and updates the parent letter.
- Model checks: all sample references resolve, no duplicate IDs, no duplicate renewal for STNK paper/permit, quantity conservation and refusal of excess issues/receipts, partial supply receipts, tenant receipts separate from supplier bills, and new projects do not create a duplicate CIP asset.

Financial feedback buttons explicitly simulate status returned from Finance. No live invoice, payment, project closeout, original custody or other production record is changed. Data and snoozes reset on page reload. These checks do not establish production integration or exhaustive coverage of every combination.
