# Allotment / Operations research prototype

Research and interactive local proposal, 11 October 2026. Sample data only; no production API calls.

The easiest option is to open **allotment-ops-prototype.html** in a normal browser. It contains the CSS, data model, research summary and interactions in one file, with no server or external code imports.

For a refreshable HTTP preview, start from the repository root:

```sh
python3 -m http.server 5478 --bind 127.0.0.1 --directory prototypes/allotment-ops-research
```

Open http://127.0.0.1:5478/.

- **Warehouse:** work queue and stage view; corrections lead the queue.
- **MD:** Unallotted / Allotted; Active / Finished and MD decision filters.
- **Scenarios:** eleven difficult presets. A preset resets the sample state.
- **Research & rationale:** summary and official references; full Indonesian specification in `research.md`.
- Close the detail before switching the simulated role. All demo changes persist in localStorage; **Reset all** restores the sample data.

Recommended walkthrough:

1. Load **Partial dispatch + MD edit**.
2. Edit Kemang Oxford target from 120 to 60. Choose a reason and save.
3. Review immediate release 20 and physical putback 40. In transit 40 remains.
4. Close detail, switch to Warehouse, then filter **Needs attention**.
5. Resolve part of the correction; observe that the remaining task persists.
6. Try **MD + warehouse together**, open Edit, simulate concurrent packing, and refresh the stale impact.
7. Try **Warehouse offline**: requested change retains the current target and stock until reconnection.
8. Try **Finished + later return**: completed intent remains in history while a linked Return is worked.

Run meaningful state-transition checks:

```sh
node --test prototypes/allotment-ops-research/model.test.mjs
```

The simulator proposes extra capabilities beyond today's backend: temporary holds, uniform revisions, controlled SJ/load reversal, linked return/replacement orchestration and quality release. It is not a replacement for the production serialized stock ledger, nor a deployment of those features. Keep the existing bulk quantity matrix in production; the small editor here demonstrates a single correction.

Rebuild the single-file copy after editing sources:

```sh
python3 prototypes/allotment-ops-research/build-standalone.py
```

Browser/geometry verification and its limits are recorded in `QA.md`.
