import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count } from "@/lib/format"
import {
  colourKeys,
  colourUsage,
  createColour,
  deleteColour,
  listColours,
  updateColour,
  type ColourTerm,
} from "@/lib/queries/colours"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ColourField } from "@/screens/master/colour-field"
import { MasterLifecycle } from "@/screens/master/lifecycle"
import { HEX, mistakenFor } from "@/screens/master/colour-hex"
import { ColourSwatch } from "@/screens/master/colour-picker"

/// The company's colour vocabulary — the list itself, not a colour on a shirt.
///
/// Colour used to be free text, typed per article and unique only within that
/// one article. Nothing stopped "Navy", "navy" and "Biru Navy" from being three
/// unrelated things, so every report that grouped by colour split three ways —
/// and nobody could see that it had, because each row read correctly on its own
/// article. That is the failure the `tag` table was created to prevent,
/// arriving by the same route: a free-text label does not fail when it is
/// misspelt, it just quietly stops being the same word.
///
/// So colours are picked now, never typed, and this is where the list they are
/// picked from lives. Curating it is the whole job — the label chosen here is
/// the word the entire catalogue will use.
///
/// Two rules this screen is written to *explain* rather than merely enforce. A
/// colour that has ever been worn cannot be deleted, only retired — it is on a
/// printed label and inside colourways somebody can still scan, and "nothing
/// wears it today" is not the same statement. What may be deleted is the row
/// created a minute ago with the word spelt wrong; see `lifecycle.tsx`. And no
/// two colours may share a label: checked here against the loaded list so a
/// clash is named while somebody is still typing, and checked again by the
/// unique index, which is the actual authority.

interface ColourRow {
  readonly term: ColourTerm
  /// Still offered to whoever is choosing a colourway.
  readonly active: boolean
  readonly order: number
}

/// Lifting the two columns the table sorts and filters by out of the record.
///
/// A projection rather than a cast: `active` and `display_order` are on the
/// read type, so nothing here is being asserted that the server did not send.
function readRow(term: ColourTerm): ColourRow {
  return { term, active: term.active, order: term.display_order }
}

/// Display order first, usage never.
///
/// This screen is where `display_order` is set and it is the sequence the picker
/// draws, so sorting the master list by anything else would show a different
/// order from the one people actually pick from, and the field somebody just
/// edited would have no visible effect at all. Usage is the volatile half
/// besides: a colour would move on its own every time a colourway was mapped
/// somewhere else in the app, and "the fourth one down" would stop meaning
/// anything. Usage is one header click away, which is where a question about it
/// belongs.
///
/// Sorted here rather than through a `SortingState` because the honest order has
/// two keys: the seed leaves every row at 0, so without the label tie-break the
/// list arrives in whatever order Postgres felt like that morning. The table's
/// own sorting starts empty and takes over the moment a header is clicked.
function curated(colours: readonly ColourTerm[]): ColourRow[] {
  return colours.map(readRow).sort(
    (a, b) =>
      a.order - b.order ||
      a.term.label.localeCompare(b.term.label, "id-ID", {
        sensitivity: "base",
      })
  )
}

