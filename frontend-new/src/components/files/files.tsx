import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { FilesSidebar, type Scope } from "@/components/files/files-sidebar"
import {
  FileGlyph,
  FileGrid,
  FileTable,
  OwnerAvatar,
} from "@/components/files/file-views"
import { useDocumentLibraryResource } from "@/components/files/api"
import {
  useCreateLibraryFolder,
  useSetLibraryFavourite,
  useSetLibraryTrashed,
  useShareLibraryFile,
  useUnshareLibraryFile,
} from "@/components/files/mutations"
import {
  FILES,
  KIND_META,
  OWNERS,
  ROOT,
  childrenOf,
  countOf,
  displayName,
  formatSize,
  modifiedLabel,
  moduleLabel,
  ownerLabel,
  pathTo,
  sizeOf,
  type FileNode,
} from "@/components/files/data"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { PreviewNotice } from "@/components/backend-status"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/files"
import type { FilesSearch } from "@/routes/files"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

type SortKey = "name" | "modified" | "size"

/** Stable identity so the memoised scope lists do not thrash while loading. */
const EMPTY_NODES: FileNode[] = []

/** Every scope the fixture can answer. */
const FIXTURE_SCOPES: Scope[] = [
  "drive",
  "shared",
  "recent",
  "starred",
  "trash",
]

/**
 * What an OLDER cloud-hub can answer — one without migration 734. That library
 * is a flat, append-only feed with no favourites, no share table and no soft
 * delete, so those three scopes stay withheld rather than faked. A hub that
 * reports a folder tree answers all five, and gets FIXTURE_SCOPES.
 */
const FLAT_SCOPES: Scope[] = ["drive", "recent"]

