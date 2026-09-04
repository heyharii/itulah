import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { FileWarning, LayoutGrid, Rows3, Upload } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { queryState } from "@/lib/query-state"
import {
  listFiles,
  searchDocuments,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { ago, bytes, fileKind } from "@/screens/workplace/lib"
import { FileTile } from "@/screens/workplace/parts"
import {
  attention,
  folderOf,
  fromAttachment,
  fromDocument,
  kindOf,
  SOURCE_LABEL,
  stateOf,
  type VaultRow,
} from "@/screens/workplace/vault"
import { PlaceSheet, VaultSheet } from "@/screens/workplace/vault-sheets"
import { VaultTile } from "@/screens/workplace/vault-tile"

/// Files — the vault, in the shape midday's is, over both of the drawers we
/// had.
///
/// There were two screens until 2026-09-04. Documents read the `document` table
/// — whose migration opens by saying it is "modelled on midday's Vault" — and
/// drew it as a plain table. Files read the attachments and had midday's grid,
/// tiles, previews and view switch. So the model was on one screen and the look
/// was on the other, and a person hunting for a PDF had to guess which of two
/// identically-named icons somebody else had put it behind: "hapus documents
/// jika sudah ada files, kenapa double double".
///
/// This is the one screen. The distinction the two screens were expressing is
/// not thrown away — it is a facet now, `Where`, and it is the first filter in
/// the bar, because "filed on purpose" and "attached in a conversation" really
/// are different answers to "why is this file here". See `vault.ts` for the row
/// model and why the two sources stay legible inside one list.
///
/// # Three places it deliberately differs from midday
///
///   * **Copy link copies an app link.** midday mints a short public URL.
///     `0040_collaboration.sql` refused `stored_file` a `url` column so a link
///     could not be forwarded out of the room it was posted in; a public URL
///     would undo that with one paste.
///   * **Dropping a file asks where it goes.** midday drops a file into a
///     folder. Here the two destinations are a room or the drawer, and they are
///     genuinely different things — see `PlaceSheet`.
///   * **There is no delete.** The server has no route for it.

/// midday's breakpoints, kept: 1 column, then 2 at 640, 3 at 768, 4 at 1024 and
/// 6 at 1800. The last is an arbitrary variant rather than a named breakpoint
/// because 1800 is not one of Tailwind's, and inventing a `3xl` for one screen
/// would be a token nothing else reads.
const GRID =
  "grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 min-[1800px]:grid-cols-6"

const columns: ColumnDef<TableSetup, VaultRow>[] = [
  {
    id: "name",
    accessorFn: (row) => `${row.title} ${row.name}`,
    header: "File",
    size: 320,
    meta: { filter: { kind: "text", label: "Name" } },
    cell: ({ row }) => (
      <span className="flex items-center gap-2.5">
        <FileTile name={row.original.name} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">
            {row.original.title}
          </span>
          <span className="block truncate font-mono text-[0.65625rem] text-mute">
            {row.original.source === "FILED" && row.original.folder.length > 0
              ? folderOf(row.original)
              : row.original.name}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "source",
    accessorFn: (row) => SOURCE_LABEL[row.source],
    header: "Where",
    size: 200,
    // The facet the merge exists to preserve. First in the bar because it is
    // the question the two screens used to answer by being two screens.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) =>
      row.original.room === null ? (
        <span className="flex items-center gap-2">
          <Tag tone="accent">FILED</Tag>
          <span className="min-w-0 truncate text-mute">
            {folderOf(row.original)}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Tag
            tone={row.original.room.kind === "DISCUSSION" ? "info" : "neutral"}
          >
            {row.original.room.kind === "DISCUSSION" ? "THREAD" : "CHAT"}
          </Tag>
          {/* No dead ends: the room is one click away, and for an attachment it
              is also the only route to the bytes. The stop lives on a wrapper
              because `<AppLink>` forwards Router's own props and Router's
              `LinkProps` has no `onClick`; without it the row's own click would
              open the sheet behind the navigation. */}
          <span
            className="min-w-0"
            onClick={(event) => event.stopPropagation()}
          >
            <AppLink
              to={
                row.original.room.kind === "DISCUSSION"
                  ? "/discussions"
                  : "/chat"
              }
              sheet={{
                key:
                  row.original.room.kind === "DISCUSSION"
                    ? "thread"
                    : "conversation",
                value: row.original.room.id,
              }}
              className="block truncate text-text hover:text-accent"
            >
              {row.original.room.title}
            </AppLink>
          </span>
        </span>
      ),
  },
  {
    id: "tags",
    accessorFn: (row) => row.tags,
    header: "Tags",
    size: 170,
    meta: { filter: { kind: "multi" } },
    cell: ({ row }) =>
      row.original.tags.length === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {row.original.tags.map((tag) => (
            <Tag key={tag} tone="accent">
              {tag}
            </Tag>
          ))}
        </span>
      ),
  },
  {
    id: "kind",
    accessorFn: kindOf,
    header: "Type",
    size: 120,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="font-mono text-[0.65625rem] text-body">
        {fileKind(row.original.name)}
      </span>
    ),
  },
  {
    id: "by",
    accessorFn: (row) => row.by,
    header: "Added by",
    size: 140,
    meta: { filter: { kind: "option" } },
  },
  {
    id: "at",
    accessorFn: (row) => row.at,
    header: "Added",
    size: 120,
    meta: { align: "right", filter: { kind: "date" } },
    cell: ({ row }) => ago(row.original.at),
  },
  {
    id: "byteSize",
    accessorFn: (row) => row.byteSize,
    header: "Size",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "bytes" } },
    cell: ({ row }) => bytes(row.original.byteSize),
  },
  {
    id: "state",
    accessorFn: stateOf,
    header: "State",
    size: 140,
    meta: { filter: { kind: "option" } },
    // The decision metric, and why this list sorts by it: a file whose object
    // has gone, or whose text was never extracted, is the only row anybody has
    // to do something about. Rendered rather than hidden — a row beside a link
    // that 404s is worse than saying it plainly.
    cell: ({ row }) => {
      const state = stateOf(row.original)
      return state === "There" ? (
        <span className="text-mute">There</span>
      ) : (
        <Pill tone={state === "Gone" ? "bad" : "warn"}>{state}</Pill>
      )
    },
  },
]

