# e2e by TesterArmy: company, open-source project health, community reception and competitive landscape (as of 2026-10-09)

Data was collected on 2026-10-09 unless a figure carries another date. "Single source" marks a claim with only one supporting source. Live GitHub and npm figures came from `gh api` and registry.npmjs.org. Every Q1 figure was read from the registry or the API on 2026-10-09.

## Q1. GitHub repo and open-source project health

### Takeaway
e2e is real and used, but it is very young. The public repo is `tester-army/e2e` (Apache-2.0). It had about 8.3k stars on 2026-10-09, about 10 weeks after the initial commit and 8 days after the public launch. It ships near-daily pre-1.0 releases, and v0.17.0 contained breaking changes. One maintainer wrote about 77% of the commits. Treat it as an early-adopter tool: high momentum, a high bus factor (very few people hold the knowledge) and an unstable API.

### Cited Findings
**Identity and licence**
- Repo: https://github.com/tester-army/e2e. Description: "Next generation e2e testing framework for web and mobile apps." Licence Apache-2.0, language TypeScript, homepage https://tester.army/e2e. Topics: e2e, e2e-testing, end-to-end-testing, mobile, mobile-testing, playwright, web. — [GitHub API repos/tester-army/e2e](https://api.github.com/repos/tester-army/e2e)
- The docs site is https://e2e.tester.army/docs, hosted on Mintlify. It describes e2e as "An open framework for agentic end-to-end testing." — [e2e docs llms.txt](https://e2e.tester.army/docs/llms.txt)

