# e2e (TesterArmy) — API Reference digest (docs "Reference" section, as of 9 Oct 2026)

Scope: the 16 pages under `/docs/reference/` (test, expect, screen, app, agent, config, cli, runner, mcp, reporters, environment, errors, security, web, mobile, engine). Primary source is the downloaded `llms-full.txt` (pages carry `Source:` URLs, cited below). The live `reference/security` page ("Security rules") was not in the download (the download has the older narrative page "Security model" at `/docs/security`), so it was fetched live. npm registry data was pulled to date the versions.

Short URL keys used below (all `https://e2e.tester.army/docs/...`):
[test](https://e2e.tester.army/docs/reference/test) · [agent](https://e2e.tester.army/docs/reference/agent) · [app](https://e2e.tester.army/docs/reference/app) · [screen](https://e2e.tester.army/docs/reference/screen) · [expect](https://e2e.tester.army/docs/reference/expect) · [config](https://e2e.tester.army/docs/reference/config) · [cli](https://e2e.tester.army/docs/reference/cli) · [runner](https://e2e.tester.army/docs/reference/runner) · [mcp](https://e2e.tester.army/docs/reference/mcp) · [reporters](https://e2e.tester.army/docs/reference/reporters) · [env](https://e2e.tester.army/docs/reference/environment) · [errors](https://e2e.tester.army/docs/reference/errors) · [security-rules](https://e2e.tester.army/docs/reference/security) · [security-model](https://e2e.tester.army/docs/security) · [web](https://e2e.tester.army/docs/reference/web) · [mobile](https://e2e.tester.army/docs/reference/mobile) · [engine](https://e2e.tester.army/docs/reference/engine) · [migrate-pw](https://e2e.tester.army/docs/migrate/playwright) · [npm](https://registry.npmjs.org/e2e)

---

## Q1. test API — test/describe/hooks/setup tests/fixtures/options, parallelism, sharding

### Takeaway
A Playwright-shaped test API (`test`, `describe`, four hooks, `test.extend` fixtures, `test.only/skip`) plus two e2e-specific ideas: `test.setup` tests that save encrypted named sessions consumed with `{ session }`, and per-test options for `agent`, `agentContext`, `platforms`, `requires` (capability gating), `trace`, `video`. Parallelism is file-level only (a file's tests run in order on one worker); sharding is `--shard i/n`.

### Cited Findings
**Signatures** — [test](https://e2e.tester.army/docs/reference/test)
- `test(title, fn)` / `test(title, options, fn)` → `TestCase`; `test.skip(title, fn)`; inside a body `test.skip(condition, reason?)` or `test.skip(reason?)` throws and ends the body (reported `skipped`, no retry); `test.only(title, fn)`; `test.setup(title, SetupOptions, fn)`; `test.extend<Extra>()` (type-only refinement); `test.extend<Extra>(fixtures)` (real fixtures); `test.describe(title, [options], body)`; `test.beforeEach/afterEach(fn)`; `test.beforeAll/afterAll(fn)`. `describe`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll` are also top-level exports of `e2e`; `@e2e-dev/web` and `@e2e-dev/mobile` export the same, typed with `browser` / `device` fixtures — [test](https://e2e.tester.army/docs/reference/test)
- Registration must be synchronous during module evaluation, otherwise `COLLECTION_ERROR`; an `async` describe body is a type error and `COLLECTION_ERROR`; `test.setup` must be top-level, not inside `describe` — [test](https://e2e.tester.army/docs/reference/test)
- Titles: 1–512 UTF-8 bytes after NFC, no NUL; two tests with the same title path in one file = `COLLECTION_ERROR` — [test](https://e2e.tester.army/docs/reference/test)

**Options** (`TestOptions`) — [test](https://e2e.tester.army/docs/reference/test)
- `timeout` (ms; default `config.timeout` = 120000; innermost wins), `retries` (0–10; default `config.retries`), `tags` (distinct names, unioned across layers), `skip` (`boolean | string` reason), `only`, `platforms` (other targets skip), `requires` (capabilities the target must have, else skipped at selection), `session` (restore a setup-saved session), `agentContext` (extra agent context, layers concatenated outermost first), `agent` (`string | string[]` — a list runs the test once per agent), `trace`, `video` (recording modes).
- `DescribeOptions` = TestOptions minus `only`, plus `serial?: boolean`. `SetupOptions` = TestOptions minus `session/only/skip/agent`, plus required `sessions: string[]` and single `agent?`.
- Resolution order: test → nearest group → outer groups → config → built-in default. Unknown option key = `COLLECTION_ERROR` with nearest-key suggestion.
- `requires` accepts harness capabilities (`observation`, `actions`, `location`, `pointer`, `keyboard`, `state`, `artifacts`), contributed fixtures (`browser`, `device`), or app kind (`browser` for `app.url`, `native-app` for `app.bundleId`/`appPath`).

**Serial groups** — `describe(title, { serial: true }, ...)` = one ordered retry unit with shared app state and shared secret state; members may not set `retries`, `trace`, `video`, `session`, `platforms`, `requires`, `skip`, `only`, or nest `serial` (collection errors); a failing first member skips the rest with cause `serial-predecessor-failed` — [test](https://e2e.tester.army/docs/reference/test)

**Setup tests / sessions**
- `test.setup('authenticate', { sessions: ['member'] }, async ({ app, screen, session }) => { ...; await session.save('member'); })`; session names `/^[A-Za-z0-9_.-]{1,128}$/`; not saving a declared session, or saving twice, = `SESSION_CONTRACT`; a setup test cannot skip — [test](https://e2e.tester.army/docs/reference/test)
- Sessions are AES-256-GCM encrypted with a per-run in-memory key, bound to run/target/engine/platform/app identity, live at most 24 h and are deleted when the run ends (so they do not persist across runs) — [security-model](https://e2e.tester.army/docs/security)
- Mobile engine declares no `state` capability: "`test.setup` and `session:` are unavailable" on devices — [mobile](https://e2e.tester.army/docs/reference/mobile)

**Hooks** — `beforeEach` outermost-first; `afterEach` innermost-first, also after failure/timeout; `beforeAll` per suite instance; the module is re-imported for every retry, serial group and setup test so `beforeAll` runs again in each; `beforeEach` + body share the test timeout; each `afterEach` gets its own `cleanupTimeout`; a throw in `beforeAll/afterAll` = `HOOK_FAILED` and skips the suite. Suite hooks get only `{ platform }`. A worker whose event loop is blocked is killed `cleanupTimeout` (≥5 s) after the test timeout — [test](https://e2e.tester.army/docs/reference/test)

**Fixtures**
- Core: `agent`, `app`, `screen`, `platform` (lazy); setup tests also get `session`; engines contribute `browser` (web) and `device` (mobile). Reaching for a fixture the engine does not contribute = `UNSUPPORTED_CAPABILITY` — [test](https://e2e.tester.army/docs/reference/test)
- `test.extend({ name: async (fixtures, use) => { setup; await use(value); teardown } })`; own fixtures are not lazy (every fixture in the extend chain sets up for every test); a fixture needing another goes in a chained `.extend()`; errors: no `use()` call or two calls → `TEST_SETUP_FAILED`; reusing a core/engine name → `COLLECTION_ERROR` / `TEST_SETUP_FAILED` — [test](https://e2e.tester.army/docs/reference/test)

**Skip / only / CI** — `test.only` in CI fails the run with `ONLY_IN_CI` (exit 2); a test that fails then skips on retry is listed under "Skipped After Failure"; `failOnSkippedFailure: true` makes that exit 1 — [test](https://e2e.tester.army/docs/reference/test), [config](https://e2e.tester.army/docs/reference/config)

**Retries / parallelism / sharding**
- `retries` default 1 in CI, 0 locally; `workers` 1–1024, default 1 in CI, else `max(1, floor(availableParallelism()/2))`; an engine may cap workers (e.g. device pool size) — [config](https://e2e.tester.army/docs/reference/config)
- "a file's tests run in order on one worker, files run in parallel"; Playwright's `fullyParallel` and `describe.configure({ mode: 'parallel' })` are "not yet" — [migrate-pw](https://e2e.tester.army/docs/migrate/playwright)
- `--shard <index/total>`: contiguous slice after all other filters, sizes differ by ≤1, a serial group counts as one and is never split, each shard brings only the setup tests it needs — [cli](https://e2e.tester.army/docs/reference/cli)
- Also `--repeat-each <n>` (with cache on, first run records and later replay — pair with `--no-cache`), `--max-failures <n>`, `--last-failed` — [cli](https://e2e.tester.army/docs/reference/cli)
- Default discovery glob: every `*.e2e.ts` under `tests/`; `!`-prefixed globs exclude — [config](https://e2e.tester.army/docs/reference/config)
- Playwright features missing: `globalSetup/globalTeardown`, `test.describe.only`, `reporter: 'html'`, `fullyParallel` — [migrate-pw](https://e2e.tester.army/docs/migrate/playwright)

### Inferences
- A first test, assembled from documented signatures (not copied from one page):
```ts
// tests/todos.e2e.ts
import { test, describe } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { z } from 'zod';

test.setup('sign in', { sessions: ['member'] }, async ({ app, screen, session }) => {
  await app.open('/login');
  await screen.getByLabel('Email').fill(credentials.user('member').username);
  await screen.getByLabel('Password').fill(credentials.user('member').password); // Secret handle
  await screen.getByRole('button', 'Sign in').tap();
  await session.save('member');
});

describe('todos', { tags: ['smoke'], session: 'member' }, () => {
  test('adds a todo', { retries: 1 }, async ({ app, agent, screen, browser }) => {
    await app.open('/todos');
    await agent.act('add a todo named {name}', { params: { name: 'groceries' } });
    await expect(screen.getByTestId('todo')).toContainText(['groceries']);   // deterministic check
    await agent.assert('the list shows a todo named groceries');            // AI judgment
    const n = await agent.extract('how many todos are open', { schema: z.object({ open: z.number() }) });
    expect(n.open).toBeGreaterThan(0);
    await expect(browser).toHaveURL('/todos');
  });
});
```
  Note: because the setup filled a secret, tests restoring `member` have pixels withheld (no screenshots / `vision`) for the attempt.
- Within-file parallelism absent means suites with many tests in one file will not speed up with more workers; split into files.

### Gaps
- No documented `test.fixme`, `test.fail`, `test.slow`, `test.step` or annotations API in the reference (`test.slow()` maps to `{ timeout }` per migrate page).
- No per-test `use`-style overrides (e.g. viewport per test) beyond `browser.setViewport` in the body.

---

## Q2. agent API — act / assert / waitFor / extract

### Takeaway
Four methods on the `agent` fixture with hard, configurable budgets (default 25 model calls / 25 actions for `act`; 2 model calls for `assert`/`extract`), Standard-Schema (zod/valibot/arktype) `extract`, a tri-state judge (`holds/fails/inconclusive`), a `vision` switch for judgments, and every failure surfacing as an `AgentError` with a closed `code` and a `blocked` flag. Model override is by named agent (`{ agent: 'thorough' }`), not by passing a model per call.

### Cited Findings
- `interface Agent { act(instruction, options?): Promise<ActResult>; waitFor(condition, options?): Promise<void>; extract<Schema extends StandardSchemaV1>(instruction, options: { schema, ... }): Promise<InferOutput<Schema>>; assert(assertion, options?): Promise<void>; }` — [agent](https://e2e.tester.army/docs/reference/agent)
- The built-in agent requires a configured model; without one, the first acquisition of `agent` records a run-level `MODEL_UNAVAILABLE` and stops the run (exit 2). Custom executors can implement `act`/`assert` without a model; `waitFor`/`extract` still need one — [agent](https://e2e.tester.army/docs/reference/agent)

**Budgets** — [agent](https://e2e.tester.army/docs/reference/agent)

| Method | Model calls | Action steps | Default timeout |
|---|---|---|---|
| `act` | `agents.<name>.maxModelCalls`, 25 | `agents.<name>.maxSteps`, 25 | `config.timeout`, 120000 ms |
| `waitFor` | `maxModelCalls`, 25 | 0 | `judgmentTimeout`, 30000 ms |
| `extract` | 2 | 0 | `judgmentTimeout`, 30000 ms |
| `assert` | 2 | 0 | `judgmentTimeout`, 30000 ms |

- Per-call budgets can only lower configured limits (larger = `INVALID_ARGUMENT`); every timeout is capped by remaining test time; a targeted agent action is bounded by min(`actionTimeout`, 15 s) — [agent](https://e2e.tester.army/docs/reference/agent), [config](https://e2e.tester.army/docs/reference/config)

**act** — [agent](https://e2e.tester.army/docs/reference/agent)
- `instruction` 1–8192 UTF-8 bytes; `ActOptions { params?, timeout?, maxSteps?, maxModelCalls?, agent? }`; `params` JSON-safe, ≤64 KiB, ≤32 levels deep, referenced as `{name}` in the instruction; a `Secret` reaches the model by name/purpose only; `unique(value)` marks run-varying values that the replay cache records as a slot.
- Returns `ActResult { summary, cache?: StepCacheInfo, modelCalls, actions }`; `cache.mode` is `self-finalized` (full replay, 0 model calls) | `agent-concluded` (replayed prefix then agent) | `missed`, with reasons (`retry`, `no-entry`, `invalid-entry`, `truncated`, `wrong-context`, `gap`, `target-not-found`, `target-ambiguous`, `viewport-changed`, `action-failed`, `action-uncertain`, `end-mismatch`).
- Tools offered to the model = one per engine-declared verb: `tap`, `double_tap`, `long_press`, `right_click`, `hover`, `type`, `type_secret`, `press` (≤20 times), `select`, `check`, `scroll` (≤20 screens), `scroll_to` (by node or by text, up to 800 screens), `drag`, `upload` (project-relative, hidden files and outside-project refused `POLICY_DENIED`), `navigate`, `back`, `observe`, `dismiss_keyboard` (devices); pixel tools `screenshot`, `tap_at`, `hover_at`, `type_at`, `press_at`, `select_at` (only while no secret filled). Screenshots ≤768 px long side; older ones dropped keeping newest two. Tab switching "has no verb yet: a new tab is invisible to the model".
- `act` does not take `schema` or `vision` (`UNSUPPORTED_CAPABILITY`).

**assert** — judge sees only the assertion + one fresh observation (no prior steps); answers `holds`/`fails`/`inconclusive`; throws `ASSERTION_FAILED` or `ASSERTION_INCONCLUSIVE`; when the subject appears several times every instance must agree. `AssertOptions { timeout?, screenshot? (default on, denied after secret fill), vision?, agent? }` — [agent](https://e2e.tester.army/docs/reference/agent)

**waitFor** — after a false/inconclusive judgment it waits `interval`, then observes every 500 ms without a model call and re-judges only when the screen changed; `WaitForOptions { timeout? (30000), interval? (100–60000, default 3000), maxModelCalls?, vision?, agent? }`; throws `STEP_TIMEOUT` / `STEP_BUDGET_EXHAUSTED` carrying the last judgment — [agent](https://e2e.tester.army/docs/reference/agent)

**extract** — one fresh observation, structured output validated against any Standard Schema v1 validator; zod's JSON-schema projection is sent to the model (types/required/literals), value rules (`min`, patterns...) stay in your schema; budget 2 calls (1 extraction + 1 repair); model may answer "not shown" → `ASSERTION_INCONCLUSIVE` (to accept absence use `.nullable()` and say so); still invalid after repair → `MODEL_OUTPUT_INVALID`; non-Standard-Schema → `INVALID_ARGUMENT`. Example: `agent.extract('the workspace name and plan', { schema: z.object({ name: z.string(), plan: z.string() }) })` — [agent](https://e2e.tester.army/docs/reference/agent)

**vision** (assert/waitFor/extract): `false` (default, tree only) | `true` (tree + masked screenshot) | `'only'` (screenshot only). Pixels are withheld (`visionDegraded`: `PIXEL_TAINTED` after a secret fill, `MASKING_UNPROVEN`, `UNSUPPORTED_CAPABILITY`) and `'only'` then fails `POLICY_DENIED` — [agent](https://e2e.tester.army/docs/reference/agent)

**Failures** — every failure is `AgentError { code, explanation, screenshot?, blocked }`; check with `isAgentError(error)` from `e2e` (not `instanceof`, test files load in their own realm). Failed verdict = `ACTION_FAILED` unless more specific (`LOCATOR_NOT_FOUND`, `AUTHENTICATION_FAILED`). Blocked codes: credentials (`AUTH_CREDENTIAL_UNAVAILABLE`, `AUTH_CREDENTIAL_INVALID`, `SECRET_UNAVAILABLE`), environment (`ENVIRONMENT_UNAVAILABLE`, `APP_UNREACHABLE`, `APP_ALREADY_RUNNING`), seed data (`SEED_DATA_MISSING`), test setup (`TEST_SETUP_FAILED`, `APP_NOT_OPEN`, `POLICY_DENIED`), automation (`MODEL_UNAVAILABLE`, `AUTOMATION_UNSUPPORTED`, `STEP_BUDGET_EXHAUSTED`, `STEP_TIMEOUT`, `CONTEXT_OVERFLOW`). Runner stops: `STEP_NO_CONCLUSION`, `CANCELLED`, `MODEL_PROVIDER_FAILED`, `MODEL_OUTPUT_INVALID`, `REPLAY_STALE` — [agent](https://e2e.tester.army/docs/reference/agent)

**Model / agent configuration** (`agents.<name>`) — [config](https://e2e.tester.army/docs/reference/config)
- `model` (AI SDK LanguageModelV2+ instance, no implicit default), `judge` (model for assert/waitFor/extract; defaults to `model`), `context` (≤16384 bytes, sent to every call), `maxSteps` (1–100, 25), `maxModelCalls` (1–100, 25), `judgmentTimeout` (30000), `maxObservationBytes` (1024–16777216, 262144), `maxInputTokens` (1–1000000, 64000), `providerOptions`, plus either `{ system?, tools? }` (built-in agent; `tools` from `defineTool` in `e2e/agent`) or `{ executor: StepExecutor }` (custom brain).
- Agents never inherit from each other; `default` always exists but has no model unless configured; a string `model` is `INVALID_CONFIG` naming the constructor to write. Judgments allow 8192 output tokens.
- Providers: `gateway('openai/gpt-6-luna-fast')` (`ai`, reads `AI_GATEWAY_API_KEY` or Vercel OIDC), `openrouter(...)` (`@openrouter/ai-sdk-provider`, `OPENROUTER_API_KEY`), `createOpenAICompatible({ name, baseURL, apiKey? }).chatModel('llama3.2')`, or a direct provider (`openai(...)`, `anthropic(...)`); subscriptions via `e2e/oauth/*` models `chatgpt()`, `copilot()`, `opencodeConsole()`, `grok()` after `e2e login` — [config](https://e2e.tester.army/docs/reference/config), [cli](https://e2e.tester.army/docs/reference/cli)
- `MODEL_PROVIDER_FAILED` after up to 5 transport retries per call (honours `retry-after`); any single request >120 s is aborted and resent — [errors](https://e2e.tester.army/docs/reference/errors)
- `--debug` prints per-step model/observe/action timings, calls, tokens, cached share and $ cost; `--ai-trace` writes every model call to `<output>/ai-trace.json` (open with `npx unbox-ai`) — [cli](https://e2e.tester.army/docs/reference/cli)

### Inferences
- The per-call "model override" the brief asks about is achieved by declaring several named agents and passing `{ agent: 'name' }` per call, per test/group, or `--agent` on the CLI.
- `blocked` vs failed is a meaningful design choice for CI triage: environment/credential problems are classified separately from product failures and get different exit codes (2/3 vs 1).

### Gaps
- No documented cost/budget cap per run (only per-step budgets); no documented token or dollar ceiling.
- No streaming/async event hook on `agent.act` beyond reporter `step` events.

---

## Q3. screen / Locator + expect

### Takeaway
A Testing-Library-style semantic query layer (`getByRole/Label/Placeholder/Text/DisplayValue/TestId`) over a closed, cross-platform role vocabulary, Playwright-like lazy locators with strictness (exactly one match, else `LOCATOR_AMBIGUOUS` immediately), auto-waiting actions (30 s) and auto-retrying matchers (5 s), Jest-style value matchers (no `toThrow`/`toStrictEqual`/`expect.extend`), `toHaveScreenshot` visual snapshots, `expect.soft`, `expect.poll`, and Standard-Schema `toMatchSchema`.

### Cited Findings
**Queries** — [screen](https://e2e.tester.army/docs/reference/screen)
- `getByRole(role, options?)` / `getByRole(role, name, options?)`, `getByLabel(text, opts)`, `getByPlaceholder(text, opts)`, `getByText(text, opts)`, `getByDisplayValue(value, opts)`, `getByTestId(id, { visible? })`. Options: `exact` (default true = whole text, case-sensitive after whitespace normalization; `false` = case-insensitive substring; a RegExp ignores it), `visible` (drop hidden duplicates before the exactly-one rule). `RoleOptions` add `name`, `checked`, `disabled`, `selected`, `expanded`, `pressed`, `level` (1–6).
- `Role` is a closed vocabulary of ~55 ARIA-like roles (`button`, `link`, `textbox`, `searchbox`, `combobox`, `listbox`, `option`, `checkbox`, `radio`, `switch`, `slider`, `heading`, `tab`, `dialog`, `alert`, `row`, `cell`, `navigation`, `region`, …); `img` is an alias of `image`. Devices map native types onto the same roles; a role with no native widget matches nothing on a phone.
- `getByTestId` reads `data-testid` on web (`web({ testIdAttribute })`), accessibility identifier on iOS, resource id on Android.
- Refinement: `filter({ hasText?, has? })` (hasText string = case-insensitive substring), `first()`, `last()`, `nth(i)`; `hasNot`/`hasNotText` are not supported (`INVALID_LOCATOR`). Escape hatches: `browser.locator(css|xpath)`, `browser.frameLocator(sel)` (web) — [web](https://e2e.tester.army/docs/reference/web); `device.locator('id=... role=...')` agent-device selectors — [mobile](https://e2e.tester.army/docs/reference/mobile)

**Strictness** — actions: zero matches poll until timeout then `LOCATOR_NOT_FOUND`, multiple = `LOCATOR_AMBIGUOUS`; reads: zero = `LOCATOR_NOT_FOUND` immediately; `count()/all()/allTextContents()` never wait; assertions poll — [screen](https://e2e.tester.army/docs/reference/screen)

**Locator actions** (default `config.actionTimeout` 30000, `{ timeout }` override) — `tap` (`click` alias; `{ position, modifiers }`), `doubleTap`, `secondaryTap`, `longPress({ duration 100–10000 })` (default 500 ms web / 1 s mobile), `fill(value | Secret)`, `pressSequentially(text, { delay })` (real keystrokes, refuses Secret), `clear`, `press('ControlOrMeta+a')`, `check`, `uncheck`, `selectOption(label | {label}|{value}|{index})`, `focus`, `hover`, `setInputFiles`, `dragTo(locator)`, `scrollIntoView`, `swipe({ direction, momentum })`. Screen-level: `screen.tapAt({x,y})`, `screen.swipe({direction}|{from,to,duration})`, `screen.scrollUntilVisible(locator, { direction 'down', momentum 'slow', timeout 30000 })`. Playwright's `force`, `trial`, `noWaitAfter` are rejected `INVALID_ARGUMENT`; an action that may have committed is never repeated — [screen](https://e2e.tester.army/docs/reference/screen)

**Reads** — `textContent()` (innerText semantics on web), `inputValue()`, `getAttribute()`, `isVisible/isHidden/isEnabled/isDisabled/isChecked()`, `boundingBox()`, `count()`, `all()`, `allTextContents()`, `waitFor({ state: 'attached'|'detached'|'visible'|'hidden' })`. Text reads on a secure (password) field throw `POLICY_DENIED` — [screen](https://e2e.tester.army/docs/reference/screen)

**expect** — [expect](https://e2e.tester.army/docs/reference/expect)
- Entry: `expect(locator)`, `expect(screen)`, `expect(fixture)` (e.g. `browser`), `expect(value, message?)`, `expect.poll(read, { timeout 5000, interval 100, message })`, `expect.soft(...)`, asymmetric `expect.any/anything/objectContaining/arrayContaining/stringContaining/stringMatching`.
- Locator matchers (default timeout `config.assertionTimeout` 5000; negated matchers pass after 1000 ms of continuous truth): `toBeVisible({visible?})`, `toBeHidden`, `toBeAttached({attached?})`, `toBeEnabled({enabled?})`, `toBeDisabled`, `toBeChecked({checked?})`, `toBeSelected`, `toBeExpanded`, `toBeFocused`, `toHaveText(text | text[])`, `toContainText(text | text[])`, `toHaveValue`, `toHaveAttribute(name[, value])`, `toHaveCount(n)`, `toHaveAccessibleName`, `toHaveScreenshot`. Text options `ignoreCase`, `timeout`. Unsupported Playwright options (`indeterminate`, `useInnerText`) → `INVALID_ARGUMENT`.
- Screenshot matcher: `expect(screen|locator).toHaveScreenshot(name?, { threshold 0.2, maxDiffPixels 0, maxDiffPixelRatio 0, mask: Locator[], maskColor '#ff00ff', timeout })`; stored at `<test file>-snapshots/<name>-<target>-<os>.png`; missing baseline is written and fails (CI: only attached); `-u/--update-snapshots` writes; after a secret fill = `POLICY_DENIED`; Playwright's `fullPage`, `animations`, `clip` rejected.
- `browser` matchers (from `@e2e-dev/web`): `toHaveURL(string|RegExp, { ignoreCase })`, `toHaveTitle`, `toHaveClass(locator, expected)`.
- Value matchers (sync, no retry): `toBe`, `toEqual` (Jest semantics, no `toStrictEqual`), `toMatchObject`, `toBeTruthy/Falsy/Null/Undefined/Defined`, `toHaveLength`, `toHaveProperty(path, value?)`, `toContain`, `toMatch`, `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`, `toBeCloseTo(n, digits=2)`, `toMatchSchema(standardSchema)` (returns typed output). Explicitly absent: `toThrow`, `toBeInstanceOf`, `toBeNaN`, `toStrictEqual`, `resolves`, `rejects`, `expect.extend`.
- `expect.soft` collects failures and fails the attempt once the body settles (one `ASSERTION_FAILED` listing all); `expect.poll` must be awaited or the phase fails `STEP_NOT_AWAITED`; there is no `expect.soft.poll`.

### Inferences
- Porting Playwright tests is mostly mechanical for queries/matchers, but anything relying on raw `page`, custom matchers (`expect.extend`), or `toThrow` needs rewriting.
- The deliberate rejection of unknown options (instead of ignoring them) is a strong-typing/robustness signal: no silent no-ops when a ported option is unsupported.

### Gaps
- No ARIA snapshot matcher (`toMatchAriaSnapshot`-like) documented.
- No documented per-project default for `toHaveScreenshot` thresholds (only per call).

---

## Q4. app fixture — lifecycle across web/mobile (plus browser/device fixtures)

### Takeaway
`app` is a small portable lifecycle surface (`open`, `restart`, `clearState`, `back`, `screenshot`, `baseUrl`); everything platform-specific lives on `browser` (Playwright-backed) or `device` (agent-device-backed). Deep links on mobile go through `device.openLink`, not `app.open`.

### Cited Findings
- `interface App { readonly baseUrl: string | undefined; open(path?): Promise<void>; restart(): Promise<void>; clearState(): Promise<void>; back(): Promise<void>; screenshot(label?): Promise<string>; }` — [app](https://e2e.tester.army/docs/reference/app)
- `open` = declared URL, relative path, or any absolute http(s) URL; on a device it launches the pinned app fresh and takes no path. `restart` recreates the execution context keeping persisted state, then reopens base URL. `clearState` clears persisted client state then reopens. Timeouts: open/restart/clearState `config.timeout` 120000; back/screenshot `actionTimeout` 30000; no per-call timeout options — [app](https://e2e.tester.army/docs/reference/app)
- Errors: `APP_URL_REQUIRED` (path without `app.url`), `POLICY_DENIED` (non-http(s) scheme other than `about:blank`), `APP_UNREACHABLE`, `ACTION_FAILED`, `UNSUPPORTED_CAPABILITY`; `screenshot` after a secret fill = `POLICY_DENIED`. Warning: `clearState` inside a serial group destroys shared state — [app](https://e2e.tester.army/docs/reference/app)
- Mobile: "an attempt launches nothing on its own, so a test starts where the previous one left the app"; `app.launchArguments` and `app.permissions` apply to every fresh launch; `app.url` on mobile is "not supported yet" — [mobile](https://e2e.tester.army/docs/reference/mobile)
- `device` fixture: `locator(selector)`, `setNetwork('online'|'offline')`, `setAirplaneMode`, `setPermission`, `setLocation`, `clearLocation`, `setAppearance('light'|'dark')`, `setOrientation`, `fold(pose)`, `setBiometrics(sensor, 'match'|'nonmatch')`, `enrollBiometrics`, `installApp(path?, { reinstall })`, `openApp(app, { relaunch, launchArguments, permissions })`, `openLink(url, { app })` (deep or web link), `closeApp`, `clearKeychain` (iOS only), `foregroundApp`, `home`, `back`, `alert('accept'|'dismiss')`, `dismissKeyboard`, `clipboard`, `setClipboard`. Each is a recorded step bounded by `actionTimeout` — [mobile](https://e2e.tester.army/docs/reference/mobile)
- `browser` fixture: `goto(url, { waitUntil 'load'|'domcontentloaded'|'networkidle' })`, `reload`, `back`, `forward`, `url`, `title`, `waitForURL`, `locator`, `frameLocator`, `evaluate(fn, arg?)` (JSON-only args/returns), `addInitScript`, `route/unroute` (fulfill/continue/fallback/abort), `waitForResponse`, `cookies/setCookies`, `setViewport`, `onDialog`, `waitForDownload`, `keyboard.{press,type}`, `mouse.{move,wheel,down,up}`. New tabs opened by the app are not followed; no raw Playwright `Page` in tests (only `surfaceOf(engine)` for custom executors) — [web](https://e2e.tester.army/docs/reference/web), [migrate-pw](https://e2e.tester.army/docs/migrate/playwright)
- `web()` options: `browser` (`chromium` default | `firefox` | `webkit` | `BrowserProvider`), `viewport` (default 1280×720, `null` = window size), `screencast`, `connect` (CDP, chromium only), `headers` (only to the app's site), `basicAuth`, `testIdAttribute` (`data-testid`), `userAgent`, `locale`, `timezoneId`, `initScripts`. `@e2e-dev/web` pins `playwright-core` to an exact version; install browsers with `npx @e2e-dev/web install chromium --with-deps` — [web](https://e2e.tester.army/docs/reference/web)
- `mobile()` options: `platform` (`ios`|`android`), `device` (name/UDID/serial, list = pool with one worker per device, or `DeviceProvider` for hosted devices), `session`, `snapshot` (`full` default | `interactive`), `settle` (150 ms), `transition` (500 ms), `videoTouches` (true). Driven via callstack's agent-device, bundled — [mobile](https://e2e.tester.army/docs/reference/mobile)

### Inferences
- Web state isolation is per attempt (fresh context) while mobile carries app state across tests unless the test calls `app.open()`/`clearState()` — mobile suites need explicit resets.

### Gaps
- No documented multi-tab or multi-page API; no `request`/API-client fixture in the reference (Playwright's `request` is absent per migrate page; API testing is done via plain `fetch` + value matchers).

---

## Q5. E2EConfig — every top-level key, defaults, realistic full example

### Takeaway
Config is a typed `e2e.config.ts` (`satisfies E2EConfig`) with strict validation (unknown keys rejected at every level with did-you-mean). The center of gravity is `targets[]` (engine + app under test, including the dev-server `command`), named `agents`, `credentials`/`secrets` (opaque handles, ≥6 chars), and `cache` (replay cache, read-write locally / read-only in CI).

### Cited Findings
**Top-level keys** — [config](https://e2e.tester.army/docs/reference/config)

| Key | Default / range |
|---|---|
| `projectId` | root `package.json` name, 1–256 chars |
| `targets` | required, ≥1 |
| `tests` | every `*.e2e.ts` under `tests/`; `!` excludes |
| `timeout` | 120000 ms (test attempt) |
| `launchTimeout` | 60000 ms (engine init + attempt start) |
| `actionTimeout` | 30000 ms (each engine operation) |
| `assertionTimeout` | 5000 ms (`expect`) |
| `cleanupTimeout` | 30000 ms (afterEach, fixture teardown, engine cleanup) |
| `retries` | 0–10; 1 in CI, else 0 |
| `failOnSkippedFailure` | false |
| `workers` | 1–1024; 1 in CI, else half the cores |
| `artifacts` | `{ store: { put(artifact), putLink?(link) } }` |
| `trace` | `retain-on-failure` (writes `results/<test>/trace.md`) |
| `video` | `off` |
| `output` | `.e2e` |
| `reporters` | builtin ids `list`/`json`/`junit`/`markdown` and/or `Reporter` objects |
| `agents` | `Record<name, AgentConfig>` |
| `cache` | mode `read-write` locally, `read-only` in CI; or `{ mode, store, dir ('.e2e/cache'), strict (false) }` |
| `credentials` | `Record<name, { username, password: string \| () => string \| Promise<string> }>` |
| `secrets` | `Record<name, string \| provider>` |

- `RecordingMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry' | 'on-all-retries'` (Playwright names); precedence config < target < `--trace/--video` < test/describe option — [config](https://e2e.tester.army/docs/reference/config)
- There is no top-level `app` or `url`, no `limits` key, and no `services` key ("not started by this version … A services API returns in a later release") — [config](https://e2e.tester.army/docs/reference/config)
- **Target**: `{ name?, platform?, engine?, app?, trace?, video? }`; a target without engine supports agent tools only — [config](https://e2e.tester.army/docs/reference/config)
- **Target `app`**: `url` (web; plain HTTP only for loopback; port `0` on `127.0.0.1`/`[::1]` = free port substituted into `{port}`), `bundleId`, `appPath` (mobile), `identity` (cache/session key), `environment` (`test`|`staging`|`production`, label only), `launchArguments`, `permissions`, `command`, `readyUrl` (polled until 200–499) — [config](https://e2e.tester.army/docs/reference/config)
- **`app.command`**: `{ executable, args?, cwd?, env?, startupTimeout (60000), shutdownTimeout (10000), log?, reuseExisting? (ignored in CI) }`; never shell-interpreted; child inherits only `PATH`, `HOME`, temp vars + `env`; targets with the same command share one process — [config](https://e2e.tester.army/docs/reference/config)
- Config discovery: `--config` or `e2e.config.ts`/`e2e.config.mts` walking up to repo root (both present = `CONFIG_AMBIGUOUS`); e2e loads no `.env` itself — use `process.loadEnvFile('.env')`; TypeScript is compiled by oxc per file without type info (`import type` needed) — [config](https://e2e.tester.army/docs/reference/config), [errors](https://e2e.tester.army/docs/reference/errors)
- Each worker re-imports the config; a differing digest is `CONFIG_NOT_DETERMINISTIC` — [config](https://e2e.tester.army/docs/reference/config)
- CI mode (`CI` set and not blank/`0`/`false`): retries 1, workers 1, cache read-only, `test.only` → `ONLY_IN_CI`, `reuseExisting` ignored — [config](https://e2e.tester.army/docs/reference/config)
- `secrets.get(name)` returns an opaque `Secret` (purpose `password` | `generic-secret`); overrides `E2E_SECRET_<NAME>`, `E2E_USER_<NAME>_USERNAME/_PASSWORD`; values <6 chars are `INVALID_CONFIG` (redaction would eat ordinary text) — [config](https://e2e.tester.army/docs/reference/config), [env](https://e2e.tester.army/docs/reference/environment)

### Inferences
- Realistic full config, assembled from documented keys (model ids are the docs' own examples; values chosen for illustration):
```ts
import type { E2EConfig } from 'e2e';
import { secrets } from 'e2e';
import { web } from '@e2e-dev/web';
import { mobile } from '@e2e-dev/mobile';
import { mobileTools } from '@e2e-dev/mobile/tools';
import { gateway } from 'ai';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');

const iphone = mobile({ platform: 'ios', device: ['iPhone 17'] });

export default {
  projectId: 'shop',
  tests: ['tests/**/*.e2e.ts', '!tests/wip/**'],
  timeout: 120_000, launchTimeout: 60_000, actionTimeout: 30_000,
  assertionTimeout: 5_000, cleanupTimeout: 30_000,
  workers: 4,                       // retries left to the CI/local defaults
  output: '.e2e',
  trace: 'retain-on-failure',
  video: 'off',
  reporters: ['list', 'junit', 'markdown'],
  cache: { mode: 'read-write', dir: '.e2e/cache', strict: false },
  targets: [
    {
      name: 'chromium',
      engine: web({ viewport: { width: 1440, height: 900 },
                    basicAuth: { username: 'preview', password: secrets.get('previewPassword') } }),
      app: {
        url: 'http://127.0.0.1:0',
        command: { executable: 'pnpm', args: ['dev', '--port', '{port}'], env: { PORT: '{port}' },
                   log: '.e2e/logs/app.log', startupTimeout: 90_000 },
      },
    },
    { name: 'ios', engine: iphone,
      app: { bundleId: 'com.example.shop', launchArguments: ['-e2e', 'YES'], permissions: { camera: 'grant' } } },
  ],
  agents: {
    default:  { model: gateway('openai/gpt-6-luna-fast'), context: 'Plans are called tiers.', tools: mobileTools(iphone) },
    thorough: { model: gateway('anthropic/claude-opus-5'), judge: gateway('openai/gpt-6-luna-fast'), maxSteps: 40 },
  },
  credentials: { member: { username: 'ada@example.test', password: 'local-dev-password' } }, // CI: E2E_USER_MEMBER_PASSWORD
  secrets: { previewPassword: process.env.PREVIEW_PASSWORD ?? 'local-preview' },
} satisfies E2EConfig;
```
- Strict config validation plus explicit migration errors for removed keys make upgrades loud rather than silent.

### Gaps
- No documented `globalSetup`, environment-per-target variables beyond `command.env`, or per-target `retries/timeout` overrides.
- Whether `projectId` is used beyond telemetry/reporting is not stated in the reference.

---

## Q6. CLI — commands, flags, output formats, exit codes

### Takeaway
13 command forms: `init`, `login`, `logout`, `models`, `guide`, `mcp`, `run`, `explore`, `list`, `cache ls|clear|stats`, `feedback`, `telemetry`, plus `--help/--version`. `run` has a Playwright-grade filter set (tags, grep, `file:line`, `--last-failed`, `--shard`, `--repeat-each`, `--max-failures`) and four built-in reporters (`list`, `json`, `junit`, `markdown`). Exit codes are class-based: 0/1/2/3/4/130.

### Cited Findings
- Requires Node.js ≥24.8 or ≥22.22.3 on Node 22; runs on Node even via `bunx`; Bun/Deno runtimes unsupported (`NODE_UNSUPPORTED`) — [cli](https://e2e.tester.army/docs/reference/cli), [errors](https://e2e.tester.army/docs/reference/errors)
- **init [directory]** (`-y/--yes` = Web engine + Vercel AI Gateway, skill + MCP config in both locations, no install): wizard picks engine (Web/Playwright default, Mobile, None), model provider (Vercel AI Gateway, OpenRouter, OpenAI-compatible, ChatGPT, GitHub Copilot, OpenCode Console, SuperGrok, None), agent skill location (`.agents/skills/`, `.claude/skills/`), MCP registration (`.mcp.json`, `.cursor/mcp.json`). Creates `package.json` script `test:e2e`, `e2e.config.ts`, `tests/example.e2e.ts`, `.gitignore` entries — [cli](https://e2e.tester.army/docs/reference/cli)
- **login [provider]** `openai` (`--device`), `github-copilot` (`--from-gh`, `--client-id`, `--enterprise-url`), `opencode-console`, `spacexai` (SuperGrok); stores `~/.config/e2e/oauth.json`. **logout**, **models [provider]** (lists models a stored login serves) — [cli](https://e2e.tester.army/docs/reference/cli)
- **guide [topic]**: prints the agent skill; topics `setup`, `writing-tests`, `agent`, `running`, `explore`, `debugging`, `mcp`, `bug-bash`; same skill via `npx skills add tester-army/e2e` — [cli](https://e2e.tester.army/docs/reference/cli)
- **run [files...]** positionals: path, directory, bare name, `file:line`, quoted glob (`*`, `?`, whole `**`; braces/classes = `INVALID_GLOB`). Flags: `--config`, `--target <ids>`, `--tag`, `--tag-mode any|all`, `--exclude-tag`, `--grep`, `--grep-invert` (`'/x/i'` for flags), `--last-failed`, `--shard i/n`, `--headed`, `--agent <names>`, `--retries 0-10`, `--workers 1-1024`, `--repeat-each n`, `--max-failures n`, `--reporter list,json,junit,markdown`, `--output <dir>`, `--no-cache`, `--strict-cache`, `-u/--update-snapshots`, `--pass-with-no-tests`, `--debug`, `--ai-trace`, `--trace [mode]`, `--video [mode]`. Filter order: positionals → `.only` → tag → exclude-tag → grep → grep-invert → last-failed → platform/capability → shard — [cli](https://e2e.tester.army/docs/reference/cli)
- **explore [goal]** (default goal "Explore the app and find bugs"): agent plans one step at a time, reports via `report_finding`; flags `--config`, `--target`, `--agent`, `--session <name>` (start signed in), `--max-steps 1-12` (default 8), `--timeout 180000-900000` (default 600000), `--headed`, `--reporter`, `--output`, `--debug`, `--ai-trace`, `--trace`, `--video`; per-step budget 40 actions/40 model calls; findings `issue` (functional) vs `warning` (cosmetic), severity 1 `trivial`…5 `critical`; cache off, 0 retries; exit 0 = no issue, 1 = issue found/blocked, 2/3 config/infra, 130 Ctrl-C — [cli](https://e2e.tester.army/docs/reference/cli)
- **list [files...]**: dry-run selection (`file › title [target] #tag`), `--reporter list|json` (`{ pairs: [...] }`); programmatic equivalent `list()` from `e2e/runner` — [cli](https://e2e.tester.army/docs/reference/cli), [runner](https://e2e.tester.army/docs/reference/runner)
- **cache ls | stats | clear** (`--config`): file store only; custom `cache.store` → exit 2 — [cli](https://e2e.tester.army/docs/reference/cli)
- **feedback -m <text>** (`--type bug|docs|feature|other`, `--task`, `--expected`, `--actual`, `--approach`, `--command`, `--agent`, `--dry-run`): sends one PostHog event with env-var secret scrubbing; blocked by `E2E_TELEMETRY_DISABLED`/`DO_NOT_TRACK` — [cli](https://e2e.tester.army/docs/reference/cli)
- **telemetry [status|enable|disable]** — [cli](https://e2e.tester.army/docs/reference/cli)
- **Output**: `list` (TTY live progress incl. agent step, model turns, tool calls), `json` (report to stdout, `schemaVersion` `report-1`, schema `schema/report-v1.schema.json`; cannot combine with `list`), `junit` (`junit.xml`, one testsuite per file), `markdown` (`summary.md`, used for PR comments by `@e2e-dev/github`). `report.json` is always written under `.e2e/` for runs that reach tests — [cli](https://e2e.tester.army/docs/reference/cli)
- **Exit codes**: 0 all passed/flaky/explicitly skipped; 1 test or setup failure/timeout; 2 CLI/config/collection/dependency/credential/model-config/policy error; 3 engine/app process/model provider/artifact/cleanup infrastructure failure (and undeliverable feedback); 4 internal runner invariant; 130 interrupted. Precedence `130 > 4 > 3 > 2 > 1 > 0` — [cli](https://e2e.tester.army/docs/reference/cli)
- Signals: first SIGINT/SIGTERM interrupts gracefully (report written, exit 130), second forces, third exits immediately after killing app process groups — [cli](https://e2e.tester.army/docs/reference/cli)
- No HTML reporter ("no equivalent; `markdown` writes `.e2e/summary.md`, and each failed test gets a `trace.md` page") — [migrate-pw](https://e2e.tester.army/docs/migrate/playwright)

### Inferences
- There is no `e2e test`, `e2e report`/`show-report`, `e2e bash`, or `e2e bug-bash` command; "bug bash" is a guide topic/workflow built on MCP sessions (see Q7).
- `--last-failed` + `run.carried` + `@e2e-dev/github` fold is a notably mature CI rerun story.

### Gaps
- No `--update-cache`/re-record flag beyond running read-write without `--strict-cache`; no `--list` JSON schema version documented separately from report-1.

---

## Q7. MCP server — tools exposed to a coding agent

### Takeaway
`e2e mcp` is a stdio MCP server with exactly four MCP tools (`open_session`, `tools`, `call`, `close_session`) that proxy a per-session catalog of app tools (observe, the agent's action verbs, `locate`, masked `screenshot`, point tools, recording). It needs no model, supports up to 16 parallel sessions (default 4), and enforces the same secret/pixel rules as runs.

### Cited Findings
- Flags: `--config <path>`, `--target <name>`, `--headed`, `--max-sessions <n>` (1–16, default 4). Register with `claude mcp add e2e -- npx e2e mcp` or `{"mcpServers":{"e2e":{"command":"npx","args":["e2e","mcp"]}}}`; the server "needs no model" — [mcp](https://e2e.tester.army/docs/reference/mcp)
- MCP tools: `open_session(target?, config?, headed?)` → session id, catalog, first observation (starts app command, boots engine); `tools(tool?, session?)` → catalog / one tool's schema; `call(tool, args?, session?)` → runs one catalog tool with closed-schema validation; `close_session(session?)` — [mcp](https://e2e.tester.army/docs/reference/mcp)
- Catalog: `observe` (`#id role "name"` lines + path + revision), `tap`, `double_tap`, `long_press`, `right_click`, `hover`, `type`, `press`, `select`, `check`, `scroll`, `scroll_to`, `drag`, `upload`, `navigate`, `back`, `type_secret`, `dismiss_keyboard`, `locate` (returns match count and "the `screen.*` call to write"), `screenshot`, `tap_at`, `hover_at`, `type_at`, `press_at`, `select_at`, `start_recording`, `stop_recording`; project tools from `agents.default.tools`; `mobileTools` adds `open_app`, `swipe`, `alert` — [mcp](https://e2e.tester.army/docs/reference/mcp)
- Resources: `e2e://guide`, `e2e://guide/{topic}`. Sessions close after 30 idle minutes, 4 hours max, on disconnect or signal. Nothing a session does is recorded as a test result or into the replay cache. Errors: `TARGET_REQUIRED`, `NO_SESSION`, `SESSION_REQUIRED`, `SESSION_OPEN`, `ENGINE_IN_USE`, `CONFIG_IN_USE`, `UNKNOWN_TOOL`, `UNKNOWN_TOPIC`. Exit 0 on disconnect/signal, 2 on invalid CLI — [mcp](https://e2e.tester.army/docs/reference/mcp), [errors](https://e2e.tester.army/docs/reference/errors)
- "Bug bashes use this: every verifying subagent drives its own session" — [mcp](https://e2e.tester.army/docs/reference/mcp)

### Inferences
- The `locate` tool returning the exact `screen.*` call is the bridge from exploration to deterministic test code; the intended loop is coding-agent explores via MCP → writes `*.e2e.ts`.

### Gaps
- No documented auth/remote transport (stdio only); no HTTP/SSE mode.

---

## Q8. Reporters — built-ins and custom interface

### Takeaway
Four built-ins (`list`, `json`, `junit`, `markdown`) plus a small custom `Reporter { name, onEvent?, onRunFinished? }` contract over a typed JSON event stream; `@e2e-dev/github` is the first-party PR-comment reporter.

### Cited Findings
- `interface Reporter { readonly name: string; onEvent?(event: RunEvent): void; onRunFinished?(run: FinishedRun, signal: AbortSignal): Promise<ReporterSummary | void>; }`; `FinishedRun { report, status, exitCode, projectRoot, reportPath, artifactsRoot, aiTracePath, traces, lastRun? }`; `ReporterSummary = { label, text }[]` printed under the `list` summary — [reporters](https://e2e.tester.army/docs/reference/reporters)
- Events: `run-started`, `plan`, `notice`, `output`, `setup`, `test-started`, `step` (phases `start`/`end`/`event`/`activity`/`replay` with `identity { attemptId, attemptIndex, stepId, stepIndex }`), `test-finished`, `serial-group`, `explore`, `run-error`, `run-interrupted`, `run-stopped`, `run-finished`; "New event types are added over time" — [reporters](https://e2e.tester.army/docs/reference/reporters)
- `onEvent` must not block/throw (a throw quarantines the reporter); `onRunFinished` reporters run concurrently with a one-minute deadline and cannot change status/exit code; `--reporter` replaces only built-ins; `renderMarkdownReport(report, options)` is exported — [reporters](https://e2e.tester.army/docs/reference/reporters)
- `@e2e-dev/github` reads `GITHUB_ACTIONS`, `GITHUB_TOKEN`/`GH_TOKEN`, `GITHUB_STEP_SUMMARY` etc.; posts nothing outside Actions — [env](https://e2e.tester.army/docs/reference/environment)

### Inferences
- Report JSON (`report-1`) is the stable integration point; custom dashboards should consume `report.json` rather than events.

### Gaps
- No built-in HTML, Allure, or Slack reporter.

---

## Q9. Errors — classes and codes worth knowing

### Takeaway
Every error has a class that fixes the exit code (test 1, configuration 2, infrastructure 3, internal 4, interrupted 130) and a closed code. The ones the brief asks about map to: cache drift → `REPLAY_STALE` (only under strict cache); budget exceeded → `STEP_BUDGET_EXHAUSTED` / `STEP_TIMEOUT` / `CONTEXT_OVERFLOW`; secret leak blocked → `POLICY_DENIED` (plus `PIXEL_TAINTED` / `MASKING_UNPROVEN` degradation markers).

### Cited Findings
- `AgentError { code, explanation, screenshot?, blocked }`, recognized with `isAgentError` — [errors](https://e2e.tester.army/docs/reference/errors)
- Agent codes (class/exit): `AUTH_CREDENTIAL_UNAVAILABLE` (cfg/2), `AUTH_CREDENTIAL_INVALID` (cfg/2), `SECRET_UNAVAILABLE` (cfg/2), `ENVIRONMENT_UNAVAILABLE` (infra/3), `SEED_DATA_MISSING` (cfg/2), `TEST_SETUP_FAILED` (cfg/2), `AUTOMATION_UNSUPPORTED` (test/1), `MODEL_UNAVAILABLE` (cfg/2), `POLICY_DENIED` (cfg/2), `APP_UNREACHABLE` (infra/3), `APP_ALREADY_RUNNING` (infra/3), `MODEL_PROVIDER_FAILED` (infra/3), `CANCELLED` (infra/3), `MODEL_OUTPUT_INVALID` (test/1), `APP_NOT_OPEN`, `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`, `ACTION_FAILED`, `STEP_BUDGET_EXHAUSTED`, `STEP_TIMEOUT`, `CONTEXT_OVERFLOW`, `ASSERTION_FAILED`, `ASSERTION_INCONCLUSIVE`, `AUTHENTICATION_FAILED`, `STEP_NO_CONCLUSION` (all test/1), `REPLAY_STALE` (cfg/2) — [errors](https://e2e.tester.army/docs/reference/errors)
- `REPLAY_STALE`: under `cache.strict` / `--strict-cache` a recording that exists but no longer replays fails with no model call instead of handing off to the agent; not retried; re-record with a read-write run — [errors](https://e2e.tester.army/docs/reference/errors)
- Runner codes include `CONFIG_NOT_FOUND`, `CONFIG_AMBIGUOUS`, `CONFIG_LOAD_FAILED`, `INVALID_CONFIG`, `CONFIG_NOT_DETERMINISTIC`, `APP_URL_REQUIRED`, `INVALID_APP_URL`, `INVALID_GLOB`, `UNKNOWN_TARGET`, `UNSUPPORTED_ARTIFACT`, `UNSUPPORTED_CAPABILITY`, `NO_TESTS`, `NO_LAST_RUN`, `ONLY_IN_CI`, `COLLECTION_ERROR`, `SESSION_MISMATCH/EXPIRED/INVALID/UNAVAILABLE/CONTRACT`, `TEST_TIMEOUT`, `STEP_NOT_AWAITED` (un-awaited step), `UNHANDLED_REJECTION`, `HOOK_FAILED`, `LAUNCH_TIMEOUT`, `CLEANUP_TIMEOUT`, `BROWSER_INSTALL_FAILED`, `WORKER_*`, `NODE_UNSUPPORTED`, `TYPESCRIPT_COMPILER_UNAVAILABLE` (oxc native bindings missing, e.g. `npm --omit=optional`), `ENGINE_FAILURE`, `REPORT_WRITE_FAILED`, `EVALUATE_FAILED`, `INTERRUPTED`; argument validation uses `INVALID_ARGUMENT` / `INVALID_LOCATOR` (test/1) — [errors](https://e2e.tester.army/docs/reference/errors)
- "The `internal` class and exit code 4 are reserved … no first-party code raises a code in that class today" — [errors](https://e2e.tester.army/docs/reference/errors)
- Engine-level codes: `NODE_STALE`, `FRAME_NOT_FOUND` (the only retryable two), `FRAME_AMBIGUOUS`, `NOT_ACTIONABLE`, `ACTION_MAY_HAVE_COMMITTED`, `OPERATION_TIMEOUT`, `CANCELLED`, `UNSUPPORTED_CAPABILITY`, `INVALID_STATE`, `ENGINE_FAILURE`, mapped to runner codes — [engine](https://e2e.tester.army/docs/reference/engine)

### Inferences
- Without strict mode, cache drift is silent self-healing (`agent-concluded` hand-off), visible only via `ActResult.cache` / report — teams wanting deterministic CI should use `--strict-cache`.

### Gaps
- No error documentation for model "hallucinated success" beyond `STEP_NO_CONCLUSION`/judgment codes.

---

## Q10. Environment variables

### Takeaway
The runner reads a closed, small set: credential/secret overrides (`E2E_USER_*`, `E2E_SECRET_*`), `CI`, colour/diagnostic vars, telemetry opt-outs (`E2E_TELEMETRY_DISABLED`, `DO_NOT_TRACK`), subscription login vars, and engine/integration vars. Model API keys are read by AI SDK providers, not by e2e.

### Cited Findings
- Model: providers read `AI_GATEWAY_API_KEY` (or Vercel OIDC), `OPENROUTER_API_KEY`, `OPENAI_API_KEY`; e2e reads `E2E_OAUTH_CREDENTIALS` (oauth.json contents for headless machines), `OPENCODE_API_KEY`, `XDG_CONFIG_HOME` — [env](https://e2e.tester.army/docs/reference/environment)
- Credentials/secrets: `E2E_USER_<NAME>_USERNAME`, `E2E_USER_<NAME>_PASSWORD`, `E2E_SECRET_<NAME>` (`<NAME>` uppercased, non `A-Z0-9` → `_`; collisions = `INVALID_CONFIG`) — [env](https://e2e.tester.army/docs/reference/environment)
- Run mode: `CI` (flag) — [env](https://e2e.tester.army/docs/reference/environment)
- Diagnostics: `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`, `GITHUB_SHA`/`GITHUB_HEAD_REF`/`GITHUB_REF_NAME` (for `run.vcs`); `--debug`/`--ai-trace` are flags not vars — [env](https://e2e.tester.army/docs/reference/environment)
- Telemetry: `E2E_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `E2E_TELEMETRY_DEBUG` (print, don't send), `E2E_TELEMETRY_FLEET` (attribute to `fleet:<name>`), `XDG_CONFIG_HOME`, `APPDATA`; telemetry also detects CI vendors and coding agents (`CLAUDECODE`, `CURSOR_AGENT`, `CODEX_*`, `GEMINI_CLI`, …) and sends only a derived name — [env](https://e2e.tester.army/docs/reference/environment)
- Reporter (`@e2e-dev/github`): `GITHUB_ACTIONS`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_EVENT_NAME`, `GITHUB_WORKFLOW`, `GITHUB_JOB`, `GITHUB_TOKEN`/`GH_TOKEN`, `GITHUB_EVENT_PATH`, `GITHUB_REF`, `GITHUB_SHA`, `GITHUB_WORKSPACE`, `GITHUB_SERVER_URL`, `GITHUB_API_URL`, `GITHUB_STEP_SUMMARY` — [env](https://e2e.tester.army/docs/reference/environment)
- Engines: `PLAYWRIGHT_BROWSERS_PATH`, `PLAYWRIGHT_SKIP_BROWSER_GC` (defaults 1), `KERNEL_API_KEY` (`@e2e-dev/kernel`), `EXPO_TOKEN` (`@e2e-dev/eas`), `HOME`/`USERPROFILE`, `E2E_AGENT_DEVICE_POOL_<TARGET>_<digest>` (internal) — [env](https://e2e.tester.army/docs/reference/environment)
- `APP_URL` is read by the scaffolded config, not by the runner — [env](https://e2e.tester.army/docs/reference/environment)
- Telemetry goes to PostHog EU (`eu.i.posthog.com`), one request per CLI invocation unless opted out; in CI nothing is printed and no file written — [security-model](https://e2e.tester.army/docs/security), [cli](https://e2e.tester.army/docs/reference/cli)

### Inferences
- Telemetry is opt-out (on by default); orgs should set `E2E_TELEMETRY_DISABLED=1` / `DO_NOT_TRACK=1` in CI images if policy requires.

### Gaps
- No env var to select model/agent or override timeouts at runtime (must use config or CLI flags).

---

## Q11. Engine contract (`e2e/engine`)

### Takeaway
An engine is a plain object passed to `defineEngine(spec)` with `name`, `version`, `spiVersion: 1`, optional `platform`/`workers`, and optional capability members (`observe`, `perform`+`actions`, `locate`, `performAt`+`pointerActions`, `keyboard`, `state`, `artifacts`, `session`, `fixtures`) plus lifecycle hooks; the harness derives capabilities from what is present and owns polling, strictness, redaction, revisioning and budgets.

### Cited Findings
- `defineEngine(spec: Engine): EngineHandle`, `isEngineHandle(value)`; validation failures are `INVALID_CONFIG` (e.g. `perform` without `observe`, `actions` outside `LOCATOR_ACTION_KINDS`, `spiVersion` ≠ 1) — [engine](https://e2e.tester.army/docs/reference/engine)
- Members: `observe(ctx, { pixels?, pixelFallback?, comparable? }) → EngineSnapshot`; `perform(ref, action, ctx)` with declared `actions`; `locate(expression, ctx) → SemanticNode[]`; `performAt(point, action, ctx)` with `pointerActions`; `tapModifiers`; `keyboard { type(text, {replace}), press(key), dismiss? }`; `fixtures` (contributed fixtures, e.g. `browser`, `device`); `state { capture, restore }`; `artifacts { screenshot, startVideo?, stopVideo? }`; `validateApp(app, info)`; `secrets`; `session { open?, back?, restart?, reset? }` — [engine](https://e2e.tester.army/docs/reference/engine)
- Lifecycle & budgets: `prepare` (once per target in runner, no budget, can lower workers and pass env), `finish` (cleanupTimeout), `init` (per worker, launchTimeout), `startAttempt` (launchTimeout), `settleAttempt`, `endAttempt`, `dispose` (cleanupTimeout) — [engine](https://e2e.tester.army/docs/reference/engine)
- Capabilities: `observation`, `actions`, `location`, `pointer`, `keyboard`, `state`, `artifacts` + one per contributed fixture; `OperationContext { signal, timeoutMs, runId, attemptId, origin: 'test'|'agent' }` — [engine](https://e2e.tester.army/docs/reference/engine)
- Observation: `EngineSnapshot { location?, root: SemanticNode, viewport, truncated?, treeUnavailable?, pixels?, maskedRegionCount? }`; `SemanticNode { ref, role?, name? (≤256), text? (≤512), value?, selection?, testId?, inputPurpose?, states? (checked/disabled/selected/expanded/pressed/focused/hidden/secure), level?, attributes?, rect?, selector?, framePath?, children? }`; query kinds `role|label|placeholder|text|displayValue|testId` — [engine](https://e2e.tester.army/docs/reference/engine)
- Closed action grammar `LOCATOR_ACTION_KINDS`: `tap`, `doubleTap`, `secondaryTap`, `longPress`, `fill`, `clear`, `press`, `check`, `uncheck`, `focus`, `hover`, `scrollIntoView`, `selectOption`, `setInputFiles`, `dragTo`, `swipe` ("The grammar is closed. Anything beyond it is an agent-side `defineTool`"); `POINTER_ACTION_KINDS`: `tap`, `doubleTap`, `secondaryTap`, `longPress`, `hover`, `dragTo`, `swipe`, `swipeTo`; key grammar modifiers `Shift|Control|Alt|Meta|ControlOrMeta` + named key or char — [engine](https://e2e.tester.army/docs/reference/engine)
- State snapshots are treated as credentials: harness encrypts at rest (per-run AES-256-GCM key never on disk), binds and deletes them; engines must not persist/log them — [engine](https://e2e.tester.army/docs/reference/engine)
- Helpers: `resolveExpression`, `matchesText`, `toTextPattern`, `urlMatches`, `pollCondition`, `validateJsonValue`, `rejectUnknownKeys`, `rejectUnknownOptions`, `stopProviderRecording`; runner error classes `TestError`, `ConfigurationError`, `InfrastructureError` — [engine](https://e2e.tester.army/docs/reference/engine)
- "Additive optional members never bump [spiVersion]; changed required semantics do" — [engine](https://e2e.tester.army/docs/reference/engine)

### Inferences
- The SPI is designed for third-party surfaces (desktop, TV, custom canvases): only `observe` is needed for judgments; actions/locators/pixels are opt-in tiers. First-party engines today: `@e2e-dev/web` (Playwright) and `@e2e-dev/mobile` (agent-device).

### Gaps
- No documented third-party engines in the reference itself (a "Writing an engine" guide exists outside Reference).

---

## Q12. Security rules (`/docs/reference/security`, fetched live)

### Takeaway
The live reference page "Security rules" exists (not in the downloaded file, which instead has the narrative "Security model" page) and lists runner-enforced rules: app content is untrusted evidence, closed tool schemas, `POLICY_DENIED` denials, secret-fill pixel withholding, redaction scope and limits, encrypted per-run sessions, unsigned-but-validated cache, and an outbound-connection list.

### Cited Findings
- Policy denials (`POLICY_DENIED`): non-`http(s)`/`about:blank` navigation, malformed URLs, `Secret` into JSON sink, reading secure fields, `type_secret` undeclared or into non-editable node, password into non-password field, mutating project tool requesting observation, `vision: 'only'` with pixels withheld, screenshots after a secret fill or without proven masking, uploads outside project/hidden files — [security-rules](https://e2e.tester.army/docs/reference/security)
- No origin allowlist: "The agent can follow the app to other sites and use the step's secrets there"; redirects not re-checked, popups not attached; `basicAuth` answers 401 from any origin — [security-rules](https://e2e.tester.army/docs/reference/security), [security-model](https://e2e.tester.army/docs/security)
- After any secret fill: pixel tools, `app.screenshot()`, `toHaveScreenshot()` blocked for the rest of the attempt; failure screenshots omitted — [security-rules](https://e2e.tester.army/docs/reference/security)
- Redaction to `<secret:name>` covers raw/JSON/HTML/percent-encoded forms, any case, collapsed whitespace, truncated prefixes; does not cover transformed values, base64/hashes, other Unicode forms, values split across nodes, video, `command.log` — [security-rules](https://e2e.tester.army/docs/reference/security)
- Cache entries are unsigned (review like code), validated, ≤1 MiB, secret-free by construction, never replay across agents or origins — [security-model](https://e2e.tester.army/docs/security)
- e2e does not sandbox test code/config: "Run untrusted pull request code in an external sandbox without secrets or write tokens" — [security-model](https://e2e.tester.army/docs/security)
- Live page's outbound list adds `mcr.microsoft.com`, subscription sign-in endpoints and the package registry during `e2e init`, which the downloaded "Security model" page does not list — [security-rules](https://e2e.tester.army/docs/reference/security); compare [security-model](https://e2e.tester.army/docs/security)

### Inferences
- The downloaded `llms-full.txt` is slightly older than the live site (missing the Security rules page and some details), so other reference details may also have moved on in 0.18/0.19.

### Gaps
- The live page was read through a summarizing fetch, so exact wording beyond quoted names was not verified line by line.

---

## Q13. Signals of maturity

### Takeaway
Very young but fast-moving and carefully specified: the `e2e` npm package's current lineage started with canaries on 14 Sep 2026, first stable 0.15.0 on 30 Sep 2026, and reached 0.18.0 by 6 Oct 2026 (four minor releases in a week) with nightlies daily; the docs show many "removed/renamed" migration errors and several "not yet" features, but also formal stability contracts (report schema `report-1`, engine `spiVersion` 1, closed error codes).

### Cited Findings
- npm `e2e`: dist-tags `latest` 0.18.0, `nightly` 0.19.0-nightly-20261009094406, `canary` 0.15.0-canary-20260929180659, `beta` 0.15.0-canary-20260917081546; 0.15.0 published 2026-09-30, 0.15.1 2026-10-01, 0.15.2 and 0.16.0 2026-10-02, 0.17.0 2026-10-04, 0.18.0 2026-10-06; 14 canaries from 2026-09-14; earlier versions 0.0.1–0.0.8 date from 2014–2016 and 0.1.0 from 2026-07-21; license Apache-2.0; repo `github.com/tester-army/e2e` (packages/e2e); description "SDK, runner, and CLI for agentic end-to-end testing"; maintainers okwasniewski, szymonrybczak — [npm](https://registry.npmjs.org/e2e)
- `@e2e-dev/web` latest 0.13.0, `@e2e-dev/mobile` latest 0.10.0, `@e2e-dev/github` latest 0.4.0; all created 2026-09-28 — [npm @e2e-dev/web](https://registry.npmjs.org/@e2e-dev/web), [npm @e2e-dev/mobile](https://registry.npmjs.org/@e2e-dev/mobile), [npm @e2e-dev/github](https://registry.npmjs.org/@e2e-dev/github)
- Docs examples show `npx e2e --version` → `0.14.0` — [cli](https://e2e.tester.army/docs/reference/cli)
- "Not yet"/later items: `services` ("A services API returns in a later release") — [config](https://e2e.tester.army/docs/reference/config); `app.url` on mobile "not supported yet" — [mobile](https://e2e.tester.army/docs/reference/mobile); tab switching "has no verb yet" — [agent](https://e2e.tester.army/docs/reference/agent); Android display density "not applied yet" — [mobile](https://e2e.tester.army/docs/reference/mobile); `globalSetup`, `fullyParallel`, `describe.only`, `describe.configure parallel` "not yet", no HTML reporter — [migrate-pw](https://e2e.tester.army/docs/migrate/playwright)
- Removed/renamed with explicit migration errors: `--artifacts` → `--output`; `artifacts: [...]`/`artifacts.kinds`/`artifacts.trace`/`artifacts.video` → `trace`/`video`; `web({ video })` → `screencast`; `web({ url })`/`mobile({ app })` → target `app`; agent `timeout` → `judgmentTimeout`; `maxTurns` → `maxModelCalls`; top-level `limits` removed; `specVersion` removed; trace `'all'`/`'retries'` → `'on'`/`'on-all-retries'`; engine `startTrace/stopTrace` removed — [config](https://e2e.tester.army/docs/reference/config), [errors](https://e2e.tester.army/docs/reference/errors), [engine](https://e2e.tester.army/docs/reference/engine)
- Stability contracts: report `schemaVersion` `report-1` ("The shape changes only with the `schemaVersion` field") — [cli](https://e2e.tester.army/docs/reference/cli); engine `spiVersion` rules — [engine](https://e2e.tester.army/docs/reference/engine); reporter events "added over time", handle unknown types — [reporters](https://e2e.tester.army/docs/reference/reporters)
- No "experimental"/"unstable"/"beta" labels found in any reference page (grep of the downloaded reference section) — [llms-full.txt via docs](https://e2e.tester.army/docs)
- Vulnerability reporting via GitHub security advisories / security@tester.army; SECURITY.md states supported versions — [security-model](https://e2e.tester.army/docs/security)

### Inferences
- The `e2e` npm name appears to have been taken over from an unrelated 2014–2016 package; the docs' `0.14.0`/`0.13.0` examples predate any published `e2e` 0.13/0.14 (none exist on npm), so docs examples lag the release train or reflect pre-publication versions. (Inference — not stated anywhere.)
- Release cadence (~4 minors/week, daily nightlies, multiple renamed config keys) means pinning exact versions and reading release notes before upgrades is prudent; the loud `INVALID_CONFIG` migration messages mitigate silent breakage.
- The depth of the reference (closed error vocabularies, explicit edge-case semantics, Playwright parity tables) is unusually high for a product <1 month past first stable, suggesting heavy internal use before public release.

### Gaps
- No changelog/release notes in the reference section or `llms.txt`; GitHub releases were not checked here (covered by the community/maturity researcher).
- Maintainer/company relationship (TesterArmy vs. individual maintainers) not established from these sources.
