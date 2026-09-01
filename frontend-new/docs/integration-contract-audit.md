# Slowdown integration contract audit

Date: 2026-08-27  
Scope: `vite-app/src/lib/api` and the browser-facing API adapters

## Result

The Slowdown clients use the Internal router's `/api/v1` contract after the
cloud client's `/api` prefix is resolved. Identity requests match the Go
router: login, refresh, logout, `/me`, and 2FA validation use the expected
paths and JSON fields. The client sends cookies by default and attaches the
in-memory bearer token when one is available, which matches the Internal
JWT/cookie middleware.

The route audit covered the current calls for identity, masterdata, sourcing
and shortlists, procurement, customers, finance/accounting, HR, commercial,
documents/records, channels, and inventory. No stale route was found in those
calls. The existing `/v1/sourcing-shortlist` compatibility override is a
valid Internal route and can remain configurable.

## Cross-cutting fixes

1. `VITE_*_HUB_URL`, `VITE_*_ROUTER_URL`, and `VITE_*_EDGE_URL` are Vite
   development-proxy targets. They are no longer treated as direct browser
   API origins by `src/lib/api/client.ts`; only the explicit `*_API_URL`
   variables bypass the same-origin proxy. This preserves proxy-injected
   development headers and makes the `.env.example` contract truthful.
2. The Internal router's SPA fallback can return `200 text/html` for an
   unknown API path. The API client now raises an `ApiError` when a response is
   HTML instead of silently returning the HTML as a successful JSON payload.
   This makes stale-route failures visible to feature error states.

## Verification

The contract comparison was made against:

- `/Users/hari/Documents/retail/internal/cloud/router/router.go`
- `/Users/hari/Documents/retail/internal/cloud/identity/handler.go`
- `/Users/hari/Documents/fresh/web/src/lib/api/client.ts`

Checks completed on 2026-08-27:

- `npx eslint src/lib/api/client.ts` — passed.
- `npx prettier --check src/lib/api/client.ts docs/integration-contract-audit.md`
  — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; Vite emitted only the existing large-chunk warning.
- `git diff --check` — passed for the touched files.

The full repository lint remains broader than this audit and may report
pre-existing feature-folder issues; those folders were intentionally outside
this subtask's ownership.
