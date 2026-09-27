# Development and testing policy

## Default validation order

1. Inspect the changed flow and its existing integration/E2E entry points.
2. Run targeted integration tests first for API, database, authentication, queues, and other cross-module behavior.
3. Start the web app through Portless (`pl-start`, then `up`) and run targeted E2E smoke flows through `e2e` or `tb`.
4. Use agent-browser with Lightpanda headless by default. Use `e2e-headed`, `t-headed`, or `ab-batch chrome` only when visual rendering, screenshots, DevTools, extensions, or full Chrome fidelity is needed.
5. Run targeted unit tests only after integration/E2E evidence points to an isolated function, or when the user explicitly requests them. Do not begin a task with the broad unit-test suite.

## Browser and parallel-work rules

- Keep the project-specific `AGENT_BROWSER_SESSION`; never reuse another project or worktree's session.
- Prefer Portless URLs from `portless get`; do not hardcode another project's port.
- Keep E2E data isolated and avoid mutating production or shared external data.
- On failure, preserve the browser snapshot, relevant server log, and the exact command/URL before changing the test strategy.
- Distinguish product failures from infrastructure failures such as a missing database, proxy, credentials, or browser engine.

## Agent behavior

- Do not claim a test ran unless its output was observed.
- Keep validation targeted to the changed user flow; avoid unrelated broad suites unless requested.
- When a project has no integration or E2E coverage for the changed flow, report that gap instead of silently replacing it with a broad unit-test run.
