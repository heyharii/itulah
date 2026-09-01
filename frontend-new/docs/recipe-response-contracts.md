# Recipe — response contracts

The gate for the zod fan-out. Ten agents writing schemas without this produce
ten dialects; the point of the exercise is one.

Read `src/lib/api/contract.ts` first — particularly *why a mismatch does not
throw in production*. It changes what a wrong schema costs, and therefore how
strict to be.

## Where a schema goes

One file per domain: `src/components/<domain>/contracts.ts`. Not in `api.ts`
beside the fetchers, because the schemas are the larger half and `api.ts` is
already the file everyone opens.

Export the schema and the inferred type together, and let the type come *from*
the schema:

```ts
export const ApiSupplier = z.object({ … })
export type ApiSupplier = z.infer<typeof ApiSupplier>
```

Delete the hand-written `interface ApiSupplier` it replaces. Two descriptions
of one payload is the problem this is solving, and leaving both keeps it.

## Attaching it

```ts
const rows = await api.get("/v1/suppliers", { schema: SupplierList, signal })
```

Drop the `<T>` — the overload infers the return type from the schema, and a
generic beside a schema silently wins over it.

## How strict

The backend is a Go estate this frontend cannot see the structs of. Every
schema is a guess, so guess in the direction that fails loudly on the things
that matter and stays quiet on the things that do not.

**Be strict about:**

- **Money.** `z.number().int()` and an explicit currency, never `z.number()`
  alone. A float reaching a money field is the bug this whole layer earns its
  keep on; see `docs/money-contract.md`.
- **Identifiers.** A `string` that is `undefined` half the time is a list that
  loses its React keys.
- **Enums the UI switches on.** A status the UI has a `Record<Status, …>` for
  must be `z.enum([…])`, or an unknown status renders `undefined`.

**Be loose about:**

- **Unknown extra fields.** Zod objects strip by default — keep that. Never
  `.strict()`: the backend adding a field is normal and must not be an error.
- **Presentational strings.** `z.string().nullish()` rather than requiring
  something the UI already renders an em dash for.
- **Enums the UI only displays.** `z.string()`. A new label is not a failure.
- **Timestamps.** `z.string()`. Do not `.datetime()` — the estate is not
  consistent about the format and this layer is not where that gets fixed.

Rule of thumb: strict where being wrong is silent and expensive, loose where
being wrong is visible and cheap.

## Nullable vs optional

They are different failures and the estate produces both. Go's `omitempty`
drops a field; a Go pointer sends `null`. Unless it is known which one an
endpoint does, `.nullish()` accepts both. Prefer it over guessing.

Where a `null` is genuinely "no value", fold it in the schema rather than in
every consumer:

```ts
note: z.string().nullish().transform((v) => v ?? undefined)
```

## What not to do

- **Do not schema a versioned wire format.** If a payload has a `v1`/`v2`
  shape, it is a format, not a type — the same trap `salepayload/parse_v1.go`
  set on the Go side.
- **Do not validate a request body.** The form layer already validated it, with
  the messages the user reads. A second schema there means two error vocabs.
- **Do not "fix" data in a schema beyond null-folding and trimming.** Mapping
  belongs in the existing `mapSupplier`-style functions, which are tested and
  which the mutation path shares.
- **Do not change a fetcher's signature, a query key, or a component.** This
  work adds a `schema` option. Nothing else moves.

## Done means

1. `bunx tsc -p tsconfig.app.json --noEmit`
2. `bunx eslint .`
3. `bunx vitest run`
4. `bunx vite build`
5. **The screen still loads.** Dev throws on a mismatch, so an over-strict
   schema shows up as a blank screen *for you*, now, rather than for a user
   later. Open the screen. If it throws, the schema is wrong — loosen it and
   record what the backend actually sent.

## The two populations

A survey before the fan-out found the 131 call sites are not one problem:

| Shape | Count | What to do |
|---|---|---|
| `api.get<Supplier>(…)` — a cast | 57 | Attach `{ schema }`. Delete the hand-written interface. This is where the untruth lives. |
| `api.get<unknown>(…)` → `list()` → defensive mapper | 74 | Leave the fetch alone. Call `checkContract(Row, rows, path)` after unwrapping. |

The second group is already safe at runtime — a malformed row maps to
`undefined` and gets filtered out. What it is not is *observable*: rows vanish
silently. `checkContract` reports and never throws, so it adds the knowledge
without putting a working screen at risk.

Do not convert a defensive mapper into a schema. It is tested, the mutation
path shares it, and the rewrite is not what this task is.

## Naming the `path` label

`checkContract`'s third argument is a report label, not a URL the backend
resolves — it exists so a violation can be traced back to one place, and so the
once-per-endpoint gate has something stable to key on.

- Use the route as written, including its `/v1` prefix.
- For a **sub-array** of a payload, append `#field`:
  `"/v1/commercial/member-program/config#tiers"`.
- For a route with an **id in it**, put the parameter name rather than the
  value: `"/v1/commercial/price-lists/:id/entries"`. A label carrying a real id
  makes the dedup key unique per record, which defeats the gate — one wrong
  schema would then report once per price list rather than once.
