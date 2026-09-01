# CLAUDE.md

Working directory: this repo. Architecture lives in
`docs/frontend-architecture.md` and `docs/frontend-rules.md`. Those two win
when they disagree with anything else.

## Gate — whole project, no path filters

You are not done until all three pass:

    bunx tsc -p tsconfig.app.json --noEmit
    bunx eslint .
    bunx vite build

"Clean for my files" is not the gate. Run all three yourself.

Package manager is **bun**. Use `bunx`, never `npx`.

Never edit `src/routeTree.gen.ts` — the router plugin regenerates it.

If the gate is already failing outside the files you own: stop, report it,
do not patch another agent's work.

## Navigation

Always `Route.useNavigate()` (or `getRouteApi("/path").useNavigate()`).
Never the global `useNavigate()` — it types `prev` as the union of every
route's search params. Same for `<Link>`: set `from` to the current route.

Filter and tab changes use `replace: true`. Opening a record pushes.

## Deprecated APIs (`@tanstack/query-core@5.102.7`)

Do not write these into new code:

    queryClient.ensureQueryData(o)  →  queryClient.query({ ...o, staleTime: "static" })
    queryClient.prefetchQuery(o)    →  void queryClient.query(o).catch(noop)
    queryClient.fetchQuery(o)       →  queryClient.query(o)
    useReactTable(...)              →  useTable(...) with explicit tableFeatures
