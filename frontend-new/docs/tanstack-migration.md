# TanStack migration contract

The suite has moved off ad-hoc `useState` navigation onto the TanStack stack.
This is the contract every app migration follows.

## What is already done (do not redo, do not edit)

- `@tanstack/react-router` with **file-based routing**. The Vite plugin
  (`tanstackRouter`) regenerates `src/routeTree.gen.ts` — never edit that file.
- `src/routes/__root.tsx` — providers, the app rail, the logout control, the
  `<Outlet />`. Route context carries `queryClient`.
- `src/routes/index.tsx` — redirects `/` to `/customers`.
- `src/components/app-rail.tsx` — every app is a `<Link to="/<app-id>">`.
- `src/main.tsx` — `RouterProvider` + `QueryClientProvider`.
- `src/lib/api/query.ts` — `useApiQuery` / `useApiWrite`.
- `src/lib/api/query-client.ts` — the shared `QueryClient`.

**Only touch the files for the app(s) you were assigned.** Shared files above
are owned by the integrator.

## Route paths

One route file per app, already stubbed at `src/routes/<app-id>.tsx`:

`buying` `forum` `chat` `files` `articles` `sourcing` `hr-ho` `hr-store`
`inventory` `finance` `commercial` `customers` `accounting` `system` — the path
is always `/<app-id>`, matching `AppId` in `src/components/apps.ts`.

Three of the original ids are gone, merged into the two that remain:
`shortlist` is now the `staged` scope inside `/sourcing`, and `suppliers` +
`po` are the two `section`s of `/buying`.

## Rule 1 — every tab and every filter lives in the URL

Any state that decides *what the user is looking at* belongs in search params:
the selected tab/screen, the text query, every dropdown filter, the sort key
and direction, the grid/table layout toggle, and the id of whatever record a
detail sheet is showing.

State that is **not** navigation stays in `useState`: form drafts, in-flight
busy/error flags, toasts, transient "is the rail collapsed" chrome, sound
preference, unsaved editor content.

Declare the shape with zod on the route:

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

const searchSchema = z.object({
  tab: z.enum(["monitor", "missing", "ledger", "operations"]).default("monitor"),
  q: z.string().optional(),
  location: z.string().optional(),
  open: z.string().optional(),
})

export const Route = createFileRoute("/inventory")({
  validateSearch: zodValidator(searchSchema),
  component: Inventory,
})
```

Read and write them in the component:

```tsx
const { tab, q } = Route.useSearch()
const navigate = Route.useNavigate()

// changing a filter is a navigation, and replaces rather than stacks
navigate({ search: (prev) => ({ ...prev, tab: "missing" }), replace: true })
```

Guidance:

- Use short, stable param names (`q`, `tab`, `open`, `sort`, `dir`, `view`).
- Give every param a `.default()` or make it `.optional()` so a bare
  `/inventory` is always valid.
- Use `replace: true` for filter and tab changes; use a pushed navigation
  (the default) only when the user opens a genuinely new destination.
- Prefer `<Link>` over an `onClick` that navigates — tabs and nav-list rows
  should be real links so they middle-click, hover-preview and restore.
- Omit defaults from the URL rather than writing `?tab=monitor` on load.

## Rule 2 — cross-app jumps are navigations, not callbacks

`onSwitchApp`, `onCreatePo` and `draftFor` props are gone. A screen that used
to call `onSwitchApp("po")` now calls
`navigate({ to: "/buying", search: { section: "orders", draftFor: [...] } })`,
and the receiving route reads `draftFor` out of its own validated search
params. Delete the prop from
the component signature once the last caller is converted.

## Rule 3 — server data goes through TanStack Query

Each app has an `api.ts` full of `useApiResource(...)` calls. Convert them to
`useApiQuery(key, request, options)` from `@/lib/api`. It returns the same
`ApiResource` shape, so screen code does not change — you are only adding a
cache key.

```ts
export function useInventorySnapshot(locationId: string | null) {
  return useApiQuery(
    ["inventory", "snapshot", locationId],
    (signal) => api.get<InventorySnapshot>(`/inventory`, { signal }),
    { enabled: Boolean(locationId) },
  )
}
```

- The key must include **every** input the request closes over, or two screens
  will share a cached result they should not.
- Namespace keys by app: `["inventory", ...]`, `["hr", "roster", ...]`.
- Convert writes with `useApiWrite(request, { invalidates: [["inventory"]] })`
  so the reads they affect refetch themselves instead of the screen calling
  `reload()` by hand.
- `useApiResource` still exists for anything not yet converted; do not delete it.

## Rule 4 — tables use TanStack Table

Where a screen hand-rolls sorting or filtering over an array before rendering a
`<table>`, and the sort/filter state is now in the URL, keep the markup but let
`@tanstack/react-table` (already a dependency) own the row model, with the URL
as the source of truth for its state. Do not rewrite table markup that has no
sorting or filtering — leave it alone.

## Definition of done

- `bunx tsc -p tsconfig.app.json --noEmit` is clean for your files.
- `bunx eslint src/routes/<app>.tsx src/components/<app>/` is clean.
- Every tab and filter in your app survives a page reload and a browser Back.
- No `onSwitchApp` / `onCreatePo` / `draftFor` prop remains in your app.