export function Files() {
  // Both keys stay in the URL. `?document=` was the Documents screen's and is
  // in people's history and in links they have sent each other; a merge that
  // broke them would be a worse answer than the screen they wanted.
  const filed = useSheet("document")
  const attached = useSheet("file")
  const view = useSheet("view")
  const grid = view.value !== "list"

  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "state", desc: false },
    { id: "at", desc: true },
  ])
  const [picked, setPicked] = useState<readonly File[]>([])

  const documents = useQuery({
    queryKey: workplaceKeys.documents({}),
    queryFn: ({ signal }) => searchDocuments({ limit: 200 }, signal),
  })
  const attachments = useQuery({
    queryKey: workplaceKeys.files(),
    queryFn: ({ signal }) => listFiles(200, signal),
  })

  const rows = useMemo<VaultRow[]>(() => {
    const all = [
      ...(documents.data ?? []).map(fromDocument),
      ...(attachments.data ?? []).map(fromAttachment),
    ]
    // Sorted here rather than left to the table, because the grid has no
    // headers to sort by and both views must agree on what comes first.
    return all.sort(
      (a, b) => attention(a) - attention(b) || b.at.localeCompare(a.at)
    )
  }, [documents.data, attachments.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: VaultRow) => row.key,
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

  /// The grid draws the table's own filtered rows rather than filtering again.
  ///
  /// One narrowing, so a chip in the bar and a word in the search box mean the
  /// same thing in both views — which is the failure the old screen had, where
  /// the grid filtered on three fields by hand and the list filtered on eight.
  ///
  /// Not wrapped in `useMemo`: the row model is already memoised inside the
  /// table against its own state, and a second cache keyed on what this
  /// component happens to know would go stale the first time the table changed
  /// for a reason not in that list.
  const shown = table
    .getFilteredRowModel()
    .rows.map((row: { original: VaultRow }) => row.original)

  const open =
    rows.find((row) => row.source === "FILED" && row.id === filed.value) ??
    rows.find((row) => row.source !== "FILED" && row.id === attached.value) ??
    null

  const closeSheet = () => {
    if (filed.value !== undefined) filed.close()
    if (attached.value !== undefined) attached.close()
  }

  const missing = useMemo<Exception[]>(
    () =>
      rows
        .filter((row) => !row.available)
        .map((row) => ({
          id: row.key,
          title: row.title,
          detail:
            row.room === null
              ? "Filed, and the object is not in storage."
              : `Attached in ${row.room.title}, and the object is not in storage.`,
          amount: bytes(row.byteSize),
          severity: "medium" as const,
          icon: <FileWarning className="size-4" />,
          onOpen: () =>
            row.source === "FILED" ? filed.open(row.id) : attached.open(row.id),
        })),
    [rows, filed, attached]
  )

  /// Two requests, one screen state.
  ///
  /// Pending while either is, because a grid that fills in halfway looks like
  /// the drawer is missing files. Failed only when BOTH have failed: one drawer
  /// answering is worth drawing, and the banner above says which one did not —
  /// an error page over a working half is a screen that hides what it has.
  const drawer = {
    isPending: documents.isPending || attachments.isPending,
    isError: documents.isError && attachments.isError,
    error: documents.error ?? attachments.error,
    data: rows,
    refetch: () => {
      void documents.refetch()
      void attachments.refetch()
    },
  }

  const problem =
    documents.error instanceof Error
      ? documents.error
      : attachments.error instanceof Error
        ? attachments.error
        : null

  return (
    <UploadZone onFiles={setPicked}>
      <PageContent>
        <PageHeader
          title="Files"
          sub="Everything filed, and everything attached in a room you can read. One drawer."
          actions={
            <>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="h-8 w-48"
              />
              <ViewSwitch grid={grid} onChange={view.open} />
              <PickButton onFiles={setPicked} />
            </>
          }
        />

        <Toolbar>
          <FilterBar model={filters} table={table} />
        </Toolbar>

        {problem !== null && (
          <Banner tone="bad" className="mb-4">
            {problem.message}
          </Banner>
        )}

        {missing.length > 0 && (
          <ExceptionQueue
            title="In the drawer, but the bytes are gone"
            exceptions={missing}
          />
        )}

        {queryState(drawer, {
          loading: "Opening the drawer…",
          render: () =>
            rows.length === 0 ? (
              <Card>
                <EmptyState>
                  Nothing has been filed, and nothing has been attached in a
                  room you can read. Drop a file anywhere on this page to start
                  one off.
                </EmptyState>
              </Card>
            ) : shown.length === 0 ? (
              <Card>
                <EmptyState>
                  Nothing in the drawer matches that.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("")
                      filters.clear()
                    }}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Clear the search
                  </button>
                </EmptyState>
              </Card>
            ) : grid ? (
              <div className={GRID}>
                {shown.map((row) => (
                  <VaultTile
                    key={row.key}
                    row={row}
                    onOpen={() =>
                      row.source === "FILED"
                        ? filed.open(row.id)
                        : attached.open(row.id)
                    }
                    onTag={(tag) =>
                      filters.commit({
                        column: "tags",
                        operator: "includesAnyOf",
                        values: [tag],
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <Card className="overflow-hidden">
                <DataTable<VaultRow>
                  table={table}
                  onRowClick={(row) =>
                    row.source === "FILED"
                      ? filed.open(row.id)
                      : attached.open(row.id)
                  }
                  isSelected={(row) =>
                    row.id === filed.value || row.id === attached.value
                  }
                  empty="Nothing in the drawer matches that."
                  className="max-h-[calc(100vh-16rem)]"
                />
              </Card>
            ),
        })}

        <VaultSheet row={open} onClose={closeSheet} />
        <PlaceSheet files={picked} onClose={() => setPicked([])} />
      </PageContent>
    </UploadZone>
  )
}

/// Grid or list, midday's switch.
///
/// Written here rather than reaching for `<ButtonGroup>`: that component paints
/// every child `text-text` through a `[&>button]` selector, which outranks a
/// class on the button itself, so a "which one is on" state cannot be expressed
/// through it without `!important`. Two buttons are cheaper than that argument.
function ViewSwitch({
  grid,
  onChange,
}: {
  grid: boolean
  onChange: (view: string) => void
}) {
  // The value is passed, never derived from the label: `oneOf` in the sheet
  // registry drops anything but these two words, so renaming a label to "Tiles"
  // would quietly stop the switch working rather than fail loudly.
  const button = (
    value: string,
    active: boolean,
    label: string,
    icon: React.ReactNode
  ) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={() => onChange(value)}
      className={cn(
        "grid h-8 w-9 place-items-center transition-colors",
        active
          ? "bg-soft-2 text-ink"
          : "text-mute hover:bg-soft hover:text-text"
      )}
    >
      {icon}
    </button>
  )

  return (
    <div className="inline-flex overflow-hidden rounded-full border border-hairline-2">
      {button("grid", grid, "Grid", <LayoutGrid className="size-3.5" />)}
      <span className="w-px bg-hairline" />
      {button("list", !grid, "List", <Rows3 className="size-3.5" />)}
    </div>
  )
}

// ---- The drop zone -----------------------------------------------------

/// A drop target over the whole page, the way midday's vault has one.
///
/// The counter is not fussiness: `dragenter` and `dragleave` fire for every
/// child element the pointer crosses, so a boolean flickers the overlay off the
/// moment somebody drags over a card. Counting the pairs is the only thing that
/// does not.
function UploadZone({
  onFiles,
  children,
}: {
  onFiles: (files: readonly File[]) => void
  children: React.ReactNode
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  return (
    <div
      className="relative min-h-full"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        // Without this the browser navigates to the file instead, which loses
        // the page and everything on it.
        event.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        depth.current = 0
        setOver(false)
        onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-canvas/80 backdrop-blur-[1px]">
          <div className="rounded-outer flex flex-col items-center gap-2 border border-dashed border-accent bg-canvas px-10 py-8">
            <Upload className="size-5 text-accent" />
            <p className="text-card-title font-medium text-ink">
              Drop it to upload
            </p>
            <p className="text-meta text-body">
              You will be asked whether it goes in a room or in the drawer.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/// The same gesture for people who would rather click than drag.
function PickButton({
  onFiles,
}: {
  onFiles: (files: readonly File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []))
          // Cleared so picking the same file twice in a row still fires.
          event.target.value = ""
        }}
      />
      <Button variant="dark" onClick={() => input.current?.click()}>
        Add a file
      </Button>
    </>
  )
}