const columns: ColumnDef<TableSetup, ColourRow>[] = [
  {
    id: "colour",
    accessorFn: (row) => `${row.term.label} ${row.term.code}`,
    header: "Colour",
    size: 260,
    cell: ({ row }) => (
      <ColourSwatch
        hex={row.original.term.hex_code}
        label={row.original.term.label}
        code={row.original.term.code}
      />
    ),
  },
  {
    id: "code",
    accessorFn: (row) => row.term.code,
    header: "Code",
    size: 170,
    // Shown beside the label, not instead of it: the code is what an article
    // row points at and what survives a rename, so somebody reading a colourway
    // in the database has to be able to find it here.
    cell: ({ row }) => <Tag>{row.original.term.code}</Tag>,
  },
  {
    id: "order",
    accessorFn: (row) => row.order,
    header: "Order",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-[0.8125rem] text-text tabular-nums">
        {row.original.order}
      </span>
    ),
  },
  {
    id: "articles",
    accessorFn: (row) => row.term.in_use,
    header: "Articles",
    size: 120,
    // The one question this list is asked that a sort answers badly: "is 0"
    // is the set of colours that can be deleted rather than retired, and a
    // curator tidying up wants that set, not the top of an order.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Articles", unit: "articles" },
    },
    // Zero is drawn as 0, not as "Unused". It was worded, on the argument that
    // "unused" is the state somebody scans for — but it read as a licence to
    // delete, which it is not: what a colour may be deleted on is whether
    // anything has EVER worn it, and that answer is in the sheet.
    cell: ({ row }) => (
      <span
        className={
          row.original.term.in_use === 0
            ? "text-[0.8125rem] text-mute tabular-nums"
            : "text-[0.8125rem] text-text tabular-nums"
        }
      >
        {count(row.original.term.in_use)}
      </span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => (row.active ? 1 : 0),
    header: "Status",
    size: 110,
    // **No filter here, on purpose.** The segment above the table asks exactly
    // this question and asks it of the SERVER's rows before they reach the
    // table, so a second control saying the same thing could disagree with it
    // on screen — "Retired" selected, "Offered is Offered" in a chip, and an
    // empty list with two controls each insisting they are right.
    // Active and Retired, not Offered and Retired. "Offered" made the reader
    // guess who it was offered to; Active says what it means — this may be
    // chosen when a colourway is mapped — and matches the segment above.
    // Retired is `neutral`, not `bad`: a colour taken out of the picker is a
    // decision somebody made, not a fault in the row.
    cell: ({ row }) =>
      row.original.active ? (
        <Pill tone="ok">Active</Pill>
      ) : (
        <Pill tone="neutral">Retired</Pill>
      ),
  },
]

type Shown = "ALL" | "ACTIVE" | "RETIRED"

export function Colours() {
  const [query, setQuery] = useState("")
  const [shown, setShown] = useState<Shown>("ALL")
  const [sorting, setSorting] = useState<SortingState>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // The whole vocabulary in one read. A company has a hundred colours, not a
  // hundred thousand, so there is nothing to page and nothing to re-ask the
  // server for — which is also what lets the duplicate-label check below answer
  // while somebody is still typing.
  const colours = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
  })

  const all = useMemo(
    () => curated(colours.data?.colours ?? []),
    [colours.data]
  )

  const rows = useMemo(
    () =>
      shown === "ALL"
        ? all
        : all.filter((row) => row.active === (shown === "ACTIVE")),
    [all, shown]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: ColourRow) => row.term.code,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  const selected = all.find((row) => row.term.code === editing) ?? null
  const retired = all.filter((row) => !row.active).length
  // Not an error and not a warning. A colour can legitimately be named before
  // anybody has decided which pixel value stands for it, so this is a count of
  // work outstanding, not of rows that are wrong.
  const unswatched = all.filter((row) => !row.term.hex_code).length

  const close = useCallback(() => {
    setCreating(false)
    setEditing(null)
  }, [])

  return (
    <PageContent>
      <PageHeader
        title="Colours"
        sub="Standard colours used across articles and variants."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button
              onClick={() => {
                setEditing(null)
                setCreating(true)
              }}
            >
              New colour
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "ALL", label: "All" },
            { value: "ACTIVE", label: "Active" },
            { value: "RETIRED", label: "Retired" },
          ]}
          value={shown}
          onChange={setShown}
        />
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        <span className="text-[0.75rem] text-mute tabular-nums">
          {count(all.length)} colours · {count(retired)} retired
          {unswatched > 0 && ` · ${count(unswatched)} with no swatch yet`}
        </span>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(colours, {
          loading: "Reading the vocabulary…",
          render: () =>
            all.length === 0 ? (
              <EmptyState
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New colour
                  </Button>
                }
              >
                No colour has been declared yet, so there is nothing for an
                article to pick.
              </EmptyState>
            ) : (
              <DataTable<ColourRow>
                table={table}
                onRowClick={(row) => {
                  setCreating(false)
                  setEditing(row.term.code)
                }}
                isSelected={(row) => row.term.code === editing}
                empty="No colour matches that search."
                className="max-h-[calc(100vh-17rem)]"
              />
            ),
        })}
      </Card>

      <ColourSheet
        open={creating || selected !== null}
        colour={creating ? null : selected}
        existing={all}
        onClose={close}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

