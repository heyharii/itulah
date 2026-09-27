# Project testing guardrails

- Do not start validation with unit tests.
- Prioritize targeted integration tests, then E2E through agent-browser + Lightpanda headless.
- Use headed Chrome only for visual or browser-fidelity checks.
- Keep Portless routes and agent-browser sessions isolated per project/worktree.
- Run targeted unit tests later only when they explain an integration/E2E failure or the user asks for them.
