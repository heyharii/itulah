import { Icon, Tag, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { type Supplier } from "@/components/dashboard/data"

/** A stat tile, echoing the KPI strip so the two read as one system. */
function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <span className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
        {icon}
        {label}
      </span>
      <span className="truncate text-[13px] font-semibold text-ink">
        {value}
      </span>
      {hint && <span className="truncate text-[11px] text-ink-4">{hint}</span>}
    </div>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-line px-[18px] py-4">
      <div className="pb-2.5 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        {label}
      </div>
      {children}
    </div>
  )
}

function count(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString("id-ID")
}

function rupiah(value: number | undefined) {
  return value === undefined
    ? "—"
    : `Rp ${Math.round(value).toLocaleString("id-ID")}`
}

function statusLabel(status: string | undefined) {
  if (!status) return "Unknown"
  return status[0].toUpperCase() + status.slice(1)
}

export function SupplierDetailSheet({
  open,
  row,
  onClose,
  onEdit,
  onOrders,
}: {
  open: boolean
  row: Supplier | null
  onClose: () => void
  onEdit: () => void
  /** Cross to the other half of Buying: this supplier's purchase orders. */
  onOrders: () => void
}) {
  return (
    <SheetShell
      open={open}
      eyebrow="Supplier"
      title={row?.name.split(" — ")[0] ?? ""}
      onRequestClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className={sheetButton.secondary}
          >
            Close
          </button>
          <button
            type="button"
            onClick={onOrders}
            className={sheetButton.secondary}
          >
            <Icon path={paths.bag} size={14} width={2} />
            Purchase orders
          </button>
          <button
            type="button"
            onClick={onEdit}
            className={sheetButton.primary}
          >
            <Icon path={paths.edit} size={14} width={2} />
            Edit supplier
          </button>
        </>
      }
    >
      {!row ? null : (
        <>
          <div className="flex items-center gap-3 px-[18px] pt-4 pb-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-panel bg-inset text-base font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]">
              {row.name[0]}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm leading-[1.35] font-semibold">
                {row.name}
              </div>
              {row.site ? (
                <a
                  href={`https://${row.site}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 overflow-hidden text-xs text-accent-ink underline decoration-[color-mix(in_srgb,currentColor_32%,transparent)] underline-offset-[3px] transition-colors hover:text-ink hover:decoration-current"
                >
                  <span className="truncate">{row.site}</span>
                  <Icon
                    path={paths.external}
                    size={11}
                    width={2}
                    className="shrink-0"
                  />
                </a>
              ) : (
                <span className="text-xs text-ink-4">No website on file</span>
              )}
            </div>
          </div>

          {/* These are the fields owned by Internal's supplier projection. */}
          <div className="grid grid-cols-2 gap-2 px-[18px] pb-4">
            <Stat
              label="Status"
              icon={<Icon path={paths.healthy} size={12} width={2} />}
              value={statusLabel(row.status)}
              hint="Internal masterdata"
            />
            <Stat
              label="History"
              icon={<Icon path={paths.rows} size={12} width={2} />}
              value={count(row.historyEvents)}
              hint="PO + receipt events"
            />
            <Stat
              label="Lifetime spend"
              icon={<Icon path={paths.chart} size={12} width={2} />}
              value={rupiah(row.totalSpend)}
              hint="Purchase orders"
            />
            <Stat
              label="Incoming"
              icon={<Icon path={paths.download} size={12} width={2} />}
              value={count(row.incomingQty)}
              hint="Units on active POs"
            />
          </div>

          <Section label="Categories">
            {row.tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {row.tags.map((tag) => (
                  <Tag key={tag} name={tag} className="max-w-none" />
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-4">
                No category enrichment is available for this supplier.
              </p>
            )}
          </Section>

          <Section label="Supply metrics">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Stock on hand"
                icon={<Icon path={paths.rows} size={12} width={2} />}
                value={count(row.totalStock)}
                hint="Units across sourced SKUs"
              />
              <Stat
                label="Units sold"
                icon={<Icon path={paths.chart} size={12} width={2} />}
                value={count(row.unitsSold)}
                hint="Lifetime, excluding returns"
              />
              <Stat
                label="Articles"
                icon={<Icon path={paths.tag} size={12} width={2} />}
                value={count(row.totalArticles)}
                hint="Distinct sourced SKUs"
              />
              <Stat
                label="Avg lead time"
                icon={<Icon path={paths.clock} size={12} width={2} />}
                value={
                  row.avgLeadTimeDays == null
                    ? "—"
                    : `${row.avgLeadTimeDays.toLocaleString("id-ID")}d`
                }
                hint={
                  row.avgLeadTimeDays == null
                    ? "No completed receipt history"
                    : "Receipt minus order date"
                }
              />
            </div>
          </Section>

          <Section label="Relationship data">
            <p className="rounded-panel bg-inset px-3 py-3 text-xs leading-[1.5] text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
              Contact recency and relationship strength are not part of
              Internal's supplier contract, so this view does not infer them
              from record edits.
            </p>
          </Section>

          <Section label="Masterdata">
            <div className="space-y-2 text-xs">
              <div className="flex gap-3">
                <span className="w-24 shrink-0 text-ink-4">Code</span>
                <span className="font-mono text-ink-2">{row.code ?? "—"}</span>
              </div>
              <div className="flex gap-3">
                <span className="w-24 shrink-0 text-ink-4">Status</span>
                <span className="text-ink-2 capitalize">
                  {row.status ?? "—"}
                </span>
              </div>
              <div className="flex gap-3">
                <span className="w-24 shrink-0 text-ink-4">Address</span>
                <span className="min-w-0 text-ink-2">{row.address || "—"}</span>
              </div>
            </div>
          </Section>

          {row.notes && (
            <Section label="Internal note">
              <p className="text-xs leading-[1.55] text-ink-2">{row.notes}</p>
            </Section>
          )}
        </>
      )}
    </SheetShell>
  )
}
