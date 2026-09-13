# People design prototype

Open http://localhost:5398/hr/ . Final menu is available inside the sidebar and in menu-final.md.

## Research performed

Read both user attachments, `demo/share/public/hr.html`, and current frontend-hub People source. A requested gpt-5.6-luna / max explorer was dispatched, but it stopped with a model usage-limit error and returned no research. The primary agent continued the source research directly; this work must not be attributed to a completed Luna report.

Verified source evidence:
- `frontend-hub/src/screens/people/nav.ts`: 11 screens, single navigation tree, employer-only Pay/Setup; 5 screens for store/DC managers.
- `frontend-hub/src/screens/people/scope.ts`: reach and audience differ from actual server authorization; HO location alone is not a credential.
- `frontend-hub/src/screens/people/roster.tsx:59` and `periods.tsx:51`: place derives from the caller's `reach.data?.place_id`, which prevents a HO unit selector in those screens.
- `frontend-hub/src/screens/people/payroll.tsx`: run states, incomplete_because, verify/approve separation and seal behavior.
- `frontend-hub/src/screens/people/directory.tsx`: employee record, leave, contracts, change; provision-account flow and employer visibility.
- `frontend-hub/PEOPLE-BRIEF.md`: one module, store close as input to HO-owned payroll, employee self-service separate, no invented attendance punches.
- `demo/share/public/hr.html`: 9-domain prior proposal, versioned submissions and HO decision workflow, HR unit/HO split and 17 form definitions. Prior prototype gives stores payroll drafting and treats DC separately; latest design follows current user clarification instead.

## Working interactive examples

Seven menu domains, five for store; unit + HO/DC department scope; searchable unit/status/type pickers; wide-screen right filter and laptop overlay; employee detail; create/draft/revise requests; approve/return/reject with reason/version; additive/subtractive proposed pay components; fixed pay change; onboarding/offboarding checklists; account handoff simulation; roster edits; period readiness; two-person payroll transition; Finance handoff; CSV download; setup previews and reports.

Test case suggestions:
1. Open ADJ-2609-022 / ADJ-2609-021 to inspect new positive/negative pay components.
2. Switch to Store 01; submit a new component; switch back to a HO reviewer and approve it.
3. Return an existing request, revise it and inspect version 2.
4. Choose Head Office then Distribution Center; only DC employees/requests appear.
5. Inspect payroll Store 10, verified by Maya; Sarah can approve it. Store 09 begins draft; if Sarah verifies, Sarah cannot approve afterward.
6. Inspect attendance: unavailable source is stated rather than showing fake absences.

## Boundaries

All fixtures are fictional and held only in memory; refresh resets them. No employee data or credentials were loaded from databases. No HR decision, payroll computation, payment, account grant, or backend mutation occurs. Reference amounts, balances and completed-period examples are design fixtures, not policies or statutory calculations. Setup pages describe configuration needs rather than publishing policies. Document upload, real attendance integration, payroll calculation/version snapshots, true server permission checks, and employee self-service app are out of scope for this standalone prototype.

Existing production frontend and earlier prototypes are untouched. Run validation using `node prototypes/hr/hr.test.cjs`.
