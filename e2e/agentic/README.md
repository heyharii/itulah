# e2e/agentic — agentic end-to-end suites (TesterArmy `e2e` 0.18.0)

UI tests for Central (hub), the store app and the web till, written with
[`e2e`](https://e2e.tester.army/docs): deterministic locators + `expect` for every
fact, `agent.act` only where a form is painful to script, numbers proven
through the nodes' API (`support/rig.ts`).

## Run

```bash
cd e2e/agentic
./provision.sh                     # the `agentic` rig: cloud 8580 (Gudang inside it) · store-01 8582, 16 open stores; RIG_DC_HOSTING=edge adds the DC node on 8581
# dev servers (launch.json): agentic-hub :5580 · agentic-store :5582 · agentic-till :5584
E2E_TELEMETRY_DISABLED=1 npx e2e run --config hub.config.ts --output .e2e/out/po hub/po
```

Agent steps need `ANTHROPIC_API_KEY` in `e2e/agentic/.env` (gitignored). Tests
without agent steps need no key. Model: `E2E_MODEL` (default `claude-haiku-5-5`),
judge `E2E_JUDGE` (default `claude-haiku-5-5`).

## Layout

| Path | What |
| --- | --- |
| `hub.config.ts` / `store.config.ts` / `till.config.ts` | one config per app (tests run on every target of a config, so apps never share one) |
| `support/base.ts` | rig URLs, ports, people, model, agent context — shared, change only with the coordinator |
| `support/rig.ts` | API client + PO/receiving/return helpers (ported from `e2e/po-flow/run.py`) — shared |
| `support/session.ts` | sign in by API so screenshots stay available |
| `support/<domain>.ts` | each domain's own helpers |
| `hub/auth.setup.e2e.ts` | sessions `rina`, `nina`, `yusuf`, `admin` for the hub |
| `hub/<domain>/*.e2e.ts` | tests per domain: `po`, `receiving`, `return-po`, `marketing`, `inventory`, `sales` |
| `store/`, `till/` | store app and web till tests (POS) |
| `use-cases/<domain>.md` | the use-case catalogue: every branch → test file, or why it has none |
| `maps/*.md` | read-only branch maps of the screens (labels, routes, endpoints, file:line) |

## Rules for writing tests

1. **Own data.** Every test creates what it needs with a run-unique `tag()` (supplier item, PO, promo…). Never depend on totals other tests change; assert on your own records or on deltas.
2. **Facts with `expect` and the API, not the model.** `screen.getByRole/getByLabel/getByText` + `expect(...)`; numbers re-read through `support/rig.ts`. `agent.assert` costs a model call every run — use it only for a judgement a locator cannot make.
3. **`agent.act` = one goal, then an `expect`.** The check after it is what lets the replay cache record it. Run-varying values go in `params` wrapped in `unique()`; never spell one param's value inside another.
4. **Labels come from the source.** Read the component (or `maps/`) for exact accessible names; `getByRole` names match whole and case-sensitive. The password field is named `Password Show password`.
5. **A bug stays red.** When the app is wrong, the test asserts the right behaviour and fails; tag it `bug` and list it in the use-case file. Never weaken a test to pass.
6. **Branches the rig cannot reach** (e.g. Recall Count and zero counts need `INVENTORY_DC_HOSTING=cloud`; the rig runs the Gudang in the cloud unless `RIG_DC_HOSTING=edge`) are written anyway and skipped with `test.skip(process.env.RIG_DC_HOSTING !== 'cloud', 'needs the cloud-hosted DC')`.
7. **Tags**: the domain (`po`, `receiving`, `return-po`, `marketing`, `inventory`, `sales`, `pos`), plus `agent` when a test has agent steps, `bug` when it guards a known bug, `smoke` for the one fastest test per domain.
