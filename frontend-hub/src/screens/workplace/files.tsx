import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { FileWarning } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { fileUrl, listFiles, workplaceKeys } from "@/lib/queries/workplace"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { ago, bytes, fileKind } from "@/screens/workplace/lib"
import { FileTile } from "@/screens/workplace/parts"
import type { FileInContext } from "@itulah/contract"

/// Files — everything the signed-in person can actually reach.
///
/// Not a file browser, and the shape of the row says so: every file carries the
/// room it belongs to, because that room's route is the only way to fetch its
/// bytes. There is deliberately no `GET /files/{id}` on the server — a URL that
/// worked on its own could be pasted to somebody who was never in the
/// conversation — so every download here goes back out through a discussion or
/// a conversation.
///
/// This is a table, unlike the other two workplace screens, because these rows
/// genuinely are compared: how big, how old, which room, and whether the bytes
/// are still there.
///
/// There is no upload button. `POST /files` stores bytes and answers with an
/// id, and a stored file that no message names is reachable from nowhere — so
/// uploading happens in the composers, where the file gets a room in the same
/// breath.

const columns: ColumnDef<TableSetup, FileInContext>[] = [
  {
    id: "file",
    accessorFn: (row) => row.file.file_name,
    header: "File",
    size: 300,
    cell: ({ row }) => (
      <span className="flex items-center gap-2.5">
        <FileTile name={row.original.file.file_name} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">
            {row.original.file.file_name}
          </span>
          <span className="block font-mono text-[0.65625rem] text-mute">
            {row.original.file.content_type}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "room",
    accessorFn: (row) => row.source_title,
    header: "Room",
    size: 240,
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <Tag
          tone={row.original.source_kind === "DISCUSSION" ? "info" : "neutral"}
        >
          {row.original.source_kind === "DISCUSSION" ? "THREAD" : "CHAT"}
        </Tag>
        {/* No dead ends: the room is one click away, and it is also the only
            route to the bytes. The stop lives on a wrapper because `<AppLink>`
            forwards Router's own props and Router's `LinkProps` has no
            `onClick`; without it the row's own click would open the file sheet
            behind the navigation. */}
        <span className="min-w-0" onClick={(event) => event.stopPropagation()}>
          <AppLink
            to={
              row.original.source_kind === "DISCUSSION"
                ? "/workplace"
                : "/workplace/chat"
            }
            sheet={{
              key:
                row.original.source_kind === "DISCUSSION"
                  ? "thread"
                  : "conversation",
              value: row.original.source_id,
            }}
            className="block truncate text-text hover:text-accent"
          >
            {row.original.source_title}
          </AppLink>
        </span>
      </span>
    ),
  },
  {
    id: "uploaded_by",
    accessorFn: (row) => row.file.uploaded_by,
    header: "Uploaded by",
    size: 150,
  },
  {
    id: "byte_size",
    accessorFn: (row) => row.file.byte_size,
    header: "Size",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => bytes(row.original.file.byte_size),
  },
  {
    id: "uploaded_at",
    accessorFn: (row) => row.file.uploaded_at,
    header: "Uploaded",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => ago(row.original.file.uploaded_at),
  },
  {
    id: "available",
    accessorFn: (row) => row.file.available,
    header: "Bytes",
    size: 120,
    // The decision metric, and why this list sorts by it: a file whose object
    // has gone is the only row on this screen anybody has to do something
    // about. Attached-but-gone is rendered rather than hidden — a row beside a
    // link that 404s is worse than saying it plainly.
    cell: ({ row }) =>
      row.original.file.available ? (
        <span className="text-mute">There</span>
      ) : (
        <Pill tone="bad">Gone</Pill>
      ),
  },
]

export function Files() {
  const file = useSheet("file")
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "available", desc: false },
    { id: "uploaded_at", desc: true },
  ])

  const files = useQuery({
    queryKey: workplaceKeys.files(),
    queryFn: ({ signal }) => listFiles(200, signal),
  })

  const rows = useMemo(() => files.data ?? [], [files.data])

  const missing = useMemo<Exception[]>(
    () =>
      rows
        .filter((row) => !row.file.available)
        .map((row) => ({
          id: row.file.file_id,
          title: row.file.file_name,
          detail: `Attached in ${row.source_title}, and the object is not in storage.`,
          amount: bytes(row.file.byte_size),
          severity: "medium" as const,
          icon: <FileWarning className="size-4" />,
          onOpen: () => file.open(row.file.file_id),
        })),
    [rows, file]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: FileInContext) => row.file.file_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Workplace"
        title="Files"
        sub="Everything attached in a room you can read. Uploading happens where the file gets a room."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      {missing.length > 0 && (
        <ExceptionQueue
          title="Filed, but the bytes are gone"
          exceptions={missing}
        />
      )}

      <Card className="overflow-hidden">
        {queryState(files, {
          loading: "Loading the files…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing has been attached in any room you can read.
              </EmptyState>
            ) : (
              <DataTable<FileInContext>
                table={table}
                onRowClick={(row) => file.open(row.file.file_id)}
                isSelected={(row) => row.file.file_id === file.value}
                empty="No file matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <FileSheet id={file.value ?? null} rows={rows} onClose={file.close} />
    </PageContent>
  )
}

/// The file's own facts.
///
/// This sheet is handed the row rather than fetching its own, and that is not a
/// shortcut: there is no `GET /files/{id}` to fetch. Permission lives in the
/// room, so the list is the only place a file is described, and the sheet says
/// what the list already knows plus the one thing it cannot fit — the hash.
function FileSheet({
  id,
  rows,
  onClose,
}: {
  id: string | null
  rows: readonly FileInContext[]
  onClose: () => void
}) {
  const row = rows.find((candidate) => candidate.file.file_id === id)

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      id={row ? fileKind(row.file.file_name) : undefined}
      title={row?.file.file_name ?? "File"}
    >
      {row === undefined ? (
        <EmptyState>
          That file is not in the list this screen loaded. It may have been
          attached in a room you cannot read.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            {row.file.available ? (
              <Pill tone="ok">The bytes are there</Pill>
            ) : (
              <Pill tone="bad">The bytes are gone</Pill>
            )}
            <Tag>{row.file.content_type}</Tag>
          </div>

          <Facts>
            <Fact term="Size">{bytes(row.file.byte_size)}</Fact>
            <Fact term="Uploaded">{moment(row.file.uploaded_at)}</Fact>
            <Fact term="By">{row.file.uploaded_by}</Fact>
            <Fact term="Room">{row.source_title}</Fact>
          </Facts>

          <div>
            <h4 className="mb-1 text-eyebrow font-semibold text-mute uppercase">
              Content hash
            </h4>
            {/* The same invoice uploaded twice is two rows and one hash, and
                this screen may say so. */}
            <p className="font-mono text-[0.65625rem] break-all text-body">
              {row.file.sha256}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {row.file.available ? (
              <a
                href={fileUrl(row)}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-hairline-2 bg-canvas px-3 text-[0.78125rem] font-medium text-text transition-colors hover:bg-soft-2"
              >
                Download
              </a>
            ) : (
              <Button variant="ghost" disabled>
                Download
              </Button>
            )}
            <AppLink
              to={
                row.source_kind === "DISCUSSION"
                  ? "/workplace"
                  : "/workplace/chat"
              }
              sheet={{
                key:
                  row.source_kind === "DISCUSSION" ? "thread" : "conversation",
                value: row.source_id,
              }}
              variant="soft"
            >
              Open the room
            </AppLink>
          </div>
        </div>
      )}
    </Sheet>
  )
}
