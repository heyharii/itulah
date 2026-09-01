/* eslint-disable react-refresh/only-export-components -- this module intentionally shares view helpers with PO screens. */

import { Icon, paths } from "@/components/dashboard/parts"
import { type Product, type Supplier } from "@/components/sourcing/catalogue"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const PRODUCT_COLUMNS = "320px 190px 108px minmax(0,1fr) 124px"

export const supplierOf = (id: string, suppliers: Supplier[] = []) =>
  suppliers.find((s) => s.id === id)

export const STATUS_META: Record<
  Product["status"],
  { label: string; hue: string }
> = {
  active: { label: "In line", hue: "var(--grass)" },
  sampling: { label: "Sampling", hue: "var(--honey)" },
  paused: { label: "On hold", hue: "var(--ink-4)" },
}

const TAG_HUE: Record<string, string> = {
  womenswear: "#ff58ae",
  menswear: "#0086fc",
  sport: "#00c978",
  divided: "#7b5cfa",
  kidswear: "#ffbb26",
  solid: "#7e7e7d",
  patterned: "#7b5cfa",
  "multi-colour": "#64c6ff",
  "entry-price": "#00c978",
  premium: "#ff3e00",
}

export const money = (value: number, currency = "USD") => {
  const wholeUnit = currency.toUpperCase() === "IDR"
  return value.toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: wholeUnit ? 0 : 2,
    maximumFractionDigits: wholeUnit ? 0 : 2,
  })
}

/** Product-family price is optional in internal; zero means no price entry. */
export const productMoney = (product: Product) =>
  product.price > 0 ? money(product.price, product.currency) : "—"

