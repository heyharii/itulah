import { useMemo, useState } from "react"
import { Link, getRouteApi } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { NavSidebar } from "@/components/dashboard/nav-sidebar"
import { KpiStrip } from "@/components/dashboard/kpi-strip"
import { RecordsTable } from "@/components/dashboard/records-table"
import { SupplierDetailSheet } from "@/components/dashboard/supplier-detail-sheet"
import { SupplierSheet } from "@/components/dashboard/supplier-sheet"
import {
  VIEWS,
  orderLeafId,
  type SectionId,
  type SortDir,
  type SortKey,
  type Supplier,
  type ViewId,
} from "@/components/dashboard/data"
import { OrdersPane } from "@/components/po/purchase-orders"
import { PO_LIFECYCLE, usePurchaseOrdersResource } from "@/components/po/api"
import { useSupplierDirectory } from "@/components/dashboard/api"
import {
  useBulkUpdateSuppliers,
  useCreateSupplier,
  useUpdateSupplier,
} from "@/components/dashboard/mutations"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@/lib/api"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

const route = getRouteApi("/buying")

interface Toast {
  id: number
  message: string
  kind: "success" | "error"
}

/** Landing on a saved view also puts you in the Suppliers section. */
function viewSearch(
  prev: { section: SectionId; expanded: SectionId[] },
  view: ViewId
) {
  return {
    view,
    section: "suppliers" as const,
    expanded: prev.expanded.includes("suppliers")
      ? prev.expanded
      : [...prev.expanded, "suppliers" as const],
  }
}

/**
 * Buying — the supplier directory and the purchase orders placed with those
 * suppliers, under one nav tree.
 *
 * They are one app because they are one set of facts: a supplier row's spend,
 * incoming quantity, lead time and "no order history" flag are all derived
 * from its orders. `section` picks which half the main pane shows; everything
 * around it — the nav, the toasts, the sound switch — is shared.
 */