**Popularity (snapshot 2026-10-09)**
- 8,318 stars, 396 forks, 21 watchers, 63 open issues+PRs, last push 2026-10-09T13:24Z. — [GitHub API](https://api.github.com/repos/tester-army/e2e)
- Issue and PR search on 2026-10-09: 25 open issues, 109 closed issues, 38 open PRs, 690 merged PRs, 110 closed-unmerged PRs. — [GitHub search API, repo:tester-army/e2e](https://github.com/tester-army/e2e/issues)
- Star growth: AIcoder reported 3,828 total stars and 1,430 gained that day, with the repo #1 on GitHub daily trending, on 2026-10-05. — [AIcoder news, 2026-10-05](https://aicoder.com/news/news-20261005-testerarmy-e2e-ai-testing-framework)
- The DEV article says the repo was "#2 on GitHub trending on Oct 5 with 1,398 stars in a day". — [DEV, ianwieds, 2026-10-06](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)
- Trendshift says the repo first hit #1 on GitHub Trending on 2026-10-04 and was #1 TypeScript / #2 overall on its own daily list on 2026-10-02. — [Trendshift](https://trendshift.io/repositories/274762)
- These three sources give different ranks and dates. Taken together, the repo trended #1–#2 globally between 2026-10-02 and 2026-10-05.
- A Chinese-language X post on about 2026-10-06 also called it "GitHub Trending #1 today". — [X @colafffkk](https://x.com/colafffkk/status/2107095481474257162)

**Dates and history**
- Repo created 2026-07-22T09:29Z. The initial commit (0b7b848, "initial commit") was by `szymonrybczak` at 2026-07-22T09:30Z. The repo had 726 commits on main as of 2026-10-09. — [GitHub API commits](https://github.com/tester-army/e2e/commits/main)
- Public launch was 2026-10-01: the "Introducing e2e" blog post by CTO Oskar Kwaśniewski and his X post. — [TesterArmy blog, 2026-10-01](https://tester.army/blog/introducing-e2e); [X @o_kwasniewski](https://x.com/o_kwasniewski/status/2105675143464763540)
- Kwaśniewski teased the framework on X earlier: "available soon". — [X @o_kwasniewski](https://x.com/o_kwasniewski/status/2100966838905585687)
- The launch post's views conflict: an aggregator says about 449K, and a search summary says the post page shows 1.2M. Both are unverified. — [X @AGTPinsights](https://x.com/AGTPinsights/status/2105811877293084993)

**npm packages and versions (registry, 2026-10-09)**
- The CLI and core package is unscoped `e2e`: latest 0.18.0 (2026-10-06), nightly 0.19.0-nightly-20261009094406, Apache-2.0, maintainers okwasniewski and szymonrybczak. — [registry.npmjs.org/e2e](https://registry.npmjs.org/e2e)
- The `e2e` name has older history. Versions 0.0.1–0.0.8 were published 2014-12-16 to 2016-04-21, an unrelated earlier package. TesterArmy's 0.1.0 appeared 2026-07-21. Canary builds 0.15.0-canary-* ran from 2026-09-14, and 0.15.0 stable shipped 2026-09-30. — [registry.npmjs.org/e2e](https://registry.npmjs.org/e2e)
- Scoped packages (`@e2e-dev/*`), latest versions:

| Package | Latest | Date | First published |
|---|---|---|---|
| @e2e-dev/web (Playwright engine) | 0.13.0 | 2026-10-06 | 2026-09-28 |
| @e2e-dev/mobile (agent-device engine) | 0.10.0 | 2026-10-06 | — |
| @e2e-dev/github (PR comment reporter) | 0.4.0 | — | — |
| @e2e-dev/kernel (Kernel hosted Chromium) | 0.2.0 | — | — |
| @e2e-dev/eas (Expo EAS simulators) | 0.3.0 | — | — |
| @e2e-dev/decision | 0.1.0 | 2026-10-06 | — |

  — [npm registry](https://registry.npmjs.org/@e2e-dev%2Fweb)
- The monorepo `packages/` directory holds decision, e2e, eas, github, kernel, mobile, smol and web. `@e2e-dev/smol` (smol machines microVM browsers) is version 0.0.0 in the repo and is not on npm. — [GitHub contents packages/](https://github.com/tester-army/e2e/tree/main/packages)
- Issue #743 notes that the landing page still used "the retired `@e2edev` package names", so the package scope has already been renamed once. — [Issue #743](https://github.com/tester-army/e2e/issues/743)

**Release cadence**
- The core moved 0.15.0 (09-30) → 0.15.1 (10-01) → 0.15.2 (10-02) → 0.16.0 (10-02) → 0.17.0 (10-04) → 0.18.0 (10-06): six stable releases in 7 days. Releases are managed with changesets, and nightlies have run since 10-08. — [npm registry](https://registry.npmjs.org/e2e); [GitHub releases](https://github.com/tester-army/e2e/releases)
- e2e@0.17.0 had two "Breaking:" entries:
  - interrupted tests are no longer counted as failed;
  - `@e2e-dev/web` now pins `playwright-core` instead of peering on `playwright`.

  The same release says "Every existing entry is re-recorded on the first run after the upgrade" for the replay cache, so upgrading invalidates cached runs. — [Release e2e@0.17.0](https://github.com/tester-army/e2e/releases/tag/e2e%400.17.0)
- The vendor itself says it is "Still pre-1.0, so parts of the API are expected to change". — [TesterArmy blog](https://tester.army/blog/introducing-e2e)

**npm downloads**
- `e2e`: 142,735 in the last month (2026-09-08→10-07) and 133,700 in the last week (10-01→10-07). Nearly all downloads came in launch week. — [npm downloads API](https://api.npmjs.org/downloads/point/last-month/e2e)
- `@e2e-dev/web`: 115,627 per month and 115,229 per week. `@e2e-dev/mobile`: 24,993 per month and 24,481 per week. — [npm downloads API](https://api.npmjs.org/downloads/point/last-week/@e2e-dev/web)
- AIcoder reported 60,933 weekly downloads for Sep 28–Oct 4. — [AIcoder](https://aicoder.com/news/news-20261005-testerarmy-e2e-ai-testing-framework)

**Contributors and bus factor**
- 32 contributor entries, including 3 bots (dependabot, devin-ai-integration, github-actions), so 29 humans. — [GitHub contributors API](https://github.com/tester-army/e2e/graphs/contributors)
- Commit shares: okwasniewski 560 (≈77% of 726), kacperkapusciak 39, rudycelekli 18, szymonrybczak 10, DeryFerd 7, fecolinhares 5. Most other people have 1–3 commits. — [GitHub contributors API](https://github.com/tester-army/e2e/graphs/contributors)
- Trendshift shows "6 contributors", which is stale. — [Trendshift](https://trendshift.io/repositories/274762)

**Dependency risk**
- The mobile engine runs on Callstack's `agent-device`: MIT, 4,945 stars, v0.21.22 (2026-10-06), also pre-1.0. Several open e2e issues carry the `agent-device` label. — [GitHub callstack/agent-device](https://github.com/callstack/agent-device); [e2e issues](https://github.com/tester-army/e2e/issues?q=label%3Aagent-device)
- Callstack's Mike Grabowski promoted it: "Try e2e! Powered by @agent_device". — [X @grabbou](https://x.com/grabbou/status/2105688426762960914)

**Notable open issues (2026-10-09)**
- #1000 (opened 10-09): the replay cache does not key on model identity, so "a model swap replays silently and the report attributes the pass to a model that never ran". — [Issue #1000](https://github.com/tester-army/e2e/issues/1000)
- #997 (bug): on the iOS simulator, `setNetwork('offline')` and airplane mode only change the status bar; the app stays online. — [Issue #997](https://github.com/tester-army/e2e/issues/997)
- #963: a proposal to cache `agent.assert`/`agent.waitFor` judgments (off by default). Today these are never cached. — [Issue #963](https://github.com/tester-army/e2e/issues/963)
- #884 (open): in the decision executor, the `selected` state never reaches the model, "so tab steps are a coin flip". — [Issue #884](https://github.com/tester-army/e2e/issues/884)
- #885: the decision executor's completion check rarely confirms navigation steps and never confirms "Back". — [Issue #885](https://github.com/tester-army/e2e/issues/885)
- #841: reads on a continuously updating Android screen take about 20–40 s each. — [Issue #841](https://github.com/tester-army/e2e/issues/841)
- #842: mobile replay misses on unstable iOS 27 screen identity. — [Issue #842](https://github.com/tester-army/e2e/issues/842)
- #872: on iOS, `fill()` on a React Native `secureTextEntry` field always fails verification. — [Issue #872](https://github.com/tester-army/e2e/issues/872)
- #797: an Android deterministic locator tap hits a different control (mobile 0.9.0). — [Issue #797](https://github.com/tester-army/e2e/issues/797)
- #766 and #986: requests for physical-device support and macOS desktop support. These platforms are not supported yet. — [Issue #766](https://github.com/tester-army/e2e/issues/766); [Issue #986](https://github.com/tester-army/e2e/issues/986)
- #850 (closed 2026-10-08): after a hand-off, stored waits grew to 120 s. The DEV article reports a suite dropping from 6 min 51 s to 1 min 35 s after the two-line fix. — [Issue #850](https://github.com/tester-army/e2e/issues/850); [DEV](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)
- #500 (closed, 6 comments, the most discussed): every deterministic test timed out in openScenario on the Android emulator benchmark. — [Issue #500](https://github.com/tester-army/e2e/issues/500)

**Telemetry**
- "The `e2e` CLI sends anonymous usage data … It is on by default." It sends counts and version information, "but no test content, app content, or credentials". It can be switched off with `npx e2e telemetry disable`, `E2E_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`, and `E2E_TELEMETRY_DEBUG=1` prints the payloads. — [e2e Telemetry docs](https://e2e.tester.army/docs/telemetry)
- Since 0.17.0, every model call identifies e2e (`User-Agent: e2e/<version>`, plus `HTTP-Referer: https://tester.army/e2e` and `X-Title: e2e`) so that OpenRouter and Vercel AI Gateway attribute the traffic. These headers replace any the user set on the provider. — [Release e2e@0.17.0, PR #784](https://github.com/tester-army/e2e/releases/tag/e2e%400.17.0)

**Other tester-army repos (2026-10-09)**

| Repo | Licence | Stars | Created | Notes |
|---|---|---|---|---|
| tester-army/cli | MIT | 67 | 2026-02-13 | Hosted-product CLI |
| tester-army/scout | MIT | 63 | — | API-testing tools |
| tester-army/unbox-ai | MIT | 49 | — | — |
| tester-army/mobile-github-action | MIT | 1 | — | — |

  — [GitHub org tester-army](https://github.com/tester-army)

### Inferences
- About 94% of the last 30 days' `e2e` npm downloads (133.7k of 142.7k) came in the launch week, and much of that is likely CI, bots and tire-kicking. Download counts are therefore not yet a reliable adoption signal. Stars (8.3k) mostly reflect the trending spike.
- The repo existed privately from July. npm 0.1.0 came on 07-21, canaries from 09-14, and the public launch on 10-01. Real public exposure is under two weeks.
- About 77% of commits come from one person (the CTO), and many commits are labelled as AI-agent-assisted (devin-ai-integration bot). The bus factor is roughly one, and the code is evolving fast, much of it with AI help.
- Breaking changes, cache invalidation on upgrade and a renamed package scope within the first week call for pinning exact versions in production CI.

### Gaps
- The exact date the repo went public is not in the API; the stargazer timestamps endpoint returned 404.
- I found no independent measure of active users or production adopters of the OSS framework, as distinct from the hosted product.

## Q2. Company, team, funding, hosted product and pricing

### Takeaway
TesterArmy is a six-person Warsaw startup in YC Spring 2026 (P26), founded by former Callstack React Native engineers. It raised a pre-seed of about €1.04M ($1.2M) per The Recursive. Its hosted product is a separate, dashboard-driven natural-language SaaS: Free $0 / Hobby $99 / Startup $299 / Enterprise custom per month, priced by test run. e2e is described as the open foundation that "will power TesterArmy later", so as of October 2026 the two are not yet the same engine.

### Cited Findings
**Company**
- YC company page:
  - Founded 2026, batch Spring 2026, team size 6, Warsaw, Poland.
  - Primary partner Pete Koomen.
  - Tagline: "Test your app with AI, catch bugs before users do".
  - No funding amounts are listed.

  — [YC company page](https://www.ycombinator.com/companies/testerarmy)

**Founders**
- Szymon Rybczak, Co-founder & CEO. Per YC, he became the youngest React Native contributor at 16, maintained OSS with over 3M weekly downloads, and worked on v0 iOS with Vercel. — [YC](https://www.ycombinator.com/companies/testerarmy)
- Oskar Kwaśniewski, Co-founder & CTO. Per YC, he is a React Native core contributor with 100+ merged PRs and has worked with Vercel, Meta and AT&T. — [YC](https://www.ycombinator.com/companies/testerarmy)
- Piotr Matyjasik is named on the Launch HN post ("we're Oskar, Szymon, and Piotr"). A search summary calls him co-founder and CPO, but the YC page fetch did not confirm his title, and The Recursive lists only Rybczak and Kwaśniewski as co-founders. — [Launch HN](https://news.ycombinator.com/item?id=48586299); [The Recursive](https://www.therecursive.com/yc-proven-testerarmy-raises-eur1m-for-ai-agents-that-test-software.md)

**Funding**
- The Recursive (2026-09-15): a pre-seed of €1.04M ($1.2M) from Y Combinator, AIP Seed, Eight Capital and Script Capital. — [The Recursive](https://www.therecursive.com/yc-proven-testerarmy-raises-eur1m-for-ai-agents-that-test-software.md)
- Angels named in the same article: Guillermo Rauch (Vercel), Walden Yan (Cognition), Charlie Cheever (Expo/Quora), Zeno Rocha (Resend), Fernando Rojo (Vercel) and Fryderyk Wiatrowski (Viktor). — [The Recursive](https://www.therecursive.com/yc-proven-testerarmy-raises-eur1m-for-ai-agents-that-test-software.md)
- Yespress lists a different figure, "$130K seed from Y Combinator". It is unreconciled and probably a template figure. — [Yespress](https://yespress.io/testerarmy-yc-p26)

**Traction claims (all self-reported, and they rise over time)**
- "20+ companies" in production (YC launch post). — [YC](https://www.ycombinator.com/companies/testerarmy)
- "0 to 30+ teams using our product every day" (Launch HN, 2026-06-18). — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- "More than 50 clients", including Resend, bolt.new, Novu, CodeCrafters, Rork and Nando's (2026-09-15). — [The Recursive](https://www.therecursive.com/yc-proven-testerarmy-raises-eur1m-for-ai-agents-that-test-software.md)

**Hosted product features (vendor descriptions)**
- Plain-English tests and a cloud agent driving real browsers and iOS/Android simulators. — [YC](https://www.ycombinator.com/companies/testerarmy)
- Handles login, OAuth and OTP; "each of our agents has access to its own inbox". — [Launch HN, okwasniewski](https://news.ycombinator.com/item?id=48586299)
- Claims to solve captchas. — [Launch HN, okwasniewski](https://news.ycombinator.com/item?id=48586299)
- Runs on a schedule against production and on every GitHub PR. Builds a test plan from the PR diff and posts pass/fail plus recordings to the PR. — [YC](https://www.ycombinator.com/companies/testerarmy); [Launch HN](https://news.ycombinator.com/item?id=48586299)
- Slack/Discord alerts when a flow breaks. — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- Can work from only a URL or app build, without codebase access. — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**How the hosted product relates to e2e**
- Per tester.army/e2e: e2e is the OSS framework, with TypeScript tests in your repo run locally or in your CI on your own model. TesterArmy is "the hosted service", with plain-language tests written in a dashboard and run in TesterArmy cloud, "with no test code in your repo". — [tester.army/e2e](https://tester.army/e2e)
- The launch blog calls e2e "the open foundation that will power TesterArmy later". — [TesterArmy blog, 2026-10-01](https://tester.army/blog/introducing-e2e)
- Hosted browsers and devices for e2e itself come from third parties: Kernel (`@e2e-dev/kernel`) and Expo EAS Simulators (`@e2e-dev/eas`). — [e2e docs](https://e2e.tester.army/docs/llms.txt)

**Hosted models (June 2026, single source)**
- An HN commenter extracted these hosted-product model settings:
  - FAST_MODEL = google/gemini-3-flash
  - DEEP_MODEL and VISION_CLICK_MODEL = openai/gpt-5.4
  - 15-minute run timeout and 2–3 visual calls per step
- The CTO confirmed Gemini 3 Flash was "the best model … bang for the buck". — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**Hosted pricing (tester.army/pricing, fetched 2026-10-09)**

| Plan | Price | Test runs | Concurrent | Projects | Features |
|---|---|---|---|---|---|
| Free | $0 | 5 | 1 | 2 | No card |
| Hobby | $99/mo | ≤250 | 3 | 2 | GitHub, Slack, webhooks |
| Startup ("most popular") | $299/mo | ≤1,000 | 10 | 5 | Adds "frontier models" |
| Enterprise | Custom | — | — | — | SSO/SAML, Slack Connect SLA |

- All plans have unlimited members. A yearly toggle says "Save 15%" but shows no yearly prices.
- A run is capped at about 20 minutes. When the quota runs out, runs are blocked until the 1st of the next month.

  — [tester.army/pricing](https://tester.army/pricing)
- The YC launch post offered 30% off with code LAUNCH30. — [YC](https://www.ycombinator.com/companies/testerarmy)
- On HN, a user computed "$300 for 1K tests which means $0.3 for each test". Another noted Hobby allows only about 10 PRs per month at 25 tests per PR. The CTO answered that self-serve plans are "only for lower usage" and offered a call. — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**OSS e2e cost**
- The framework is free. Agent steps use your own model: an API key, a local model, or a ChatGPT, GitHub Copilot, OpenCode Console or SuperGrok subscription, or "your Claude Max or Team plan's API credits". Kwaśniewski says there is "no token markup". — [e2e docs index](https://e2e.tester.army/docs/llms.txt); [TesterArmy blog](https://tester.army/blog/introducing-e2e)
- TestMu AI says "Claude subscriptions are not supported, though Claude works through an API provider". This is consistent with the docs' wording about API credits rather than a Claude chat subscription. — [TestMu AI blog, 2026-10-02](https://www.testmuai.com/blog/e2e-by-testerarmy/)

### Inferences
- The hosted SaaS bills per run (about $0.30/run on Startup) and, in June, used Gemini 3 Flash / GPT-5.4. The OSS framework is BYO-model. A team adopting e2e today is not buying the hosted product's scheduling, alerting or dashboards, and would need to rebuild those in its own CI (GitHub Actions plus the `@e2e-dev/github` PR reporter) or wait for TesterArmy to rebase the SaaS on e2e.
- The OSS release looks strategically positioned as a top-of-funnel and lock-in hedge ("Bring your own agent and infrastructure"). The docs sidebar carries a "Shipping faster than you can test?" banner to tester.army. — [e2e docs llms.txt](https://e2e.tester.army/docs/llms.txt)

### Gaps
- No official statement of which hosted features (scheduling, dashboards, alerts) will be available on top of OSS e2e, or when.
- The yearly prices behind the "Save 15%" toggle are not visible.
- The funding figure has only one detailed source (The Recursive); no primary press release was found.
- Piotr Matyjasik's title is unconfirmed.

## Q3. Community reception: praise, critiques and founder responses

### Takeaway
Reception for OSS e2e is mostly star and trending hype plus a few careful technical write-ups. The careful write-ups praise the hybrid deterministic-plus-agent design and replay cache. They criticise:
- LLM-as-judge assertions, which are never cached;
- silent fallback to live model calls;
- retries that pay for model calls again;
- telemetry that is on by default.

The June 2026 Launch HN thread for the hosted product (132 points, 69 comments) was sceptical about cost, novelty and SaaS dependence. The founder's copy-pasted answers drew criticism. No Reddit discussion was found.

### Cited Findings
**Hacker News**
- Launch HN (hosted product): "Launch HN: TesterArmy (YC P26) – Agents that test web and mobile apps", id 48586299, 2026-06-18, 132 points, 69 comments, posted by okwasniewski. — [HN Algolia API](https://hn.algolia.com/api/v1/items/48586299); [HN mirror](https://hn.svelte.dev/item/48586299)
- The e2e repo itself was submitted to HN on 2026-10-01 by `handfuloflight` and got 1 point and 0 comments. There was no Show HN discussion. — [HN Algolia search](https://hn.algolia.com/api/v1/search?query=testerarmy&tags=story)

**HN critique: cost and token burn**
- Commenter pranshuchittora: Playwright MCP "easily consumes 1M+ tokens for a test with ~20 steps", and "are you guys default alive?" at $0.30/test. — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- He also called the lack of benchmarks "a trust me bro kinda thing".
- CTO's answer: "quite a lot of context engineering", plus caching "the trajectory of the agent (not the whole test run yet…)". He added: "We currently do not have any benchmarks". — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**HN critique: nondeterminism and stability**
- Commenter poisonborz: "How do you make sure results stay stable regardless of the nondeterministic nature?" — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- CTO's answer: harness engineering that injects "trajectories of previous tests" and splits work into smaller steps "to prevent context overload and decision fatigue". — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**HN critique: is this needed at all?**
- dbbk asked why not let Opus write E2E tests. Obertr said in-house LLM eval workers are easier than external testing. mogili: "This is a solved problem… Can't believe YC would fund this in 2026." — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- Laurel1234 pressed on how it works without locators: "My experience with that has been pretty poor and worse than proper e2e scripts, and is fairly expensive". — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**HN critique: vendor lock-in and security**
- Eridrus: "not super excited about using some 3rd party SaaS as a critical part of my testing". — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- zuzululu: "uneasy about outsourcing this part with all the security issues". negamax: "config overhead and potential security leaks makes it a no go". — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- The CTO said the product can run with only a URL or app build. — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- The later Apache-2.0 BYO-model e2e release effectively answers the lock-in critique. This is my inference.

**HN critique: founder conduct and domain**
- skinfaxi: "Goodness I really didn't expect such lazy copy-pasting of responses for a YC company". The same long answer was pasted to at least three different questions. — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- Commenters warned that the `.army` TLD hits spam filters and corporate firewalls. The CTO said they own the .com and .ai domains and "Will migrate to it soon". — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**HN praise**
- pensono: "Love using tester army to validate PRs against my preview environment". RayFitzgerald: "Vercel for testing". — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**HN alternatives named by commenters**
- Revyl (vision-only, per the CTO), mobileboost.io (used by Duolingo, per the commenter), Rainforest QA (YC), TestingBot (physical devices), and the OSS vostride/agent-qa. — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- vostride/agent-qa had 903 stars on 2026-10-09; its licence shows as NOASSERTION. — [GitHub](https://github.com/vostride/agent-qa)
- One commenter was rebuked for spamming that link repeatedly in the thread. — [Launch HN](https://news.ycombinator.com/item?id=48586299)

**DEV Community, "Let the AI click, don't let it grade" (ianwieds, 2026-10-06)** — [DEV](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)
- Thesis: use `agent.act` to reach the screen and put an exact `expect` after every act. Use `agent.assert` only when the expected answer is a matter of meaning, such as whether a chatbot reply answers the question. Run CI with `--strict-cache` and commit `.e2e/cache/`.
- Critiques:
  - `assert`, `waitFor` and `extract` are never cached.
  - After a replay mismatch, the stand-in agent "tapped the dead button again and reported success", so agents can grade their own work.
  - Without `--strict-cache`, stale recordings silently fall back to live model runs: 14.6 s instead of about 0.2 s.
  - The cache is gitignored and read-only in CI, so CI runs every act live until the cache is committed.
  - Retries never replay.
  - Issue #850.
  - Telemetry is on by default.
- Numbers quoted from the e2e docs: act about $0.0198 (3 calls) and assert about $0.0114. A 40-act/40-assert suite costs about $1.25 cold and about $0.46 with every act replayed.
- Method caveat: the author used a 17-line scripted stand-in, not a real model. The page showed 0 reader comments.
- The cache docs confirm these behaviours:
  - `e2e init` gitignores `.e2e/cache/` and CI defaults to read-only.
  - "Retries never replay, except under `--strict-cache`".
  - "A committed recording that stops replaying is quiet by default … every CI run pays for the model calls until someone re-records".

  — [e2e cache docs](https://e2e.tester.army/docs/cache)

**TestMu AI (formerly LambdaTest) blog (2026-10-02)** — [TestMu AI](https://www.testmuai.com/blog/e2e-by-testerarmy/)
- Written by Srinivasan Sekar, Director of Engineering at TestMu AI. It is a positive explainer, not an independent benchmark.
- Pros: locator-only tests need no model, replay cuts cost, Apache-2.0, migration guides.
- Cons:
  - No default model is configured.
  - The first run costs model calls.
  - Cloud connect mode is Chromium-only and lacks headers, basicAuth, userAgent and session state.
  - Mobile needs Xcode or the Android SDK locally.
- Measured: first run 29.14 s, 28.4k tokens, 3 model calls (gemini-2.5-flash); replay 19.73 s with no model calls.
- Conflict of interest: the post promotes TestMu's own cloud and Kane AI and points the e2e config at a TestMu endpoint.

**X/Twitter**
- Launch posts by the CTO ("Introducing e2e … Fully Open Source → Mix deterministic and agentic APIs") and the CEO ("THE FUTURE OF AGENTIC TESTING IS HERE"). — [X @o_kwasniewski](https://x.com/o_kwasniewski/status/2105675143464763540); [X @SzymonRybczak](https://x.com/SzymonRybczak/status/2105700462892609971)
- Third-party summaries and endorsements:
  - AGTP's recap. — [X @AGTPinsights](https://x.com/AGTPinsights/status/2105811877293084993)
  - Callstack's Grabowski. — [X @grabbou](https://x.com/grabbou/status/2105688426762960914)
  - A Chinese indie-dev recommendation. — [X @colafffkk](https://x.com/colafffkk/status/2107095481474257162)

**Reddit**
- No Reddit threads about tester-army/e2e were found in extended search on 2026-10-09. — [search via Trendshift and aggregators](https://trendshift.io/repositories/274762)

**Community projects (early ecosystem)**
- slawekradzyminski/tests-e2e (2026-10-03, 0 stars): migrated 302 Playwright scenarios and measured costs with Claude Sonnet 5.5 (see Q5). — [GitHub](https://github.com/slawekradzyminski/tests-e2e)
- zaferayan/test-e2e: a SwiftUI app tested with e2e versus Maestro. It needed `id: "addButton"` because Turkish iOS labels broke text matching. — [GitHub](https://github.com/zaferayan/test-e2e)
- A Portuguese beginner guide (joaopedro17/e2e4noobss). — [GitHub search](https://github.com/joaopedro17/e2e4noobss)
- A .NET port blog. — [Hardkoded](https://hardkoded.com/blog/dotnet-developers-also-deserve-e2e)
- An earlier "clone of TesterArmy's agent core" (mikitahimpel/open-testers, created 2026-05). — [GitHub](https://github.com/mikitahimpel/open-testers)

**Issue-tracker critiques**
- The "coin flip" tab steps in the decision executor (#884). — [Issue #884](https://github.com/tester-army/e2e/issues/884)
- Silent model-swap replay (#1000). — [Issue #1000](https://github.com/tester-army/e2e/issues/1000)

### Inferences
- The serious technical community converges on one rule: let the AI navigate, but grade with deterministic `expect`, and run CI with `--strict-cache` plus a committed cache. Under that rule, e2e becomes "Playwright with AI-recorded steps", and AI cost and nondeterminism shrink to the steps that truly need semantic judgment.
- Much positive coverage comes from aggregators or vendors with their own interests (TestMu AI, AI news sites). Independent hands-on reviews are scarce: DEV used no real model, and slawekradzyminski's repo has 0 stars and was not run in CI.

### Gaps
- No Reddit, Lobste.rs or substantive HN discussion of the OSS e2e release was found.
- No founder public response to the DEV critiques was found. However, open issues #963, #938 and #939 (replay-only runs, caching judgments, cache-outcome reporting) look like the maintainers working on exactly those points. — [Issues](https://github.com/tester-army/e2e/issues)

## Q4. Competitive landscape (late 2026) and comparison table

### Takeaway
e2e's distinctive position is that it is one Apache-2.0 TypeScript runner that mixes deterministic Playwright-style locators with agent steps across web, iOS and Android, with a verified-replay cache and BYO model. Each alternative covers only part of that:
- Playwright (huge maturity) has AI test agents that generate deterministic code but is web-only.
- Stagehand and Midscene are mature OSS AI SDKs, but Stagehand is web-centric and Midscene is vision-only.
- Maestro is the mobile default, with AI assertions tied to its cloud.
- Commercial tools (QA Wolf, Momentic, Octomind, testRigor, Checksum, Autify, Reflect, mabl) sell maintenance, hosting and healing at $300 to $8,000+ per month.

### Cited Findings
**Playwright and its test agents**
- Playwright: Apache-2.0, 97,354 stars, latest v1.64.0 (2026-10-07). — [GitHub microsoft/playwright](https://github.com/microsoft/playwright)
- Playwright MCP: Apache-2.0, 37,963 stars, v0.0.83 (2026-09-28). — [GitHub microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- Playwright Test Agents were introduced in 1.56: the planner explores the app and writes a Markdown plan, the generator turns the plan into Playwright test files and verifies selectors live, and the healer runs the suite and repairs failing tests. Set up with `npx playwright init-agents --loop=vscode|claude|codex|opencode`. — [Playwright docs source test-agents-js.md](https://github.com/microsoft/playwright/blob/main/docs/src/test-agents-js.md)

**OSS AI SDKs**
- Stagehand (Browserbase): MIT, 25,594 stars, latest 3.7.3 (2026-08-28). — [GitHub browserbase/stagehand](https://github.com/browserbase/stagehand)
  - Its act cache stores instruction, URL, selector and action and self-heals selectors. Server-side cache works only on Browserbase.
  - Cached steps take about 150–300 ms versus 1–3 s with the LLM (vendor estimate).
  - Supports OpenAI, Anthropic and Gemini via the AI SDK.

  — [Stagehand caching docs (Mintlify mirror)](https://www.mintlify.com/browserbase/stagehand/concepts/caching); [docs.stagehand.dev](https://docs.stagehand.dev/v3/basics/act)
- Browserbase hosted-browser pricing was not verified. An undated third-party slide gives $0 / $20 / $99 / custom. — [Speaker Deck](https://speakerdeck.com/nearme_tech/browser-automation-stagehand)
- Midscene.js (ByteDance web-infra): MIT, 15,123 stars, v1.14.0 (2026-09-29). — [GitHub web-infra-dev/midscene](https://github.com/web-infra-dev/midscene)
  - "All-in on the pure-vision route": elements are located from screenshots only.
  - Caches for faster replay.
  - Models: Qwen3-VL, Doubao vision, gemini-3-flash, UI-TARS.
  - Provides aiAct, aiQuery and aiAssert, and integrates with Playwright/Vitest.

  — [midscenejs.com introduction](https://midscenejs.com/introduction); [midscenejs.com](https://midscenejs.com)
- Shortest (Antiwork): MIT, 5,683 stars. The last release was v0.4.9 on 2025-04-01, and the last substantive code commit was 2025-08-18 (2026-05-21 only removed .cursorrules). It runs natural-language tests on Playwright with the Anthropic Claude API. It is effectively dormant. — [GitHub antiwork/shortest](https://github.com/antiwork/shortest)
- Browser Use: MIT, 117,389 stars, 0.13.11 (2026-10-07). It is a general browser agent, not a test runner. — [GitHub browser-use/browser-use](https://github.com/browser-use/browser-use)
  - Cloud pricing: $0.01 per task start plus $0.002–$0.05 per step depending on the model; $0.006/step on Browser Use 2.0. A 10-step task costs about $0.07.

  — [Browser Use Cloud pricing docs](https://docs.cloud.browser-use.com/pricing)

**Mobile tools**
- Maestro: Apache-2.0, 15,995 stars, cli-2.11.0 (2026-09-29), YAML flows. — [GitHub mobile-dev-inc/Maestro](https://github.com/mobile-dev-inc/Maestro)
  - `assertWithAI` and `assertNoDefectsWithAi` need `MAESTRO_CLOUD_API_KEY`, because the AI prompts moved to Maestro's cloud backend.
  - Maestro Cloud costs $250 per device per month (Android/iOS) and $125 per browser per month.

  — [Maestro pricing](https://maestro.dev/pricing); [Maestro assertWithAI docs](https://docs.maestro.dev/api-reference/commands/assertwithai)
- Detox (Wix): MIT, 12,033 stars, latest 20.51.3 (2026-05-30). — [GitHub wix/Detox](https://github.com/wix/Detox)
  - AI comes through Wix Pilot (`@wix-pilot/detox`): BYO-LLM natural-language steps plus an "Autopilot" goal mode. Pilot also has Playwright, Puppeteer and Appium drivers.

  — [@wix-pilot/core README](https://unpkg.com/@wix-pilot/core@3.3.4/README.md)
- Appium: Apache-2.0, 22,055 stars. — [GitHub appium/appium](https://github.com/appium/appium)
  - The official appium-mcp server lets AI assistants drive iOS and Android simulators, emulators and real devices. It has vision-model element finding from natural language.

  — [appium-mcp (Algolia docsearch)](https://docsearch.algolia.com/mcp/docs/repo/appium/appium-mcp); [Arconsis Medium](https://medium.com/arconsis/ai-powered-testing-automation-with-appium-mcp-0e6135cfe069)

**Commercial tools**
- Momentic: web on Chromium plus iOS simulators and Android emulators, with no physical devices. — [Momentic auto-heal docs](https://momentic.ai/docs/auto-heal); [Momentic vs Appium](https://momentic.ai/docs/comparisons/appium)
  - Tests are YAML; there is a multimodal per-step locator cache that auto-heals.
  - It has the "Mo" QA agent.
  - Pricing is unverified and sources conflict: free about 2,000 credits (about 200 runs), paid from about $250/month. — [aitoolsatlas](https://aitoolsatlas.ai/tools/momentic/pricing); [Stackpick](https://stackpick.net/pricing/momentic/)
  - A review notes no code export. — [The CTO Club](https://thectoclub.com/tools/momentic-review)
  - $15M Series A in November 2025. — [TechCrunch 2025-11-24](https://techcrunch.com/2025/11/24/momentic-raises-15m-to-automate-software-testing)
- QA Wolf: a managed service that delivers Playwright tests. No public price list. — [Bug0](https://bug0.com/knowledge-base/qa-wolf-pricing); [Autonoma (competitor)](https://getautonoma.com/blog/qa-wolf-pricing)
  - Third-party estimates: about $40–44 per test per month, a median contract of about $90K/year, 12-month minimums and a "zero-flake guarantee".
- Octomind:
  - Official page: Free $0 (20 test cases, 2 projects) / Pro $299/month / Enterprise custom.
  - A third party lists a Developer plan at about $146 and other conflicting tiers.

  — [octomind.dev/pricing](https://www.octomind.dev/pricing); [Bug0](https://bug0.com/knowledge-base/octomind-pricing)
- testRigor: plain-English tests, free tier for public tests. — [PricingSaaS](https://pricingsaas.com/companies/testrigor); [Stackpick](https://stackpick.net/pricing/testrigor/)
  - Private plans are reported anywhere from $300/month to about $900–$1,000/month; the sources conflict and none is verified.
- Checksum: delivers standard Playwright code into your repo and maintains it via healing PRs. — [The CTO Club](https://thectoclub.com/tools/checksum-review/); [EveryDev](https://www.everydev.ai/tools/checksum-ai)
  - Vendor claim: about 70% of failures auto-resolve.
  - Priced by workflows maintained; contact sales.
- Autify Nexus: Playwright-based with script export. — [Bug0](https://bug0.com/knowledge-base/autify-pricing); [PricingSaaS](https://pricingsaas.com/companies/autify); [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-zklndrien3ole)
  - About $300–$400 per seat per month; the sources conflict.
  - AWS Marketplace lists $19,200 for 12 months.
- Reflect (SmartBear): third-party prices range from $99/user/month to $500/month, or custom. — [Capterra](https://www.capterra.com/p/196292/Reflect/); [Stackpick](https://stackpick.net/pricing/reflect-testing/); [CostBench](https://costbench.com/software/browser-testing/reflect-testing/hidden-costs/)
  - SmartBear's own blog argues a 500-test Playwright suite costs $148K–$277K/year to run. This is a vendor framing. — [SmartBear blog](https://smartbear.com/blog/reflect-vs-playwright-choosing-the-right-test-automation-approach)
- mabl: credit-based cloud runs. — [Autonoma (competitor)](https://getautonoma.com/blog/mabl-pricing); [Toolradar](https://toolradar.com/tools/mabl/pricing); [CostBench](https://costbench.com/software/browser-testing/mabl/)
  - The entry tier is often cited at about $500/month, but this is unverified and conflicting; CostBench says custom pricing only.

**e2e's own positioning against these tools**
- Versus Maestro and Detox: TypeScript against normal builds instead of YAML or `detox build`.
- Versus Playwright MCP and agent-only tools: replays recorded steps without a model.
- It says it does not replace Cypress component testing or Maestro Studio/Cloud.

  — [tester.army/e2e](https://tester.army/e2e)

**Comparison table** (snapshot 2026-10-09; "unverified" means third-party or conflicting figures; "n/v" means not verified in this research)

| Tool | OSS / paid | Licence, stars (10-09) | Web | iOS | Android | Authoring | AI / caching / self-healing | Model choice | Pricing model |
|---|---|---|---|---|---|---|---|---|---|
| **e2e (TesterArmy)** | OSS (hosted SaaS separate) | Apache-2.0, 8.3k | Yes (Playwright) | Yes (simulator, agent-device) | Yes (emulator) | TypeScript; locators plus `agent.act/assert/waitFor/extract` | Verified `act` replay with no model calls and hand-back to the agent on change; `--strict-cache` for CI; assert/extract always live | BYO: any AI SDK model, local, or ChatGPT/Copilot/OpenCode/SuperGrok subscriptions | Free; you pay model tokens (e.g. about $0.02/act, about $0.01/assert per docs). Hosted TesterArmy: $0 / $99 / $299 / custom per month by runs |
| **Playwright + Test Agents + MCP** | OSS | Apache-2.0, 97k (MCP 38k) | Yes | No (n/v) | No (n/v) | TypeScript and others | Agents generate deterministic Playwright code; the healer repairs failing tests; no runtime model calls once generated | Whatever runs the loop (VS Code Copilot, Claude Code, Codex, opencode) | Free; tokens during authoring and healing only |
| **Stagehand (Browserbase)** | OSS SDK plus paid hosted browsers | MIT, 25.6k | Yes | No (n/v) | No (n/v) | TypeScript `act/extract/observe` | Act cache with self-healing selectors; server-side cache only on Browserbase | OpenAI, Anthropic, Gemini via AI SDK | Free SDK plus LLM; Browserbase hosting tiers unverified |
| **Midscene.js** | OSS | MIT, 15.1k | Yes | Yes (per project, n/v detail) | Yes | JS/YAML, aiAct/aiQuery/aiAssert, Playwright/Vitest | Pure vision (screenshots); cache replay | Vision LMs: Qwen3-VL, UI-TARS, Doubao, Gemini | Free plus model tokens |
| **Shortest (Antiwork)** | OSS | MIT, 5.7k; dormant since 2025 | Yes (Playwright) | No | No | Natural-language strings in TS | Claude computer-use; no active development | Anthropic only | Free plus Anthropic tokens |
| **Browser Use** | OSS plus paid cloud | MIT, 117k | Yes | No | No | Python agent tasks (not a test runner) | General agent; n/v caching for testing | Many LLMs plus own BU models | Cloud $0.01/task plus $0.002–$0.05/step |
| **Maestro** | OSS CLI plus paid cloud | Apache-2.0, 16k | Yes | Yes | Yes | YAML flows | Deterministic flows; `assertWithAI` and `assertNoDefectsWithAi` via Maestro cloud key | Maestro-managed backend | Free locally; Cloud $250/device/month, $125/browser/month |
| **Detox (+ Wix Pilot)** | OSS | MIT, 12k | No | Yes | Yes | JS gray-box (React Native) | Pilot adds NL steps and Autopilot; n/v caching | BYO LLM handler | Free plus tokens |
| **Appium (+ appium-mcp)** | OSS | Apache-2.0, 22k | Via WebDriver | Yes (real devices too) | Yes (real devices too) | Multi-language WebDriver | MCP server with vision element finding; no caching per Momentic's comparison | BYO via MCP client | Free plus tokens and device farm |
| **Momentic** | Paid | — | Yes (Chromium) | Yes (simulator) | Yes (emulator) | YAML / low-code | Multimodal per-step locator cache with auto-heal | Vendor-managed | Credits; free tier; paid about $250+/month (unverified) |
| **QA Wolf** | Paid managed service | — | Yes | Mobile n/v | Mobile n/v | Playwright code written by the vendor | Human plus AI maintenance; zero-flake guarantee | Vendor | About $40–44 per test per month, 12-month minimum (unverified) |
| **Octomind** | Paid (free tier) | — | Yes | n/v | n/v | AI-generated tests (Playwright-based, n/v) | Auto-maintenance (n/v) | Vendor | $0 / $299 per month / Enterprise (official) |
| **testRigor** | Paid (free public tier) | — | Yes | Vendor claims mobile (n/v) | Vendor claims mobile (n/v) | Plain English | NL-based (n/v) | Vendor | About $300 to about $1,000/month private (conflicting) |
| **Checksum** | Paid | — | Yes | n/v | n/v | Generates Playwright code in your repo | Healing PRs; about 70% auto-resolve (vendor claim) | Vendor | Per workflow maintained; contact sales |
| **Autify Nexus** | Paid | — | Yes | Mobile via other product (n/v) | Mobile via other product (n/v) | Low-code plus Playwright export | AI features (n/v) | Vendor | About $300–$400 per seat per month (conflicting) |
| **Reflect (SmartBear)** | Paid | — | Yes | n/v | n/v | No-code recorder plus AI | n/v | Vendor | About $99–$500/month or custom (conflicting) |
| **mabl** | Paid | — | Yes | n/v | n/v | Low-code | Auto-heal (n/v) | Vendor | Credits; about $500/month entry (unverified) |

### Inferences
- **Closest OSS rivals.** Stagehand (web) and Midscene (web and mobile, vision-only) are e2e's closest OSS rivals on "AI steps plus cache". e2e's differentiators:
  - a full test runner (reports, retries, fixtures, CI reporters);
  - hybrid text-snapshot plus screenshot observation instead of pure vision;
  - first-party iOS and Android through agent-device;
  - subscription-based model login.

  Its weaknesses against them are age (10 weeks against about 2 years) and API churn.
- **Against Playwright Test Agents.** These produce plain deterministic Playwright code with no runtime AI dependency. For web-only teams that is the lowest-risk "agentic" path, and e2e's main web advantage is only runtime `act` fallback plus semantic `assert`.
- **Mobile.** Maestro is far more mature (since 2022, about 16k stars), but its AI assertions route through Maestro's cloud. e2e offers BYO-model AI on mobile, but with many open iOS and Android engine bugs (#797, #841, #842, #872, #997).
- **Commercial tools** price the maintenance and hosting layer, from about $300/month for Octomind Pro to about $8,000+/month for a 200-test QA Wolf contract. TesterArmy's own hosted tiers ($99/$299) sit at the low end.

### Gaps
- I did not verify the mobile coverage or AI approach of testRigor, Octomind, Reflect, mabl, Checksum or QA Wolf from primary docs; those cells are marked n/v.
- I did not verify current pricing for Browserbase, Momentic, mabl, testRigor or Reflect from the vendors' own pages. Several were unreachable or conflicting.
- Midscene's iOS support details and the cache invalidation semantics of Midscene and Stagehand were not examined in depth.

## Q5. Benchmarks and published numbers

### Takeaway
No official benchmark exists for e2e or TesterArmy; the founders said so in June and press noted it again in October. The only numbers are vendor doc examples and a few small community runs. In those runs, agent `act` steps cost about $0.019 each and `assert` about $0.007–0.011 with Sonnet-class models. Replay removes act cost, but in a judgment-heavy suite it cut total cost only by about half and wall time by about 9%.

### Cited Findings
**No official benchmarks**
- CTO, June 2026: "We currently do not have any benchmarks; much of the experience depends on the test plan." — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- AIcoder, October 2026: "No official accuracy/latency benchmark is published." — [AIcoder](https://aicoder.com/news/news-20261005-testerarmy-e2e-ai-testing-framework)
- The launch blog gives no cache hit rate, timings or costs, only "about a minute" to set up. — [TesterArmy blog](https://tester.army/blog/introducing-e2e)

**e2e docs examples**
- The cache docs show an example act at "4.1k tokens · 2 model calls · anthropic/claude-sonnet-4.5". — [e2e cache docs](https://e2e.tester.army/docs/cache)
- Per the DEV article, the docs give one act at $0.0198 over 3 calls and one assert at $0.0114. — [DEV](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)
- Per-step budgets: a targeted action has a 15 s maximum timeout; `assert` and `extract` make one judgment plus at most one repair call; `waitFor` skips model calls while the screen is unchanged. — [e2e "How agent steps work"](https://e2e.tester.army/docs/agent-steps)

**DEV article (scripted stand-in model, not a real LLM)** — [DEV](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)
- The locator test passed 20 of 20 in 6 s.
- A stale-replay fallback took 14.6 s versus about 0.2 s replayed.
- A recording is about 1.4 KB of JSON.
- The install pulled 40 packages and 72 MB.
- Estimated suite of 40 acts and 40 asserts: about $1.25 cold and about $0.46 per run with every act replayed.

**TestMu AI (gemini-2.5-flash, one simple test)** — [TestMu AI](https://www.testmuai.com/blog/e2e-by-testerarmy/)
- First run: 29.14 s, 28.4k tokens, 3 calls.
- Replay: 19.73 s, 0 calls.

**slawekradzyminski/tests-e2e (Claude Sonnet 5.5, measured 2026-10-03; single source, small sample, not run in CI, USD estimated from token rates)** — [tests-e2e evaluation/FOUR_OPERATIONS.md](https://github.com/slawekradzyminski/tests-e2e/blob/main/evaluation/FOUR_OPERATIONS.md)
- 68 UI scenarios with 166 AI steps (67 acts, 95 asserts, 2 waits, 2 extracts):
  - live: 68/68 passed in 199.59 s, 249 model calls, $1.99;
  - replay: 68/68 passed in 181.98 s, 126 model calls, $1.03.
- Mean cost per step: act $0.0189 (2.2 calls per step), assert $0.0073, waitFor $0.0072, extract $0.0093.
- Waits: six delayed checks completed after about 8.8–9.4 s, and four never-ready checks correctly hit `STEP_TIMEOUT` at the 8 s deadline.
- Total spent on the evaluation: $15.72.
- The author's caveat: "Small controlled sample, not a general flake rate."

**Hosted TesterArmy**
- An HN user's test of a basic booking.com flow "took ~3 mins". — [Launch HN](https://news.ycombinator.com/item?id=48586299)
- Hosted runs are capped at 20 minutes. — [tester.army/pricing](https://tester.army/pricing)

**Competitor-published numbers (vendor claims)**
- Stagehand: cached step about 150–300 ms versus 1–3 s with the LLM. — [Stagehand caching docs](https://www.mintlify.com/browserbase/stagehand/concepts/caching)
- Checksum: about 70% of failures auto-heal. — [The CTO Club](https://thectoclub.com/tools/checksum-review/)
- Momentic: simulator startup under 15 s and 500+ parallel simulators. — [Momentic](https://momentic.ai/docs/comparisons/appium)
- Browser Use: a 10-step task costs about $0.07. — [Browser Use pricing](https://docs.cloud.browser-use.com/pricing)

### Inferences
- In practice, e2e's replay cache saves act cost only. For suites that lean on `agent.assert`, cost and latency stay dominated by live judgments. The Sonnet evaluation saw about a 48% cost drop and a 9% time drop on replay. This supports the "don't let it grade" advice, and explains why issue #963 proposes caching judgments.
- Rough cost model at Sonnet-class prices: 1,000 CI runs per month of a 100-step agentic suite (half acts, half asserts) costs about $1,300/month cold and about $365/month with acts fully replayed. The hosted Startup plan's 1,000 runs cost $299, but those are whole-test runs, not steps. This is my arithmetic from the measured per-step means, not a published figure.

### Gaps
- No independent cache hit rate, flakiness rate or pass-rate-versus-human-QA figure exists for e2e or TesterArmy.
- No head-to-head benchmark of e2e against Stagehand, Midscene or Maestro was found.
- No published figures exist for mobile run speed or cost on e2e beyond issue reports (e.g. #841: 20–40 s per Android read).