export function updatedLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  const days = Math.round(minutes / (60 * 24))
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`
}

export function Tag({ name }: { name: string }) {
  return (
    <span
      style={
        { "--tag": TAG_HUE[name] ?? "var(--ink-3)" } as React.CSSProperties
      }
      className={cn(
        "inline-flex h-[21px] shrink-0 items-center rounded-[7px] border px-[6px] text-[11.5px] font-medium whitespace-nowrap",
        "border-[color-mix(in_srgb,var(--tag)_26%,var(--surface))]",
        "text-[color-mix(in_srgb,var(--tag)_62%,var(--ink))]",
        "bg-[color-mix(in_srgb,var(--tag)_13%,var(--surface))]"
      )}
    >
      {name}
    </span>
  )
}

export function StatusDot({ status }: { status: Product["status"] }) {
  const meta = STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
      <span
        style={{ background: meta.hue }}
        className="size-2 shrink-0 rounded-full"
      />
      {meta.label}
    </span>
  )
}

export function SupplierCell({
  id,
  compact,
  supplier,
  subtitle,
}: {
  id: string
  compact?: boolean
  /** Supplier resolved from the live Internal master-data response. */
  supplier?: Supplier
  /**
   * The line under the supplier's name.
   *
   * It used to render `supplier.division`, which does not exist: there is no
   * `primary_division` column on `master_suppliers`, so the mapper's fallback
   * printed the literal word "Supplier" under all eight of them. A placeholder
   * that reads like a value is worse than an empty line — it invites someone to
   * filter on a field the backend cannot supply.
   *
   * The item's own division is real (715 of 715 rows carry one), so callers
   * pass that instead. Nothing renders when there is nothing to say.
   */
  subtitle?: string
}) {
  const resolvedSupplier = supplier ?? supplierOf(id)
  if (!resolvedSupplier) return null

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        style={{ background: resolvedSupplier.hue }}
        className={cn(
          "grid shrink-0 place-items-center rounded-chip font-semibold text-white uppercase",
          compact ? "size-[18px] text-[9px]" : "size-[22px] text-[10px]"
        )}
      >
        {resolvedSupplier.name[0]}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink">
          {resolvedSupplier.name}
        </span>
        {subtitle && (
          <span className="block truncate text-[11px] text-ink-4">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  )
}

/** A product photo, with the colourway swatches it also ships in. */
export function Thumb({
  product,
  colorwayId,
  className,
}: {
  product: Product
  colorwayId?: string
  className?: string
}) {
  const cw =
    product.colorways.find((c) => c.id === colorwayId) ?? product.colorways[0]
  if (!cw?.image) {
    return (
      <span
        aria-label={`${product.name} image unavailable`}
        className={cn(
          "grid shrink-0 place-items-center bg-inset text-[10px] text-ink-4",
          className
        )}
      >
        No image
      </span>
    )
  }
  return (
    <img
      src={cw.image}
      alt={product.name}
      loading="lazy"
      className={cn("shrink-0 bg-inset object-cover", className)}
    />
  )
}

export function ColorwayDots({
  product,
  activeId,
  onPick,
}: {
  product: Product
  activeId?: string
  onPick?: (id: string) => void
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {product.colorways.map((c) => {
        const on = c.id === (activeId ?? product.colorways[0].id)
        const Tag = onPick ? "button" : "span"
        return (
          <Tag
            key={c.id}
            {...(onPick
              ? { type: "button" as const, onClick: () => onPick(c.id) }
              : {})}
            className={cn(
              "size-5 overflow-hidden rounded-chip ring-1 transition-[box-shadow,transform] duration-[130ms]",
              on ? "ring-2 ring-accent" : "ring-line-strong",
              onPick && "hover:scale-105"
            )}
          >
            {c.image ? (
              <img
                src={c.image}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              <span className="grid size-full place-items-center text-[8px] text-ink-4">
                —
              </span>
            )}
          </Tag>
        )
      })}
    </span>
  )
}

/**
 * The heading a staged group gets. A purchase order goes to exactly one
 * supplier, so the supplier is the unit the staged view is grouped by and the
 * unit the Draft PO button acts on — the button belongs on this header and
 * nowhere else.
 */
export function StagedGroupHeader({
  supplierId,
  supplier,
  products,
  onDraft,
}: {
  supplierId: string
  supplier?: Supplier
  products: Product[]
  onDraft: () => void
}) {
  const atMoq = products.reduce(
    (sum, product) => sum + product.price * product.moq,
    0
  )
  const priced = products.some(
    (product) => product.moq > 0 && product.price > 0
  )

  return (
    <div className="flex items-center gap-3 border-b border-line bg-inset px-3.5 py-2.5">
      <SupplierCell id={supplierId} supplier={supplier} />
      <span className="font-mono text-[11px] text-ink-4">
        {products.length} style{products.length === 1 ? "" : "s"} ·{" "}
        {priced
          ? `${money(atMoq, products[0]?.currency)} at MOQ`
          : "cost/MOQ unavailable"}
      </span>
      <button
        type="button"
        onClick={onDraft}
        className="ml-auto inline-flex h-[28px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] hover:brightness-105"
      >
        <Icon path={paths.doc} size={13} width={2} />
        Draft PO for {supplier?.name ?? "this supplier"}
      </button>
    </div>
  )
}

interface ViewProps {
  products: Product[]
  suppliers?: Supplier[]
  selected: Set<string>
  shortlisted: (id: string) => boolean
  shortlistEnabled?: boolean
  shortlistBusyId?: string | null
  onToggle: (id: string) => void
  onToggleAll: () => void
  onOpen: (product: Product) => void
  onShortlist: (id: string) => void
}

function Check({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label
      title={label}
      onClick={(e) => e.stopPropagation()}
      className="group/check relative inline-flex size-[22px] shrink-0 items-center justify-center"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="absolute size-px opacity-0"
      />
      <span
        className={cn(
          "inline-flex size-[17px] items-center justify-center rounded-[5px] border bg-surface transition-[border-color,background-color,transform] duration-[140ms] ease-spring",
          "group-hover/check:border-ink-4 group-active/check:scale-[0.94]",
          checked
            ? "border-accent bg-accent text-white"
            : "border-line-strong text-transparent"
        )}
      >
        {checked && <Icon path={paths.check} size={10} width={3.2} />}
      </span>
    </label>
  )
}

function ShortlistButton({
  on,
  onClick,
  floating,
  disabled,
}: {
  on: boolean
  onClick: () => void
  floating?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from shortlist" : "Add to shortlist"}
      title={
        disabled
          ? "Shortlist API belum tersedia"
          : on
            ? "Remove from shortlist"
            : "Add to shortlist"
      }
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-chip transition-colors duration-[120ms]",
        floating && "bg-surface/90 shadow-[0_0_0_1px_var(--line)]",
        disabled
          ? "cursor-not-allowed text-ink-4/50"
          : on
            ? "text-honey"
            : "text-ink-4 hover:bg-hover-2 hover:text-ink-2"
      )}
    >
      <Icon path={paths.star} size={14} width={1.9} />
    </button>
  )
}

export function ProductTable({
  products,
  suppliers,
  selected,
  shortlisted,
  shortlistEnabled = true,
  shortlistBusyId,
  onToggle,
  onToggleAll,
  onOpen,
  onShortlist,
}: ViewProps) {
  const vrule =
    "border-r border-r-[color-mix(in_srgb,var(--line)_78%,transparent)]"
  const allOn = products.length > 0 && products.every((p) => selected.has(p.id))

  return (
    <VirtualRows
      rows={products}
      rowKey={(product) => product.id}
      columns={PRODUCT_COLUMNS}
      rowHeight={64}
      className="min-w-[940px]"
      /* The row is not a click target as a whole — the checkbox, the thumbnail
       * and the name each handle their own click — but the original `<tr>`
       * washed the whole row on hover, so ask for the wash without claiming
       * the click. Both washes go on the row: cells are `items-center` grid
       * items, only as tall as their own content, so tinting them paints
       * ragged disconnected blocks rather than one row. */
      hoverable
      rowClassName={(product) =>
        cn(
          "transition-colors duration-[120ms]",
          selected.has(product.id) &&
            "bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]"
        )
      }
      header={
        <>
          <span className={cn("pl-3.5", vrule)}>
            <span className="flex items-center gap-2.5">
              <Check
                checked={allOn}
                label="Select all products"
                onChange={onToggleAll}
              />
              Product
            </span>
          </span>
          <span className={cn("px-3", vrule)}>Supplier</span>
          <span className={cn("px-3 text-right", vrule)}>Price</span>
          <span className={cn("px-3", vrule)}>Tags</span>
          <span className="pr-3.5 pl-3">Status</span>
        </>
      }
      renderRow={(product) => {
        const on = selected.has(product.id)
        return (
          <>
            <span
              role="gridcell"
              className={cn("py-1.5 pr-3 pl-3.5", vrule)}
            >
              <span className="flex items-center gap-2.5">
                <Check
                  checked={on}
                  label={`Select ${product.name}`}
                  onChange={() => onToggle(product.id)}
                />
                <button
                  type="button"
                  onClick={() => onOpen(product)}
                  aria-label={`Open ${product.name}`}
                >
                  <Thumb
                    product={product}
                    className="h-[52px] w-[40px] rounded-chip"
                  />
                </button>
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onOpen(product)}
                    className="block w-full truncate text-left text-[13px] font-medium text-ink hover:underline hover:decoration-[color-mix(in_srgb,currentColor_35%,transparent)] hover:underline-offset-[3px]"
                  >
                    {product.name}
                  </button>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {product.sku}
                  </span>
                  <span className="flex pt-1"></span>
                </span>
                <ShortlistButton
                  on={shortlisted(product.id)}
                  onClick={() => onShortlist(product.id)}
                  disabled={!shortlistEnabled || shortlistBusyId === product.id}
                />
              </span>
            </span>

            <span role="gridcell" className={cn("px-3", vrule)}>
              <SupplierCell
                id={product.supplierId}
                supplier={supplierOf(product.supplierId, suppliers)}
                subtitle={product.category}
              />
            </span>

            <span
              role="gridcell"
              className={cn("px-3 text-right", vrule)}
            >
              <span className="block font-mono text-[13px] font-medium text-ink tabular-nums">
                {productMoney(product)}
              </span>
              <span className="block font-mono text-[10.5px] text-ink-4 tabular-nums">
                MOQ {product.moq > 0 ? product.moq : "—"}
              </span>
            </span>

            <span role="gridcell" className={cn("px-3", vrule)}>
              <span className="flex flex-wrap items-center gap-1">
                {product.tags.map((t) => (
                  <Tag key={t} name={t} />
                ))}
              </span>
            </span>

            <span role="gridcell" className="pr-3.5 pl-3">
              <StatusDot status={product.status} />
              <span className="block pt-0.5 font-mono text-[10.5px] text-ink-4">
                {product.leadTime > 0
                  ? `${product.leadTime}d lead`
                  : "Lead time —"}
              </span>
            </span>
          </>
        )
      }}
    />
  )
}

export function ProductGrid({
  products,
  suppliers,
  selected,
  shortlisted,
  shortlistEnabled = true,
  shortlistBusyId,
  onToggle,
  onOpen,
  onShortlist,
}: ViewProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3 p-3.5">
      {products.map((product) => {
        const on = selected.has(product.id)
        return (
          <div
            key={product.id}
            className={cn(
              "group/card relative flex flex-col overflow-hidden rounded-panel border bg-surface transition-[border-color,box-shadow] duration-[130ms]",
              on
                ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
                : "border-line-strong hover:shadow-card"
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(product)}
              aria-label={`Open ${product.name}`}
              className="relative block aspect-[3/4] w-full overflow-hidden bg-inset"
            >
              <Thumb
                product={product}
                className="size-full transition-transform duration-[400ms] ease-out-strong group-hover/card:scale-[1.03]"
              />
              <span className="absolute top-2 left-2 rounded-chip bg-surface/90 px-1.5 py-0.5 font-mono text-[10px] text-ink-2 shadow-[0_0_0_1px_var(--line)]">
                {product.sku}
              </span>
            </button>

            <span className="absolute top-2 right-2 flex items-center gap-1">
              <ShortlistButton
                floating
                on={shortlisted(product.id)}
                onClick={() => onShortlist(product.id)}
                disabled={!shortlistEnabled || shortlistBusyId === product.id}
              />
              <span className="rounded-chip bg-surface/90 p-0.5 opacity-0 shadow-[0_0_0_1px_var(--line)] transition-opacity group-hover/card:opacity-100 has-[:checked]:opacity-100">
                <Check
                  checked={on}
                  label={`Select ${product.name}`}
                  onChange={() => onToggle(product.id)}
                />
              </span>
            </span>

            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(product)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ink"
                >
                  {product.name}
                </button>
                <span className="shrink-0 font-mono text-[13px] font-medium text-ink tabular-nums">
                  {productMoney(product)}
                </span>
              </div>

              <div className="border-t border-line pt-2">
                <SupplierCell
                  id={product.supplierId}
                  supplier={supplierOf(product.supplierId, suppliers)}
                  subtitle={product.category}
                  compact
                />
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {product.tags.slice(0, 3).map((t) => (
                  <Tag key={t} name={t} />
                ))}
              </div>

              <div className="mt-auto flex items-center gap-2 border-t border-line pt-2 text-[10.5px]">
                <StatusDot status={product.status} />
                <span className="ml-auto font-mono text-ink-4">
                  MOQ {product.moq > 0 ? product.moq : "—"} ·{" "}
                  {product.leadTime > 0 ? `${product.leadTime}d` : "lead —"}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