export function Buying() {
  const {
    view,
    section,
    expanded,
    q,
    noHistory,
    sort,
    dir,
    open,
    orderStatus,
  } = route.useSearch()
  const navigate = route.useNavigate()

  const supplierResource = useSupplierDirectory()
  /* Same query key the orders pane uses, so the nav's counts and the list it
   * is counting are always the same fetch. */
  const orderResource = usePurchaseOrdersResource()
  const createSupplier = useCreateSupplier()
  const updateSupplier = useUpdateSupplier()
  const bulkUpdate = useBulkUpdateSuppliers()

  const rows = useMemo(
    () => supplierResource.data?.suppliers ?? [],
    [supplierResource.data?.suppliers]
  )

  const orderCounts = useMemo(() => {
    const orders = orderResource.data?.orders ?? []
    return Object.fromEntries(
      PO_LIFECYCLE.map((status) => [
        orderLeafId(status),
        orders.filter((order) => order.status === status).length,
      ])
    )
  }, [orderResource.data?.orders])

  /* Drafts, transient chrome and in-flight flags — none of it describes what
   * you are looking at, so none of it belongs in the URL. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [railHidden, setRailHidden] = useState(false)
  const [detailOpen, setDetailOpen] = useState(() => Boolean(open))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const [bulkBusy, setBulkBusy] = useState(false)

  useInteractionSounds(soundOn)

  /** Filters replace rather than stack; only opening a record is a new place. */
  const setSearch = (
    patch: Partial<{
      view: ViewId
      section: SectionId
      expanded: SectionId[]
      q: string
      noHistory: boolean
      sort: SortKey | undefined
      dir: SortDir
      open: string | undefined
    }>,
    options: { replace?: boolean } = {}
  ) =>
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: options.replace ?? true,
    })

  /* Sorting is the table's job now (see RecordsTable); this only narrows. */
  const visible = useMemo(() => {
    const current = VIEWS.find((v) => v.id === view)
    let out = rows.filter((r) => !current?.tag || r.tags.includes(current.tag))
    if (noHistory) out = out.filter((supplier) => supplier.historyEvents === 0)

    const needle = q.trim().toLowerCase()
    if (needle) {
      out = out.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.tags.some((t) => t.toLowerCase().includes(needle))
      )
    }
    return out
  }, [rows, view, noHistory, q])

  const openRow = rows.find((r) => r.id === open) ?? null

  const toast = (message: string, kind: Toast["kind"] = "success") => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    cue(kind)
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s)
      const allOn = visible.every((r) => next.has(r.id))
      visible.forEach((r) => {
        if (allOn) next.delete(r.id)
        else next.add(r.id)
      })
      return next
    })

  /** Export the currently visible live supplier rows without inventing a server route. */
  const exportRows = (exportedRows: Supplier[]) => {
    const escapeCsv = (value: unknown) => {
      const text = value == null ? "" : String(value)
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }
    const headers = ["id", "code", "name", "address", "status", "updated_at"]
    const body = exportedRows.map((row) =>
      [row.id, row.code, row.name, row.address, row.status, row.updatedAt]
        .map(escapeCsv)
        .join(",")
    )
    const blob = new Blob([[headers.join(","), ...body].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "suppliers.csv"
    anchor.click()
    URL.revokeObjectURL(url)
    toast(
      `Exported ${exportedRows.length} live supplier row${exportedRows.length === 1 ? "" : "s"}`
    )
  }

  const deactivateSelected = async () => {
    const ids = [...selected]
    if (!ids.length || bulkBusy) return
    setBulkBusy(true)
    try {
      const response = await bulkUpdate.execute({ ids, status: "inactive" })
      const record =
        response && typeof response === "object"
          ? (response as Record<string, unknown>)
          : undefined
      const affected =
        typeof record?.affected === "number" ? record.affected : ids.length
      setSelected(new Set())
      toast(`Set ${affected} supplier${affected === 1 ? "" : "s"} inactive`)
    } catch (error: unknown) {
      toast(`Supplier update failed: ${getErrorMessage(error)}`, "error")
    } finally {
      setBulkBusy(false)
    }
  }

  const saveRecord = async (record: Supplier) => {
    const wasEditing = Boolean(editing)
    const payload = {
      code:
        record.code?.trim() ||
        record.name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "-")
          .slice(0, 50),
      name: record.name.trim(),
      address: record.address?.trim() || "",
      status: (record.status === "inactive" || record.status === "blocked"
        ? record.status
        : "active") as "active" | "inactive" | "blocked",
      notes: record.notes?.trim() || undefined,
    }

    try {
      const response =
        wasEditing && editing
          ? await updateSupplier.execute({ id: editing.id, input: payload })
          : await createSupplier.execute(payload)
      const returned =
        response && typeof response === "object"
          ? (response as Record<string, unknown>)
          : undefined
      const savedId =
        typeof returned?.supplier_id === "string"
          ? returned.supplier_id
          : (editing?.id ?? record.id)
      const savedName =
        typeof returned?.name === "string" ? returned.name : payload.name
      setSheetOpen(false)
      setEditing(null)
      setSearch({ open: savedId })
      toast(`${wasEditing ? "Saved" : "Added"} ${savedName}`)
    } catch (error: unknown) {
      toast(`Supplier save failed: ${getErrorMessage(error)}`, "error")
      throw error
    }
  }

  const gridCols = railHidden
    ? "grid-cols-[0px_minmax(0,1fr)]"
    : "grid-cols-[232px_minmax(0,1fr)]"

  return (
    <AppShell label="Buying navigation" railWidth={232} cols={gridCols}>
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <NavSidebar
          rows={rows}
          section={section}
          view={view}
          expanded={expanded}
          orderStatus={orderStatus}
          orderCounts={orderCounts}
          soundOn={soundOn}
          onLeaf={(id, label) => {
            if (id === "rep-revenue") {
              void navigate({ to: "/finance" })
              return
            }
            if (id === "rep-quality" || id === "rep-coverage") {
              void navigate({ to: "/inventory" })
              return
            }
            toast(
              `${label} is not available in the Internal workspace yet`,
              "error"
            )
          }}
          onToggleSound={() => {
            const next = !soundOn
            setSoundOn(next)
            writeSoundPreference(next)
            if (next) cue("toggle")
          }}
          onCollapse={() => setRailHidden((v) => !v)}
        />
      </AppShellSidebar>

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden py-2 pr-2 max-lg:pl-2",
          railHidden && "pl-2"
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          {section === "orders" ? (
            <OrdersPane onToast={(message) => toast(message)} />
          ) : (
            <>
            {/* Band 1 — what this is, and what you can do to it. */}
            <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pr-2.5 pl-3.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <SidebarTrigger className="-ml-1 self-center" />
                <h1 className="text-sm font-semibold tracking-[-0.01em]">
                  Suppliers
                </h1>
                <span className="font-mono text-[11.5px] text-ink-4">
                  {visible.length} record{visible.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-center gap-[7px]">
                <label className="inline-flex h-[30px] items-center gap-[7px] rounded-control bg-field px-[9px] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-[130ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
                  <Icon path={paths.search} size={14} width={1.9} />
                  <input
                    value={q}
                    onChange={(e) => setSearch({ q: e.target.value })}
                    placeholder="Search…"
                    aria-label="Search suppliers"
                    className="w-[132px] text-xs font-medium placeholder:text-ink-4"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => exportRows(visible)}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover"
                >
                  <Icon path={paths.download} size={14} width={1.9} />
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null)
                    setSheetOpen(true)
                  }}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105"
                >
                  <Icon path={paths.plus} size={14} width={2.1} />
                  Add supplier
                </button>
              </div>
            </div>

            {/* Band 2 — which slice of the data you are looking at. */}
            <div className="flex h-10 shrink-0 items-center justify-between gap-2.5 border-t border-b border-t-line border-b-line-strong pr-2.5 pl-3">
              <div
                role="tablist"
                className="flex items-center gap-0.5 rounded-control bg-inset p-0.5"
              >
                {VIEWS.map((v) => {
                  const count = rows.filter(
                    (r) => !v.tag || r.tags.includes(v.tag)
                  ).length
                  const on = v.id === view
                  return (
                    <Link
                      key={v.id}
                      from="/buying"
                      to="/buying"
                      replace
                      role="tab"
                      aria-selected={on}
                      search={(prev) => ({ ...prev, ...viewSearch(prev, v.id) })}
                      className={cn(
                        "inline-flex h-[25px] items-center gap-1.5 rounded-[7px] px-[9px] text-xs font-medium transition-[background-color,color,box-shadow] duration-[130ms]",
                        on
                          ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_rgb(18_18_18/.05)]"
                          : "text-ink-3 hover:text-ink-2"
                      )}
                    >
                      {v.label}
                      <span
                        className={cn(
                          "font-mono text-[10.5px]",
                          on ? "text-ink-3" : "text-ink-4"
                        )}
                      >
                        {count}
                      </span>
                    </Link>
                  )
                })}
              </div>

              <button
                type="button"
                aria-pressed={noHistory}
                title="Only suppliers with no purchase-order or receipt history"
                onClick={() => setSearch({ noHistory: !noHistory })}
                className={cn(
                  "inline-flex h-[26px] items-center gap-1.5 rounded-control px-2 text-xs font-medium transition-colors duration-[120ms]",
                  noHistory
                    ? "bg-accent-tint text-accent-ink"
                    : "text-ink-3 hover:bg-hover hover:text-ink"
                )}
              >
                <Icon path={paths.rows} size={13} width={1.9} />
                No order history
              </button>
            </div>

            {supplierResource.isLoading && !supplierResource.data && (
              <div className="border-b border-line bg-inset px-3.5 py-2 text-[11.5px] text-ink-3">
                Loading suppliers from Internal…
              </div>
            )}
            {supplierResource.errorMessage && (
              <div className="flex items-center gap-2 border-b border-ember/20 bg-ember/5 px-3.5 py-2 text-[11.5px] text-ember">
                <span className="min-w-0 flex-1 truncate">
                  Supplier directory unavailable: {supplierResource.errorMessage}
                </span>
                <button
                  type="button"
                  onClick={() => supplierResource.reload()}
                  className="shrink-0 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}

            <KpiStrip
              rows={visible}
              noHistoryOnly={noHistory}
              onToggleNoHistory={() => setSearch({ noHistory: !noHistory })}
            />

            <RecordsTable
              rows={visible}
              selected={selected}
              openId={open ?? null}
              sortKey={sort ?? null}
              sortDir={dir}
              onSortChange={(next) =>
                setSearch({ sort: next.key ?? undefined, dir: next.dir })
              }
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              onOpenRow={(id) => {
                setDetailOpen(true)
                // a record is a genuinely new destination, so this one stacks
                setSearch({ open: id }, { replace: false })
              }}
            />

            {selected.size > 0 && (
              <div className="absolute bottom-[46px] left-1/2 z-25 flex -translate-x-1/2 animate-rise items-center gap-1.5 rounded-full bg-ink py-1.5 pr-[7px] pl-[13px] text-white shadow-[0_8px_28px_-8px_rgb(18_18_18/.45)]">
                <span className="text-xs font-semibold tabular-nums">
                  {selected.size} selected
                </span>
                <span className="h-[17px] w-px bg-white/20" />
                <BulkButton
                  onClick={() =>
                    exportRows(rows.filter((row) => selected.has(row.id)))
                  }
                  disabled={bulkBusy}
                  icon={paths.download}
                >
                  Export
                </BulkButton>
                <BulkButton
                  onClick={() => void deactivateSelected()}
                  disabled={bulkBusy}
                  icon={paths.archive}
                >
                  {bulkBusy ? "Updating…" : "Deactivate"}
                </BulkButton>
                <span className="h-[17px] w-px bg-white/20" />
                <BulkButton
                  onClick={() => setSelected(new Set())}
                  disabled={bulkBusy}
                  icon={paths.close}
                  label="Clear selection"
                />
              </div>
            )}
            </>
          )}
        </div>
      </main>

      <SupplierDetailSheet
        open={detailOpen && Boolean(open) && !sheetOpen}
        row={openRow}
        onClose={() => {
          setDetailOpen(false)
          setSearch({ open: undefined })
        }}
        onEdit={() => {
          if (!openRow) return
          setDetailOpen(false)
          setEditing(openRow)
          setSheetOpen(true)
        }}
        onOrders={() => {
          if (!openRow) return
          setDetailOpen(false)
          /* the other half of the app, already narrowed to this record */
          void navigate({
            search: (prev) => ({
              ...prev,
              section: "orders" as const,
              expanded: prev.expanded.includes("orders")
                ? prev.expanded
                : [...prev.expanded, "orders" as const],
              orderSupplier: openRow.id,
              orderStatus: undefined,
              order: undefined,
              open: undefined,
            }),
          })
        }}
      />

      <SupplierSheet
        open={sheetOpen}
        editing={editing}
        onClose={() => {
          setSheetOpen(false)
          setEditing(null)
        }}
        onSubmit={saveRecord}
      />

      <div className="fixed right-4 bottom-4 z-90 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex animate-pop items-center gap-2.5 rounded-panel bg-surface px-3.5 py-2.5 text-xs font-medium shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]"
          >
            <Icon
              path={t.kind === "error" ? paths.alert : paths.check}
              size={15}
              width={2.2}
              className={t.kind === "error" ? "text-ember" : "text-grass"}
            />
            {t.message}
          </div>
        ))}
      </div>
    </AppShell>
  )
}

function BulkButton({
  onClick,
  icon,
  children,
  label,
  disabled = false,
}: {
  onClick: () => void
  icon: React.ReactNode
  children?: React.ReactNode
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-[27px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-white/80 transition-colors duration-[120ms] hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon path={icon} size={13} width={2} />
      {children}
    </button>
  )
}