/// A key held across retries and rotated after a success.
///
/// The point of an idempotency key is that a retry carries the SAME one, so the
/// server replays its first answer instead of writing a second colour. Minted
/// inside the mutation it would be a fresh key per click, and a double-clicked
/// Save would be two rows with the same label — the one thing the unique index
/// then refuses, leaving somebody staring at a duplicate error they caused by
/// clicking twice.
///
/// Copied into this module rather than imported from Procurement's: `lib/` is
/// not this screen's to edit, and Store Ops made the same call for the same
/// reason. If a third module wants it, it should be promoted, not copied again.
function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// The server's own sentence about why a write was refused.
///
/// `ApiError` carries the node's message, and the refusal this form expects most
/// is a duplicate label — where the node names the colour that already holds the
/// word. "Could not save" would throw exactly that away and leave somebody
/// retyping the same thing until they gave up.
function said(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The server could not be reached."
}

/// One colour, as a record to be written or corrected.
function ColourSheet({
  open,
  colour,
  existing,
  onClose,
}: {
  open: boolean
  colour: ColourRow | null
  existing: readonly ColourRow[]
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={colour?.term.code}
      title={colour?.term.label ?? "New colour"}
    >
      <div className="flex flex-col gap-5">
        {/* Keyed so moving between rows starts a form on the row in front of
            you: `useForm` reads its defaults once, and without this the second
            colour opened would be edited through the first one's values. */}
        <ColourForm
          key={colour?.term.code ?? "new"}
          colour={colour}
          existing={existing}
          onSaved={onClose}
        />
        {colour && <ColourLifecycle colour={colour} onGone={onClose} />}
      </div>
    </Sheet>
  )
}

interface ColourDraft {
  code: string
  label: string
  hex: string
  order: string
}

interface Problems {
  code?: string
  label?: string
  hex?: string
  order?: string
}

/// Upper snake, the shape `division` and `tag` already use. Not a database
/// constraint — the column only refuses blanks — but a code is permanent once an
/// article points at it, and a vocabulary with `NAVY_BLUE` beside `Navy blue` is
/// half of the mess this table was built to end.
const CODE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/

