import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ago, formatBytes } from "@/lib/collaboration"
import { fileKind, fileRoom, fileUrl, filesKey, listFiles } from "@/lib/files"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Download, FileWarning, MessagesSquare, Users } from "lucide-react"
import { useMemo, useState } from "react"

/// Every file this person can reach, and the room each one belongs to.
///
/// Not a file browser, and it is worth being plain about why. There is no
/// global file table to page through: these rows come from conversations this
/// person is in plus discussions, which everybody signed in may read. Each row
/// carries its room because that room's route is the only way to open the
/// bytes — a file id on its own reaches nothing, which is what stops a link
/// leaving the conversation it was shared in.
export function FilesView() {
  const [query, setQuery] = useState("")
  const files = useQuery({
    queryKey: filesKey(),
    queryFn: ({ signal }) => listFiles(200, signal),
  })

  const rows = useMemo(() => {
    const all = files.data ?? []
    const needle = query.trim().toLowerCase()
    if (needle === "") return all
    return all.filter((row) =>
      [row.file.file_name, row.file.uploaded_by, row.source_title]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [files.data, query])

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="Files"
        subtitle={
          files.isPending
            ? "loading…"
            : `${rows.length} file${rows.length === 1 ? "" : "s"}`
        }
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search names, people, rooms"
          className="hidden h-8 w-56 text-xs sm:block"
        />
      </ScreenHeader>

      <ScreenBody>
        {files.isPending ? (
          <ScreenState>Loading files…</ScreenState>
        ) : files.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void files.refetch()}>
                Try again
              </Button>
            }
          >
            {files.error instanceof ApiError
              ? files.error.message
              : "The files could not be loaded."}
          </ScreenState>
        ) : rows.length === 0 ? (
          <ScreenState>
            {(files.data ?? []).length === 0
              ? "Nothing has been attached yet. Files arrive here by being attached to a conversation or a discussion — there is nowhere else to put one."
              : "Nothing matches that."}
          </ScreenState>
        ) : (
          <ul>
            {rows.map((row) => {
              const room = fileRoom(row)
              return (
                <li
                  key={`${row.source_kind}-${row.source_id}-${row.file.file_id}`}
                  className="flex items-center gap-3 border-b px-3.5 py-2.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg font-mono text-[9px] font-medium",
                      !row.file.available && "text-destructive",
                    )}
                  >
                    {row.file.available ? (
                      fileKind(row.file.file_name)
                    ) : (
                      <FileWarning className="size-4" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {row.file.file_name}
                    </span>
                    <span className="text-muted-foreground block truncate font-mono text-[10.5px]">
                      {formatBytes(row.file.byte_size)} · {row.file.sha256.slice(0, 8)} ·{" "}
                      {row.file.uploaded_by} · {ago(row.file.uploaded_at)}
                    </span>
                  </span>

                  {/* The room, because that is where the file makes sense and
                      also the only route to its bytes. */}
                  <Link
                    to={room.to}
                    params={room.params as never}
                    className="text-muted-foreground hover:bg-muted hidden max-w-56 shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors sm:flex"
                  >
                    {row.source_kind === "DISCUSSION" ? (
                      <MessagesSquare className="size-3 shrink-0" />
                    ) : (
                      <Users className="size-3 shrink-0" />
                    )}
                    <span className="truncate">{row.source_title}</span>
                  </Link>

                  {row.file.available ? (
                    <Button size="icon-sm" variant="ghost" render={<a href={fileUrl(row)} />}>
                      <Download />
                      <span className="sr-only">Download {row.file.file_name}</span>
                    </Button>
                  ) : (
                    <span
                      className="text-muted-foreground shrink-0 text-[10.5px]"
                      title="The row is here; the bytes could not be reached."
                    >
                      not retrievable
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </ScreenBody>
    </AppShell>
  )
}
