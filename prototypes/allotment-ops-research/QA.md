# Verification — 11 October 2026

## Automated domain checks

`node --test prototypes/allotment-ops-research/model.test.mjs`: **20 passed, 0 failed**.

Covers eleven scenario presets and invariants; partial dispatch/reduction; immediate vs physical release; mixed-carton blocking; unaffected store work; full cancellation and final demand; partial putback; atomic failure; stock shortage on top-up; retained-demand repack; pre-departure document/load reversal; rejected transit undo; linked Return and quarantine/quality release; 95/100 remaining demand; confirmed-loss replacement; actual-location Return; offline request/ack; stale revision and stale acknowledgement; scoped hold/resume; aggregate multi-store creation; add SKU/store; invalid quantities/reasons; completed intent with later Return; receiving discrepancies and Inventory outcomes.

Syntax checks passed for `model.mjs`, `app.mjs`, and `research.mjs`. The generated single-file HTML was loaded through HTTP and its controls were tested. It has inline CSS/JS and no external code imports.

## Browser interaction checks

Verified with Codex in-app browser, using actual buttons/fields:

- MD changes 120 → 60: immediate release 20, putback picked 20 + packed 20, committed 40 retained.
- Saved change displays physical correction 40; Warehouse attention filter exposes both tasks.
- Partial putback 10 leaves the remaining correction visible.
- Warehouse packs 5 while MD's form is open: stale revision message appears and Save is disabled pending refresh.
- Offline change keeps current target 300 and free stock unchanged; reconnection applies the requested reduction.
- Confirmed loss produces a linked 5-piece replacement document; old request remains settled.
- A Return after Completed retains Completed and creates open Return work.
- Wrong-destination Return identifies PIK Avenue as source, even though intended destination is Kemang.
- SJ 100 / counted 95 exposes an Inventory-owned 5-piece investigation task.
- Multi-store creation 10 + 20 issues a 30-piece request with both store lines.
- Research summary and official reference links render.
- Captured page console: no warnings or errors in the final bundle.

## Responsive verification

Inspected at desktop **1440×900**, normal in-app pane width, phone **390×844**, and narrow phone **320×800**.

- At 390 and 320: document scroll width matched viewport width (no horizontal overflow).
- At 390: all rendered button targets were at least 44px after final correction; inspected supporting text was 14–15px.
- Mobile cancellation dialog: width 390, confirm button height 44; impact and footer actions remained reachable.
- Phone work queue reflows into cards; role/navigation actions remain in the bottom dock.
- Temporary viewport override was reset after testing.

Evidence files: `preview-desktop.jpg`, `preview-mobile.jpg`, `preview-edit.jpg`.

## Fixes made during QA

- Scenario switching now resets the detail to Items & actions instead of retaining Documents from a prior record.
- Completed intent no longer reopens for a later linked Return.
- Historical received quantity remains visible separately from current goods at the store after a Return.
- Affected forward actions show disabled held labels, including shared-carton dependencies.
- Routine warehouse confirmations no longer request redundant reason entry.
- Mobile Scenarios/close buttons meet 44px targets; editable phone fields use 16px text.
- Receiving discrepancies route to Inventory first; MD decision counts exclude Inventory-only cases.
- Found receiving discrepancy settles the receipt; fulfilled short pick removes its old decision.

## Limits

No authenticated current-production UI test, no production backend integration, no EPC/serial scanning, no print/carrier/accounting execution, no real server RBAC, and no durability across devices. The offline/revision tests simulate application state, not a real distributed warehouse network. No measured usability advantage over vendor products is claimed.

The self-contained preview remains interactive after its resources have loaded. Open `allotment-ops-prototype.html` in a normal browser for a server-free copy, or use the README server command for a refreshable HTTP preview. The temporary QA server is stopped at handoff.