/// `Navy Blue` → `NAVY_BLUE`, the same rule the backfill mints codes with, so a
/// colour added by hand next month matches the ones the migration created.
function snake(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function problemsWith(
  draft: ColourDraft,
  colour: ColourRow | null,
  existing: readonly ColourRow[]
): Problems {
  const problems: Problems = {}

  const label = draft.label.trim()
  if (label === "") {
    problems.label = "A colour needs a name — it is what everybody reads."
  } else {
    // The same comparison as the unique index, `lower(btrim(label))`, done early
    // enough to name the row it would collide with. The server stays the
    // authority; this only means nobody has to submit to find out.
    const clash = existing.find(
      (row) =>
        row.term.code !== colour?.term.code &&
        row.term.label.trim().toLowerCase() === label.toLowerCase()
    )
    if (clash) {
      problems.label = `${clash.term.code} already reads as “${clash.term.label}”. Two colours may not share a label — that split is the whole reason this list exists.`
    }
  }

  // Only when minting one. A code is what `article_colour` points at, so it is
  // permanent from the first article that uses it.
  if (colour === null) {
    const code = draft.code.trim()
    if (code === "") {
      problems.code = "A code is needed; it is what article rows point at."
    } else if (!CODE.test(code)) {
      problems.code =
        "Upper snake, like the rest of the vocabulary — NAVY_BLUE, not “Navy Blue”."
    } else if (existing.some((row) => row.term.code === code)) {
      problems.code = `${code} is already taken.`
    }
  }

  const hex = draft.hex.trim()
  if (hex !== "" && !HEX.test(hex)) {
    problems.hex = "Six hex digits after a hash — #1B2A4A."
  }

  const order = Number(draft.order)
  if (!Number.isInteger(order) || order < 0) {
    problems.order = "A whole number, 0 or more."
  }

  return problems
}

function ColourForm({
  colour,
  existing,
  onSaved,
}: {
  colour: ColourRow | null
  existing: readonly ColourRow[]
  onSaved: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // Suggested from the label until somebody types over it, and then left alone:
  // a code corrected by hand should not be silently rewritten by the next
  // keystroke in the field above it.
  const [codeTyped, setCodeTyped] = useState(false)

  const save = useMutation({
    mutationFn: (draft: ColourDraft) => {
      const label = draft.label.trim()
      // Blank clears it rather than storing "". A colour with no agreed pixel
      // value is a normal state, and an empty swatch says so; a wrong one lies.
      const hex = draft.hex.trim() === "" ? null : draft.hex.trim()
      const order = Number(draft.order)
      return colour === null
        ? createColour(
            {
              code: draft.code.trim(),
              label,
              hex_code: hex,
              display_order: order,
            },
            idempotency.key
          )
        : updateColour(
            colour.term.code,
            { label, hex_code: hex, display_order: order },
            colour.term.version,
            idempotency.key
          )
    },
    onSuccess: () => {
      // The whole prefix: the list on this screen and the picker on every
      // article form are the same read, and a colour renamed in one that still
      // reads the old way in the other is the drift this table exists to end.
      void client.invalidateQueries({ queryKey: colourKeys.all })
      idempotency.rotate()
      onSaved()
    },
  })

  const form = useForm({
    defaultValues: {
      code: colour?.term.code ?? "",
      label: colour?.term.label ?? "",
      hex: colour?.term.hex_code ?? "",
      order: String(colour?.order ?? 0),
    } as ColourDraft,
    onSubmit: ({ value }) => save.mutate(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-3.5"
    >
      {save.isError && <Banner tone="bad">{said(save.error)}</Banner>}

      <form.Subscribe
        selector={(state) => problemsWith(state.values, colour, existing)}
      >
        {(problems) => (
          <>
            <form.Field name="label">
              {(field) => (
                <Field
                  label="Label"
                  hint="What everybody reads. Two colours may not share one."
                  problem={problems.label}
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      if (colour === null && !codeTyped) {
                        form.setFieldValue("code", snake(event.target.value))
                      }
                    }}
                    placeholder="Navy"
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="code">
              {(field) => (
                <Field
                  label="Code"
                  hint={
                    colour === null
                      ? "Permanent once an article uses it, so it is set here and never again."
                      : "Article colourways point at this, so it cannot be changed. Rename the label instead."
                  }
                  problem={problems.code}
                >
                  <Input
                    value={field.state.value}
                    disabled={colour !== null}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      setCodeTyped(true)
                      field.handleChange(event.target.value)
                    }}
                    placeholder="NAVY"
                  />
                </Field>
              )}
            </form.Field>

            <div className="grid grid-cols-2 gap-3">
              <form.Field name="hex">
                {(field) => (
                  <Field
                    label="Hex"
                    hint="Optional. Pick it off the swatch, or paste one."
                    problem={problems.hex}
                    className="min-w-0"
                  >
                    <ColourField
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(next) => field.handleChange(next)}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="order">
                {(field) => (
                  <Field
                    label="Order"
                    hint="Where it sits in the picker."
                    problem={problems.order}
                    className="min-w-0"
                  >
                    <Input
                      type="number"
                      min={0}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
            </div>

            {/* Drawn from the draft, and blank whenever the hex is not a hex.
                A colour can be named before anybody has decided which pixel
                value stands for it — and a swatch showing the wrong navy is
                worse than a swatch showing nothing, because somebody will
                believe it. */}
            <form.Subscribe selector={(state) => state.values}>
              {(values) => {
                const hex = values.hex.trim()
                const agreed = HEX.test(hex)
                // The colour already in the list this one would be taken for.
                // Everything but the row being edited, so correcting a colour
                // never warns about itself.
                const twin = agreed
                  ? mistakenFor(
                      hex,
                      existing
                        .filter((row) => row.term.code !== colour?.term.code)
                        .map((row) => row.term)
                    )
                  : null
                return (
                  <div className="flex flex-col gap-2 rounded-inner bg-soft-2 px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <ColourSwatch
                        hex={agreed ? hex : null}
                        label={
                          values.label.trim() === ""
                            ? "Unnamed"
                            : values.label.trim()
                        }
                        code={values.code.trim()}
                      />
                      <span className="text-[0.71875rem] text-mute">
                        {agreed
                          ? "How it reads in the picker."
                          : "No swatch until a hex is agreed."}
                      </span>
                    </div>

                    {/* A caution, never a refusal. A company really can carry
                        two navies for two fabrics — but the reason this table
                        exists is that nobody could SEE the third "Navy" being
                        created, and two dots this close are one dot on a rail
                        of ten. */}
                    {twin && (
                      <div className="flex items-start gap-2.5 border-t border-hairline pt-2">
                        <ColourSwatch
                          hex={twin.hex_code}
                          label={twin.label}
                          code={twin.code}
                        />
                        <span className="text-[0.71875rem] leading-relaxed text-warn-fg">
                          Reads the same as this at a glance. Two colours a
                          person cannot tell apart split every report that
                          groups by colour — pick a different one, or be sure
                          the difference is real.
                        </span>
                      </div>
                    )}
                  </div>
                )
              }}
            </form.Subscribe>

            <Button
              type="submit"
              variant="primary"
              disabled={
                save.isPending ||
                Object.values(problems).some((one) => one !== undefined)
              }
            >
              {save.isPending
                ? "Saving…"
                : colour === null
                  ? "Add to the list"
                  : "Save"}
            </Button>
          </>
        )}
      </form.Subscribe>
    </form>
  )
}

/// Retire, restore or delete one colour, and the counts behind each.
///
/// The rule and the buttons are `MasterLifecycle`, shared with the three word
/// lists; this is the part that differs — which endpoints the verbs go to.
///
/// Every article wearing a colour holds its code, and every printed label
/// already carries the name as a snapshot, which is why retiring rather than
/// deleting is the ordinary way out: the articles that have it keep it, and
/// nobody can choose it for a new one.
function ColourLifecycle({
  colour,
  onGone,
}: {
  colour: ColourRow
  onGone: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const usage = useQuery({
    queryKey: colourKeys.usage(colour.term.code),
    queryFn: ({ signal }) => colourUsage(colour.term.code, signal),
  })

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: colourKeys.all })
    void client.invalidateQueries({ queryKey: ["articles"] })
    idempotency.rotate()
  }

  return (
    <MasterLifecycle
      subject="colour"
      label={colour.term.label}
      active={colour.active}
      usage={usage}
      onSetActive={async (active) => {
        await updateColour(
          colour.term.code,
          { active },
          colour.term.version,
          idempotency.key
        )
        invalidate()
      }}
      onDelete={async () => {
        await deleteColour(colour.term.code, colour.term.version)
        invalidate()
      }}
      onDeleted={onGone}
    />
  )
}