export function Files() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { scope, layout, sort: sortKey, dir } = search
  const folder = search.folder ?? ROOT
  const query = search.q ?? ""
  const sort = useMemo(
    () => ({ key: sortKey, dir: dir === "desc" ? -1 : 1 }) as const,
    [sortKey, dir]
  )
  const openId = search.open
  const folderKey = `${scope}:${folder}`

  const [previewNodes, setPreviewNodes] = useState<FileNode[]>(FILES)
  const [selectedState, setSelectedState] = useState<{
    key: string
    ids: Set<string>
  }>({
    key: folderKey,
    ids: new Set(),
  })
  const selected =
    selectedState.key === folderKey ? selectedState.ids : new Set<string>()
  const setSelected = (
    update: Set<string> | ((current: Set<string>) => Set<string>)
  ) => {
    setSelectedState((prev) => {
      const current = prev.key === folderKey ? prev.ids : new Set<string>()
      const ids = typeof update === "function" ? update(current) : update
      return { key: folderKey, ids }
    })
  }
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([])
  const [sharing, setSharing] = useState<FileNode | null>(null)
  const [shareSubject, setShareSubject] = useState("")
  const libraryResource = useDocumentLibraryResource()
  const library = libraryResource.data
  const rawNodes = library?.nodes ?? previewNodes
  const favouriteMutation = useSetLibraryFavourite()
  /* Variables-based star (§M3): while the write is in flight, the toggled
   * node reads from the mutation's own `variables` rather than the cache —
   * every scope derived from `nodes` below (counts, the starred scope, the
   * detail sheet) picks it up for free. */
  const nodes = useMemo(() => {
    if (!favouriteMutation.isPending || !favouriteMutation.variables) return rawNodes
    const { id, favourite } = favouriteMutation.variables
    return rawNodes.map((n) => (n.id === id ? { ...n, starred: favourite } : n))
  }, [rawNodes, favouriteMutation.isPending, favouriteMutation.variables])
  const trashedNodes = library?.trashed ?? EMPTY_NODES
  const isLive = library !== undefined
  /** True only when the hub owns folders, favourites, trash and shares. */
  const canDrive = Boolean(library?.drive)
  const createFolderMutation = useCreateLibraryFolder()
  const trashMutation = useSetLibraryTrashed()
  const shareMutation = useShareLibraryFile()
  const unshareMutation = useUnshareLibraryFile()

  const setNav = (patch: Partial<FilesSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const detail = openId
    ? ([...nodes, ...trashedNodes].find((n) => n.id === openId) ?? null)
    : null

  useInteractionSounds(soundOn)

  const toast = (message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message }])
    cue("success")
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }

  const counts: Record<Scope, number> = useMemo(
    () => ({
      drive: childrenOf(nodes, ROOT).length,
      shared: nodes.filter(
        (n) => n.sharedWithMe || (n.sharedWith?.length ?? 0) > 0
      ).length,
      recent: nodes.filter(
        (n) => n.kind !== "folder" && n.modified < 60 * 24 * 7
      ).length,
      starred: nodes.filter((n) => n.starred).length,
      trash: trashedNodes.length,
    }),
    [nodes, trashedNodes]
  )

  /** Scopes other than My Drive are flat lists, so the breadcrumb hides. */
  const inFolderView = scope === "drive" && !query.trim()

  const visible = useMemo(() => {
    let list: FileNode[]
    const q = query.trim().toLowerCase()

    if (q)
      list = nodes.filter((n) =>
        [
          n.name,
          n.documentTitle,
          n.summary,
          n.recordTitle,
          moduleLabel(n.sourceDomain),
          n.sourceEntityType,
          ...(n.tags ?? []),
        ]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      )
    else if (scope === "drive") list = childrenOf(nodes, folder)
    else if (scope === "shared")
      list = nodes.filter(
        (n) => n.sharedWithMe || (n.sharedWith?.length ?? 0) > 0
      )
    else if (scope === "recent")
      list = [...nodes]
        .filter((n) => n.kind !== "folder")
        .sort((a, b) => a.modified - b.modified)
        .slice(0, 12)
    else if (scope === "starred") list = nodes.filter((n) => n.starred)
    else if (scope === "trash") list = trashedNodes
    else list = []

    const { key, dir } = sort
    return [...list].sort((a, b) => {
      // folders always lead, whatever the sort
      if ((a.kind === "folder") !== (b.kind === "folder"))
        return a.kind === "folder" ? -1 : 1
      const d =
        key === "name"
          ? a.name.localeCompare(b.name)
          : key === "modified"
            ? a.modified - b.modified
            : sizeOf(nodes, a) - sizeOf(nodes, b)
      return d * dir
    })
  }, [nodes, trashedNodes, scope, folder, query, sort])

  const crumbs = folder === ROOT ? [] : pathTo(nodes, folder)

  const open = (node: FileNode) => {
    if (node.kind === "folder") {
      void navigate({
        search: (prev) => ({
          ...prev,
          scope: "drive",
          q: undefined,
          folder: node.id,
          open: undefined,
        }),
      })
      setSelected(new Set())
      return
    }
    void navigate({ search: (prev) => ({ ...prev, open: node.id }) })
  }

  const showDetails = (node: FileNode) =>
    void navigate({ search: (prev) => ({ ...prev, open: node.id }) })

  const closeDetails = () =>
    void navigate({
      search: (prev) => ({ ...prev, open: undefined }),
      replace: true,
    })

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s)
      const allOn = visible.every((n) => next.has(n.id))
      visible.forEach((n) => (allOn ? next.delete(n.id) : next.add(n.id)))
      return next
    })

  /**
   * Runs one drive write and toasts the result. The write owns its own cache
   * effect (§M1) — each mutation invalidates `fileQueries.library()` in its
   * own `onSettled` — so this helper no longer reloads anything itself, only
   * reports success or failure.
   */
  const driveWrite = (label: string, run: () => Promise<unknown>) => {
    run().then(
      () => toast(label),
      (error: unknown) => {
        cue("error")
        toast(error instanceof Error ? error.message : "That did not work")
      }
    )
  }

  const star = (id: string) => {
    if (!isLive) {
      setPreviewNodes((list) =>
        list.map((n) => (n.id === id ? { ...n, starred: !n.starred } : n))
      )
      return
    }
    if (!canDrive) return
    const node = rawNodes.find((n) => n.id === id)
    if (!node) return
    const next = !node.starred
    driveWrite(next ? "Starred" : "Unstarred", () =>
      favouriteMutation.mutateAsync({ id, favourite: next })
    )
  }

  const createFolder = () => {
    const name = newName.trim()
    if (isLive) {
      if (!canDrive) {
        setCreating(false)
        toast("This cloud-hub has no folder table")
        return
      }
      if (!name) return
      setNewName("")
      setCreating(false)
      driveWrite(`Created “${name}”`, () =>
        createFolderMutation.mutateAsync({ name, parentId: folder })
      )
      return
    }
    if (!name) return
    const node: FileNode = {
      id: `local-${Date.now()}`,
      name,
      kind: "folder",
      parentId: folder,
      size: 0,
      modified: 0,
      ownerId: "me",
    }
    setPreviewNodes((list) => [...list, node])
    setNewName("")
    setCreating(false)
    setNav({ scope: "drive" })
    toast(`Created “${name}”`)
  }

  /**
   * The hub streams an attachment's bytes from
   * `/api/v1/records/attachments/{id}/content` with an inline disposition; the
   * DTO hands that URL over as `content_url`.
   */
  const download = (list: FileNode[]) => {
    const files = list.filter((n) => n.contentUrl)
    if (files.length === 0) {
      toast("These rows carry no stored content")
      return
    }
    files.forEach((node) => {
      const link = document.createElement("a")
      link.href = node.contentUrl as string
      link.download = node.name
      link.rel = "noopener"
      document.body.append(link)
      link.click()
      link.remove()
    })
    toast(
      files.length === 1
        ? `Downloading “${files[0].name}”`
        : `Downloading ${files.length} files`
    )
  }

  const selectedNodes = [...nodes, ...trashedNodes].filter((n) =>
    selected.has(n.id)
  )

  /**
   * Moves the selection into the bin, or back out of it. Folders are trashed
   * last: the hub refuses to bin a folder that still holds live items, so the
   * files inside must go first for the folder call to succeed.
   */
  const trashSelection = (trashed: boolean) => {
    const ordered = [...selectedNodes].sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === "folder" ? 1 : -1
    )
    if (ordered.length === 0) return
    setSelected(new Set())
    driveWrite(
      trashed
        ? `Moved ${ordered.length} item${ordered.length === 1 ? "" : "s"} to Trash`
        : `Restored ${ordered.length} item${ordered.length === 1 ? "" : "s"}`,
      () => trashMutation.mutateAsync({ nodes: ordered, trashed })
    )
  }

  /** Grants one subject access to the file open in the share sheet. */
  const share = () => {
    const subject = shareSubject.trim()
    if (!sharing || !subject) return
    const file = sharing
    setShareSubject("")
    setSharing(null)
    driveWrite(`Shared with ${subject}`, () =>
      shareMutation.mutateAsync({ id: file.id, subjectId: subject })
    )
  }

  const viewProps = {
    nodes: visible,
    all: nodes,
    selected,
    onToggle: toggle,
    onToggleAll: toggleAll,
    onOpen: open,
    onDetails: showDetails,
    // Starring is per viewer and needs the favourites table; without it there
    // is nothing to write, so the control stays hidden rather than inert.
    onStar: !isLive || canDrive ? star : undefined,
  }

  const sortButton = (key: SortKey, label: string) => {
    const on = sort.key === key
    return (
      <button
        key={key}
        type="button"
        onClick={() =>
          setNav({
            sort: key,
            dir: sort.key === key && sort.dir === 1 ? "desc" : "asc",
          })
        }
        className={cn(
          "inline-flex h-[26px] items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors duration-[120ms]",
          on
            ? "bg-accent-tint text-accent-ink"
            : "text-ink-3 hover:bg-hover hover:text-ink"
        )}
      >
        {label}
        {on && (
          <Icon
            path={paths.arrowUp}
            size={11}
            width={2.4}
            className={cn(sort.dir === -1 && "rotate-180")}
          />
        )}
      </button>
    )
  }

  return (
    <AppShell
      label="Files navigation"
      railWidth={236}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[236px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <FilesSidebar
          scopes={isLive && !canDrive ? FLAT_SCOPES : FIXTURE_SCOPES}
          counts={counts}
          onCollapse={() => setRailHidden((v) => !v)}
          newDisabled={isLive && !canDrive}
          showStorage={!isLive}
          onNew={() => {
            setNewName("")
            setCreating(true)
          }}
          footer={
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
            >
              <Icon path={paths.sound} className="shrink-0 text-ink-4" />
              Interaction sounds
              <Switch on={soundOn} />
            </button>
          }
        />
      </AppShellSidebar>

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden py-2 pr-2 max-lg:pl-2",
          railHidden && "pl-2"
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pr-2.5 pl-3.5">
            {/* breadcrumb — the path you are standing in */}
            <div className="flex min-w-0 items-center gap-1">
              <SidebarTrigger className="-ml-1" />
              {inFolderView ? (
                <>
                  <Link
                    from="/files"
                    to="/files"
                    search={(prev) => ({
                      ...prev,
                      folder: undefined,
                      open: undefined,
                    })}
                    className={cn(
                      "shrink-0 rounded-control px-1.5 py-1 text-sm font-semibold tracking-[-0.01em] transition-colors hover:bg-hover",
                      folder === ROOT ? "text-ink" : "text-ink-3 hover:text-ink"
                    )}
                  >
                    My Drive
                  </Link>
                  {crumbs.map((c, i) => (
                    <span
                      key={c.id}
                      className="flex min-w-0 items-center gap-1"
                    >
                      <Icon
                        path={paths.chevronRight}
                        size={13}
                        width={2}
                        className="shrink-0 text-ink-4"
                      />
                      <Link
                        from="/files"
                        to="/files"
                        search={(prev) => ({
                          ...prev,
                          folder: c.id,
                          open: undefined,
                        })}
                        className={cn(
                          "truncate rounded-control px-1.5 py-1 text-sm font-semibold tracking-[-0.01em] transition-colors hover:bg-hover",
                          i === crumbs.length - 1
                            ? "text-ink"
                            : "text-ink-3 hover:text-ink"
                        )}
                      >
                        {c.name}
                      </Link>
                    </span>
                  ))}
                </>
              ) : (
                <h1 className="px-1.5 text-sm font-semibold tracking-[-0.01em]">
                  {query.trim()
                    ? `Results for “${query.trim()}”`
                    : {
                        shared: "Shared with me",
                        recent: "Recent",
                        starred: "Starred",
                        trash: "Trash",
                        drive: "My Drive",
                      }[scope]}
                </h1>
              )}
              <span className="shrink-0 pl-1.5 font-mono text-[11.5px] text-ink-4">
                {visible.length}
              </span>
            </div>

            <div className="flex items-center gap-[7px]">
              <label className="inline-flex h-[30px] items-center gap-[7px] rounded-control bg-field px-[9px] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-[130ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
                <Icon path={paths.search} size={14} width={1.9} />
                <input
                  value={query}
                  onChange={(e) => setNav({ q: e.target.value || undefined })}
                  placeholder="Search Drive…"
                  aria-label="Search files"
                  className="w-[142px] text-xs font-medium placeholder:text-ink-4"
                />
              </label>

              {/* list / grid toggle */}
              <div className="flex items-center gap-0.5 rounded-control bg-inset p-0.5">
                {(
                  [
                    ["list", paths.list, "List view"],
                    ["grid", paths.grid, "Grid view"],
                  ] as const
                ).map(([id, icon, label]) => (
                  <Link
                    key={id}
                    from="/files"
                    to="/files"
                    replace
                    aria-label={label}
                    aria-pressed={layout === id}
                    search={(prev) => ({ ...prev, layout: id })}
                    className={cn(
                      "grid size-[26px] place-items-center rounded-[7px] transition-[background-color,color,box-shadow] duration-[130ms]",
                      layout === id
                        ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(18_18_18/.05)]"
                        : "text-ink-4 hover:text-ink-2"
                    )}
                  >
                    <Icon path={icon} size={14} width={1.9} />
                  </Link>
                ))}
              </div>

              <button
                type="button"
                disabled={isLive}
                title={
                  isLive
                    ? "cloud-hub uploads attach to an existing document record, which this screen does not pick"
                    : "Uploads are preview-only"
                }
                onClick={() => toast("Upload is preview-only")}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover disabled:pointer-events-none disabled:opacity-45"
              >
                <Icon path={paths.upload} size={14} width={1.9} />
                Upload
              </button>
            </div>
          </div>

          {isLive ? (
            <div className="flex shrink-0 items-start gap-2 border-b border-grass/20 bg-grass/5 px-3.5 py-2 text-[11px] leading-[1.45] text-ink-3">
              <Icon
                path={paths.cloud}
                size={14}
                width={1.8}
                className="mt-px shrink-0 text-grass"
              />
              <span>
                <span className="font-semibold text-ink-2">
                  cloud-hub document library ·{" "}
                </span>
                {library
                  ? `${library.total} file${library.total === 1 ? "" : "s"} across every module`
                  : "Live"}
                .{" "}
                {canDrive
                  ? "Folders, starring, trash and sharing are the hub's own. Uploading still attaches to a document record, and there is no storage quota to report."
                  : "This hub has no folder table, so folders are the files’ own module and entity type, and favourites, sharing and trash have no counterpart here."}
              </span>
            </div>
          ) : (
            <PreviewNotice title="Drive preview">
              {libraryResource.errorMessage
                ? `cloud-hub's document library could not be loaded (${libraryResource.errorMessage}). `
                : "cloud-hub owns the persisted document library, but it is not reachable, so "}
              the rows below are local preview data and must not be used as an
              upload or retention record.
            </PreviewNotice>
          )}

          <div className="flex h-10 shrink-0 items-center gap-1 border-t border-b border-t-line border-b-line-strong pr-2.5 pl-3">
            <span className="pr-1 pl-0.5 text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              Sort
            </span>
            {sortButton("name", "Name")}
            {sortButton("modified", "Modified")}
            {sortButton("size", "Size")}
          </div>

          <div className="min-h-0 flex-1 [scrollbar-color:var(--line-strong)_transparent] overflow-auto">
            {visible.length === 0 ? (
              <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-ink-4">
                <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  <Icon
                    path={scope === "trash" ? paths.trash : paths.folder}
                    size={17}
                    width={1.8}
                  />
                </span>
                <span className="max-w-[300px] text-center text-xs">
                  {scope === "trash"
                    ? "Trash is empty."
                    : isLive && library?.fileCount === 0 && !query.trim()
                      ? "cloud-hub's document library holds no files yet — no document record has an attachment."
                      : "Nothing here yet."}
                </span>
              </div>
            ) : layout === "list" ? (
              <FileTable {...viewProps} />
            ) : (
              <FileGrid {...viewProps} />
            )}
          </div>

          {selected.size > 0 && (
            <div className="absolute bottom-4 left-1/2 z-25 flex -translate-x-1/2 animate-rise items-center gap-1.5 rounded-full bg-ink py-1.5 pr-[7px] pl-[13px] text-white shadow-[0_8px_28px_-8px_rgb(18_18_18/.45)]">
              <span className="text-xs font-semibold tabular-nums">
                {selected.size} selected
              </span>
              <span className="h-[17px] w-px bg-white/20" />
              {isLive && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      download(
                        [...nodes, ...trashedNodes].filter((n) =>
                          selected.has(n.id)
                        )
                      )
                    }
                    className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white"
                  >
                    <Icon path={paths.download} size={13} width={2} />
                    Download
                  </button>
                  {canDrive && scope !== "trash" && (
                    <>
                      {selectedNodes.length === 1 &&
                        selectedNodes[0].kind !== "folder" && (
                          <button
                            type="button"
                            onClick={() => {
                              setShareSubject("")
                              setSharing(selectedNodes[0])
                            }}
                            className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white"
                          >
                            <Icon path={paths.people} size={13} width={2} />
                            Share
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => trashSelection(true)}
                        className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white"
                      >
                        <Icon path={paths.trash} size={13} width={2} />
                        Remove
                      </button>
                    </>
                  )}
                  {canDrive && scope === "trash" && (
                    <button
                      type="button"
                      onClick={() => trashSelection(false)}
                      className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white"
                    >
                      <Icon path={paths.reply} size={13} width={2} />
                      Restore
                    </button>
                  )}
                </>
              )}
              {!isLive && (
                <>
                  {[
                    {
                      label: "Share",
                      icon: paths.people,
                      run: () => toast("Sharing is preview-only"),
                    },
                    {
                      label: "Download",
                      icon: paths.download,
                      run: () => toast("Downloads are preview-only"),
                    },
                    {
                      label: "Remove",
                      icon: paths.trash,
                      run: () => {
                        setPreviewNodes((list) =>
                          list.filter((n) => !selected.has(n.id))
                        )
                        toast(`Moved ${selected.size} items to preview trash`)
                        setSelected(new Set())
                      },
                    },
                  ].map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={action.run}
                      className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white"
                    >
                      <Icon path={action.icon} size={13} width={2} />
                      {action.label}
                    </button>
                  ))}
                </>
              )}
              <span className="h-[17px] w-px bg-white/20" />
              <button
                type="button"
                aria-label="Clear selection"
                onClick={() => setSelected(new Set())}
                className="grid size-[27px] place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Icon path={paths.close} size={13} width={2.2} />
              </button>
            </div>
          )}
        </div>
      </main>

      {/* details */}
      <SheetShell
        open={Boolean(detail)}
        eyebrow={detail ? KIND_META[detail.kind].label : "Item"}
        title={detail ? displayName(detail) : ""}
        onRequestClose={closeDetails}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={closeDetails}
              className={sheetButton.secondary}
            >
              Close
            </button>
            {/* The hub streams attachment bytes, so a live row has a real file
                behind it; a preview row has nothing to link to. */}
            {detail?.contentUrl ? (
              <a
                href={detail.contentUrl}
                download={detail.name}
                rel="noopener"
                className={sheetButton.primary}
              >
                <Icon path={paths.download} size={14} width={2.2} />
                Download
              </a>
            ) : (
              <span className="inline-flex h-[30px] items-center rounded-control px-2.5 text-xs font-medium text-ink-4">
                {isLive ? "No stored content" : "Preview only"}
              </span>
            )}
          </>
        }
      >
        {detail && (
          <div className="px-[18px] pt-4 pb-[18px]">
            <div
              style={{
                background: `color-mix(in srgb, ${KIND_META[detail.kind].hue} 9%, var(--surface))`,
              }}
              className="mb-4 grid h-[124px] place-items-center overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]"
            >
              {detail.kind === "image" && detail.contentUrl ? (
                <img
                  src={detail.contentUrl}
                  alt=""
                  className="size-full object-contain"
                />
              ) : (
                <FileGlyph node={detail} size={40} />
              )}
            </div>

            {[
              { label: "Kind", value: KIND_META[detail.kind].label },
              {
                label: "Size",
                value:
                  detail.kind === "folder"
                    ? `${countOf(nodes, detail.id)} items · ${formatSize(sizeOf(nodes, detail))}`
                    : formatSize(detail.size),
              },
              {
                label: detail.live ? "Uploaded" : "Modified",
                value: modifiedLabel(detail.modified),
              },
              ...(detail.mimeType
                ? [{ label: "Type", value: detail.mimeType }]
                : []),
              ...(detail.sourceDomain
                ? [{ label: "Module", value: moduleLabel(detail.sourceDomain) }]
                : []),
              ...(detail.sourceEntityType
                ? [{ label: "Entity", value: detail.sourceEntityType }]
                : []),
              ...(detail.recordTitle
                ? [
                    {
                      label: "Record",
                      value: detail.recordStatus
                        ? `${detail.recordTitle} · ${detail.recordStatus}`
                        : detail.recordTitle,
                    },
                  ]
                : []),
              ...(detail.documentTitle && detail.documentTitle !== detail.name
                ? [{ label: "Title", value: detail.documentTitle }]
                : []),
              ...(detail.summary
                ? [{ label: "Summary", value: detail.summary }]
                : []),
              ...(detail.documentDate
                ? [{ label: "Document date", value: detail.documentDate }]
                : []),
              ...(detail.language
                ? [{ label: "Language", value: detail.language }]
                : []),
              ...(detail.textStatus
                ? [
                    {
                      label: "Searchable",
                      value: detail.hasText
                        ? `Text extracted (${detail.textStatus})`
                        : `No text (${detail.textStatus})`,
                    },
                  ]
                : []),
              ...(detail.tags?.length
                ? [{ label: "Tags", value: detail.tags.join(", ") }]
                : []),
              {
                label: "Location",
                value:
                  detail.parentId === ROOT
                    ? "My Drive"
                    : pathTo(nodes, detail.parentId ?? ROOT)
                        .map((c) => c.name)
                        .join(" / ") || "My Drive",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 border-t border-line py-[9px]"
              >
                <span className="w-[84px] shrink-0 pt-px text-xs text-ink-4">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">
                  {row.value}
                </span>
              </div>
            ))}

            <div className="flex items-start gap-3 border-t border-b border-line py-[9px]">
              <span className="w-[84px] shrink-0 pt-1 text-xs text-ink-4">
                People
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                {/* Variables-based revoke (§M3): the detail sheet stays open,
                 * so the subject being removed drops out of this one list
                 * from the mutation's own `variables`/`isPending`, with
                 * nothing written to the cache. */}
                {[
                  detail.ownerId,
                  ...(detail.sharedWith ?? []).filter(
                    (id) =>
                      !(
                        unshareMutation.isPending &&
                        unshareMutation.variables?.id === detail.id &&
                        unshareMutation.variables.subjectId === id
                      )
                  ),
                ].map((id, i) => (
                  <span key={id} className="flex items-center gap-2">
                    <OwnerAvatar
                      id={id}
                      name={
                        id === detail.ownerId ? detail.ownerName : undefined
                      }
                      size={22}
                    />
                    <span className="truncate text-xs font-medium text-ink-2">
                      {id === detail.ownerId
                        ? ownerLabel(detail)
                        : (OWNERS[id]?.name ?? id)}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-ink-4">
                      {i === 0
                        ? detail.live
                          ? "Uploaded by"
                          : "Owner"
                        : "Editor"}
                    </span>
                    {/* Revoking is only offered where a share table exists. */}
                    {i > 0 && canDrive && (
                      <button
                        type="button"
                        aria-label={`Remove ${id}`}
                        onClick={() =>
                          driveWrite(`Removed ${id}`, () =>
                            unshareMutation.mutateAsync({
                              id: detail.id,
                              subjectId: id,
                            })
                          )
                        }
                        className="grid size-[22px] shrink-0 place-items-center rounded-chip text-ink-4 transition-colors hover:bg-hover-2 hover:text-ink"
                      >
                        <Icon path={paths.close} size={12} width={2.2} />
                      </button>
                    )}
                  </span>
                ))}
                {canDrive && detail.kind !== "folder" && (
                  <button
                    type="button"
                    onClick={() => {
                      setShareSubject("")
                      setSharing(detail)
                    }}
                    className="mt-0.5 inline-flex h-[26px] w-fit items-center gap-1.5 rounded-control px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                  >
                    <Icon path={paths.plus} size={13} width={2.2} />
                    Share with someone
                  </button>
                )}
              </span>
            </div>
          </div>
        )}
      </SheetShell>

      {/* new folder */}
      <SheetShell
        open={creating}
        eyebrow="New"
        title="Create a folder"
        onRequestClose={() => setCreating(false)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={sheetButton.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createFolder}
              className={sheetButton.primary}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              Create folder
            </button>
          </>
        }
      >
        <div className="px-[18px] pt-4 pb-[18px]">
          <label
            htmlFor="folder-name"
            className="flex items-baseline gap-1.5 pb-1.5 text-xs font-medium text-ink-2"
          >
            Folder name
          </label>
          <div className="flex h-[38px] w-full items-center overflow-hidden rounded-control bg-field shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[box-shadow,background-color] duration-[140ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]">
            <input
              id="folder-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="Untitled folder"
              autoComplete="off"
              className="h-full w-full px-3 text-[14px] font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
            />
          </div>
          <div className="pt-1.5 text-[11.5px] text-ink-4">
            It will be created in{" "}
            <span className="font-medium text-ink-3">
              {folder === ROOT
                ? "My Drive"
                : nodes.find((n) => n.id === folder)?.name}
            </span>
            .
          </div>
        </div>
      </SheetShell>

      {/* share */}
      <SheetShell
        open={Boolean(sharing)}
        eyebrow="Share"
        title={sharing ? displayName(sharing) : ""}
        onRequestClose={() => setSharing(null)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSharing(null)}
              className={sheetButton.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={share}
              className={sheetButton.primary}
            >
              <Icon path={paths.check} size={14} width={2.2} />
              Grant access
            </button>
          </>
        }
      >
        <div className="px-[18px] pt-4 pb-[18px]">
          <label
            htmlFor="share-subject"
            className="flex items-baseline gap-1.5 pb-1.5 text-xs font-medium text-ink-2"
          >
            Person
          </label>
          <div className="flex h-[38px] w-full items-center overflow-hidden rounded-control bg-field shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[box-shadow,background-color] duration-[140ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]">
            <input
              id="share-subject"
              value={shareSubject}
              onChange={(e) => setShareSubject(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && share()}
              placeholder="emp-ho-008"
              autoComplete="off"
              className="h-full w-full px-3 text-[14px] font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
            />
          </div>
          {/* cloud-hub has no user directory on this surface, so the grant is
              keyed on the subject id the hub itself stores. */}
          <div className="pt-1.5 text-[11.5px] text-ink-4">
            Enter the subject id the hub knows this person by. They get read
            access to this file, on top of whatever the backing record already
            allows.
          </div>
        </div>
      </SheetShell>

      <div className="fixed right-4 bottom-4 z-90 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex animate-pop items-center gap-2.5 rounded-panel bg-surface px-3.5 py-2.5 text-xs font-medium shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]"
          >
            <Icon
              path={paths.check}
              size={15}
              width={2.2}
              className="text-grass"
            />
            {t.message}
          </div>
        ))}
      </div>
    </AppShell>
  )
}
