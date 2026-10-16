import { Menu } from "@base-ui/react/menu"
import { Switch } from "@base-ui/react/switch"
import { Check, ChevronsUpDown, Plus, Search, X } from "lucide-react"
import { useState } from "react"

import { BottomSheet } from "@/components/ui/picker-sheet"
import { count, label } from "@/lib/format"
import { cn } from "@/lib/utils"
import { swatchBackground } from "@/lib/variants"
import {
  DEALS,
  filterCount,
  type Deal,
  type Facets,
  type Filters,
} from "@/screens/catalogue-model"

/// What narrows the Catalogue, drawn once and shown in two places: docked at
/// the right of a desk (`FilterPanel`), and as the dock's Filter sheet on a
/// phone (`FilterSheet`), where the division is the dock's own status chip
/// and so is not repeated here.
///
/// Every list that can run long — divisions, colours — shows its six
/// commonest and a "Show all": a shop with forty divisions sees the ones it
/// sells most of, and the rest is one press away, with a search over them
/// once there are more than a glance can take in. Whatever is chosen stays in
/// sight when the list is folded.

export function FilterSections({
  facets,
  filters,
  onChange,
  withDivision,
  stockKnown,
}: {
  facets: Facets
  filters: Filters
  onChange: (next: Filters) => void
  /// Draw the division list — off where the dock's status chip has it.
  withDivision: boolean
  /// The shop's stock has arrived: until it has, nothing is known to be sold
  /// out and the switch has nothing to hide.
  stockKnown: boolean
}) {
  const toggle = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value)
      ? list.filter((one) => one !== value)
      : [...list, value]
  const deals = DEALS.filter(
    ([deal]) =>
      (facets.deals.get(deal) ?? 0) > 0 || filters.deals.includes(deal),
  )

  return (
    <div className="flex flex-col">
      <SoldOutSwitch
        facets={facets}
        filters={filters}
        onChange={onChange}
        stockKnown={stockKnown}
      />

      {deals.length > 0 && (
        <Section
          title="Deals"
          onClear={
            filters.deals.length > 0
              ? () => onChange({ ...filters, deals: [] })
              : undefined
          }
        >
          {deals.map(([deal, name]) => (
            <ChoiceRow
              key={deal}
              on={filters.deals.includes(deal)}
              onClick={() =>
                onChange({
                  ...filters,
                  deals: toggle<Deal>(filters.deals, deal),
                })
              }
              count={facets.deals.get(deal) ?? 0}
            >
              {name}
            </ChoiceRow>
          ))}
        </Section>
      )}

      {withDivision && facets.divisions.length > 0 && (
        <Section
          title="Division"
          onClear={
            filters.division !== undefined
              ? () => onChange({ ...filters, division: undefined })
              : undefined
          }
        >
          <ChoiceRow
            on={filters.division === undefined}
            onClick={() => onChange({ ...filters, division: undefined })}
            count={facets.everything}
          >
            Everything
          </ChoiceRow>
          <MoreList
            items={facets.divisions}
            keyOf={([code]) => code}
            textOf={([code]) => `${code} ${label(code)}`}
            chosen={(one) => one[0] === filters.division}
            noun="divisions"
            render={([code, howMany]) => (
              <ChoiceRow
                key={code}
                on={filters.division === code}
                onClick={() =>
                  onChange({
                    ...filters,
                    division: filters.division === code ? undefined : code,
                  })
                }
                count={howMany}
              >
                {label(code)}
              </ChoiceRow>
            )}
          />
        </Section>
      )}

      {facets.colours.length > 0 && (
        <Section
          title="Colour"
          onClear={
            filters.colours.length > 0
              ? () => onChange({ ...filters, colours: [] })
              : undefined
          }
        >
          <MoreList
            items={facets.colours}
            keyOf={(one) => one.key}
            textOf={(one) => one.label}
            chosen={(one) => filters.colours.includes(one.key)}
            noun="colours"
            render={(one) => (
              <ChoiceRow
                key={one.key}
                on={filters.colours.includes(one.key)}
                onClick={() =>
                  onChange({
                    ...filters,
                    colours: toggle(filters.colours, one.key),
                  })
                }
                count={one.count}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    style={{ background: swatchBackground(one.paint) }}
                    className="size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"
                  />
                  <span className="truncate">{one.label}</span>
                </span>
              </ChoiceRow>
            )}
          />
        </Section>
      )}

      {facets.sizes.length > 0 && (
        <Section
          title="Size"
          onClear={
            filters.sizes.length > 0
              ? () => onChange({ ...filters, sizes: [] })
              : undefined
          }
        >
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {facets.sizes.map(([size, howMany]) => {
              const on = filters.sizes.includes(size)
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({ ...filters, sizes: toggle(filters.sizes, size) })
                  }
                  className={cn(
                    "inline-flex h-9 min-w-11 items-center justify-center rounded-inner border px-2.5 text-[0.875rem] font-medium transition-colors duration-(--t-hover) pointer-coarse:h-11",
                    on
                      ? "border-accent bg-accent text-on-dark"
                      : howMany === 0
                        ? "border-hairline text-mute"
                        : "border-hairline-2 bg-canvas text-ink hover:border-hairline-strong",
                  )}
                >
                  {size}
                </button>
              )
            })}
          </div>
        </Section>
      )}

      {facets.tags.length > 0 && (
        <TagPicker
          tags={facets.tags}
          chosen={filters.tags}
          onChange={(tags) => onChange({ ...filters, tags })}
        />
      )}
    </div>
  )
}

/// The Filter sheet — a phone's dock opens it, and so does an upright tablet's
/// toolbar where the panel has no room: the same sections as the desk's panel,
/// with "Clear" at the head while anything is on.
export function FilterSheet({
  open,
  onOpenChange,
  ...sections
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
} & React.ComponentProps<typeof FilterSections>) {
  const on = filterCount(sections.filters)
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filter"
      action={
        on > 0 ? (
          <button
            type="button"
            onClick={() =>
              sections.onChange({
                ...sections.filters,
                colours: [],
                sizes: [],
                deals: [],
                tags: [],
                soldOut: true,
              })
            }
            className="min-h-tap px-1 text-[0.9375rem] font-medium text-accent"
          >
            Clear
          </button>
        ) : undefined
      }
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-5">
        <FilterSections {...sections} />
      </div>
    </BottomSheet>
  )
}

function Section({
  title,
  onClear,
  children,
}: {
  title: string
  onClear?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="mt-2 flex flex-col gap-1 border-t border-hairline pt-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h4 className="text-[0.9375rem] font-medium text-body">{title}</h4>
        {onClear !== undefined && (
          <button
            type="button"
            onClick={onClear}
            className="text-[0.875rem] font-medium text-body transition-colors hover:text-ink pointer-coarse:min-h-tap"
          >
            Clear
          </button>
        )}
      </div>
      <div className="-mx-1 flex flex-col gap-px">{children}</div>
    </section>
  )
}

/// One choice in a list. Chosen is the panel's own grammar — the accent's
/// wash and the heavier weight — the same as a screen's row in the light
/// sidebar.
function ChoiceRow({
  on,
  onClick,
  count: howMany,
  children,
}: {
  on: boolean
  onClick: () => void
  count: number | undefined
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-9 w-full items-center gap-2 rounded-inner px-2.5 text-left text-[0.875rem] transition-colors pointer-coarse:min-h-tap",
        on
          ? "bg-accent-bg font-medium text-accent"
          : "text-body hover:bg-soft-2 hover:text-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="shrink-0 font-normal text-mute tabular-nums">
        {count(howMany)}
      </span>
    </button>
  )
}

/// The first six of a long list, and the rest behind "Show all". Unfolded
/// past ten, a search narrows it — forty divisions are not read, they are
/// looked for.
function MoreList<T>({
  items,
  keyOf,
  textOf,
  chosen,
  render,
  noun,
}: {
  items: readonly T[]
  keyOf: (item: T) => string
  textOf: (item: T) => string
  chosen: (item: T) => boolean
  render: (item: T) => React.ReactNode
  /// "divisions": said on the button.
  noun: string
}) {
  const [all, setAll] = useState(false)
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()
  const first = items.slice(0, FOLD)
  const shown = all
    ? items.filter(
        (item) => needle === "" || textOf(item).toLowerCase().includes(needle),
      )
    : // What is chosen stays in sight when the list is folded.
      [
        ...first,
        ...items.filter(
          (item) =>
            chosen(item) && !first.some((one) => keyOf(one) === keyOf(item)),
        ),
      ]
  return (
    <>
      {all && items.length > SEARCH_FROM && (
        <label className="relative my-1 block px-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            className="h-9 w-full rounded-inner bg-soft-2 pr-2.5 pl-8 text-[0.875rem] text-ink outline-none placeholder:text-mute pointer-coarse:h-11"
          />
        </label>
      )}
      {shown.map(render)}
      {all && shown.length === 0 && (
        <span className="px-2.5 py-1.5 text-[0.875rem] text-mute">
          No match
        </span>
      )}
      {items.length > FOLD && (
        <button
          type="button"
          onClick={() => {
            setAll((was) => !was)
            setTyped("")
          }}
          className="flex min-h-9 items-center px-2.5 text-left text-[0.875rem] font-medium text-accent pointer-coarse:min-h-tap"
        >
          {all ? "Show fewer" : `Show all ${count(items.length)}`}
        </button>
      )}
    </>
  )
}

const FOLD = 6
const SEARCH_FROM = 10

/// Tags, without listing them all: the ones in use as removable chips, and a
/// "+ Tags" button that opens a search over the rest. A range can carry
/// hundreds of tags, so the list only ever shows what matches what is typed.
function TagPicker({
  tags,
  chosen,
  onChange,
}: {
  tags: readonly (readonly [string, number])[]
  chosen: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()
  const matches = tags
    .filter(
      ([tag]) =>
        !chosen.includes(tag) &&
        (needle === "" ||
          `${tag} ${label(tag)}`.toLowerCase().includes(needle)),
    )
    .slice(0, 6)
  const add = (tag: string) => {
    onChange([...chosen, tag])
    setTyped("")
  }

  return (
    <section className="mt-2 flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h4 className="text-[0.9375rem] font-medium text-body">Tags</h4>
        {chosen.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[0.875rem] font-medium text-body transition-colors hover:text-ink pointer-coarse:min-h-tap"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chosen.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(chosen.filter((one) => one !== tag))}
            aria-label={`Remove ${label(tag)}`}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-[0.875rem] font-medium text-on-dark pointer-coarse:h-10"
          >
            {label(tag)}
            <X className="size-3.5" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-hairline-2 px-3 text-[0.875rem] font-medium text-body transition-colors hover:text-ink pointer-coarse:h-10"
        >
          <Plus className="size-3.5" />
          Tags
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 rounded-inner border border-hairline p-1.5">
          <input
            autoFocus
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false)
              if (event.key === "Enter" && matches[0] !== undefined)
                add(matches[0][0])
            }}
            placeholder="Search tags"
            aria-label="Search tags"
            className="h-9 w-full rounded-inner bg-soft-2 px-2.5 text-[0.875rem] text-ink outline-none placeholder:text-mute pointer-coarse:h-11"
          />
          {matches.length === 0 ? (
            <span className="px-2 py-1.5 text-[0.875rem] text-mute">
              No tag matches
            </span>
          ) : (
            matches.map(([tag, howMany]) => (
              <button
                key={tag}
                type="button"
                onClick={() => add(tag)}
                className="flex min-h-9 items-center justify-between gap-2 rounded-inner px-2 text-left text-[0.875rem] text-body transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap"
              >
                <span className="truncate">{label(tag)}</span>
                <span className="text-mute tabular-nums">{count(howMany)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  )
}

/// The filters docked at the right of a wide screen — the hub's
/// `DockedFilters` (`frontend-hub/src/components/ui/list-chrome.tsx`), the
/// panel Procurement's Sourcing narrows its catalogue with, drawn on the
/// shop's data.
///
/// Its anatomy, as the hub has it: a few figures about the list as it stands
/// (uppercase terms over 14px figures), the view's own switch, then "Filter
/// by" and one 38px box per question. A box says its question until it is
/// answered and then the answer — one value, or "2 chosen" — on the accent's
/// wash with an × that drops it. It opens a menu of the values with their
/// counts, ticked where chosen, a swatch beside each colour, and a search over
/// them once there are more than eight: forty divisions are looked for, not
/// read.
///
/// Only where the page is wide enough to dock it. Narrower, the same filters
/// are `FilterSheet`, which lists them out for a thumb.
export function FilterDock({
  facets,
  filters,
  onChange,
  stockKnown,
  figures,
  className,
}: {
  facets: Facets
  filters: Filters
  onChange: (next: Filters) => void
  stockKnown: boolean
  /// What is on the glass: articles, SKUs, pieces.
  figures: readonly { readonly label: string; readonly value: string }[]
  className?: string
}) {
  const on =
    filters.colours.length +
    filters.sizes.length +
    filters.deals.length +
    filters.tags.length +
    (filters.division === undefined ? 0 : 1)
  const fields: readonly DockField[] = [
    {
      id: "deal",
      label: "Deals",
      multiple: true,
      chosen: filters.deals,
      options: DEALS.filter(
        ([deal]) =>
          (facets.deals.get(deal) ?? 0) > 0 || filters.deals.includes(deal),
      ).map(([deal, name]) => ({
        value: deal,
        label: name,
        count: facets.deals.get(deal) ?? 0,
      })),
      onChange: (next) => onChange({ ...filters, deals: next as Deal[] }),
    },
    {
      id: "division",
      label: "Division",
      multiple: false,
      chosen: filters.division === undefined ? [] : [filters.division],
      options: facets.divisions.map(([code, howMany]) => ({
        value: code,
        label: label(code),
        count: howMany,
      })),
      onChange: (next) => onChange({ ...filters, division: next[0] }),
    },
    {
      id: "colour",
      label: "Colour",
      multiple: true,
      chosen: filters.colours,
      options: facets.colours.map((one) => ({
        value: one.key,
        label: one.label,
        count: one.count,
        leading: (
          <span
            aria-hidden
            style={{ background: swatchBackground(one.paint) }}
            className="size-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"
          />
        ),
      })),
      onChange: (next) => onChange({ ...filters, colours: next }),
    },
    {
      id: "size",
      label: "Size",
      multiple: true,
      chosen: filters.sizes,
      options: facets.sizes.map(([size, howMany]) => ({
        value: size,
        label: size,
        count: howMany,
      })),
      onChange: (next) => onChange({ ...filters, sizes: next }),
    },
    {
      id: "tag",
      label: "Tags",
      multiple: true,
      chosen: filters.tags,
      options: facets.tags.map(([tag, howMany]) => ({
        value: tag,
        label: label(tag),
        count: howMany,
      })),
      onChange: (next) => onChange({ ...filters, tags: next }),
    },
  ]

  return (
    <aside
      aria-label="Filters"
      className={cn(
        "sticky top-5 flex-col gap-2.5 self-start rounded-card border border-hairline bg-canvas p-4",
        className,
      )}
    >
      {/* The page's own strip carries the figures now; a caller that still
          hands some in gets them here. */}
      {figures.length > 0 && (
        <dl className="-mx-1 mb-1 grid grid-cols-2 gap-x-3 gap-y-2 border-b border-hairline px-1 pb-3">
          {figures.map((figure) => (
            <div key={figure.label} className="min-w-0">
              <dt className="truncate text-[0.875rem] font-medium tracking-[0.04em] text-mute uppercase">
                {figure.label}
              </dt>
              <dd className="truncate text-[0.875rem] font-semibold text-ink tabular-nums">
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="-mx-1 border-b border-hairline px-1 pb-3">
        <SoldOutSwitch
          facets={facets}
          filters={filters}
          onChange={onChange}
          stockKnown={stockKnown}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.875rem] font-medium text-body">Filter by</h4>
        {on > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...filters,
                division: undefined,
                colours: [],
                sizes: [],
                deals: [],
                tags: [],
              })
            }
            className="text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
          >
            Clear {count(on)}
          </button>
        )}
      </div>

      {fields
        .filter((field) => field.options.length > 0 || field.chosen.length > 0)
        .map((field) => (
          <DockRow key={field.id} field={field} />
        ))}
    </aside>
  )
}

interface DockField {
  readonly id: string
  readonly label: string
  /// Several values at once (colours, sizes), or one (the division).
  readonly multiple: boolean
  readonly chosen: readonly string[]
  readonly options: readonly {
    readonly value: string
    readonly label: string
    readonly count: number
    readonly leading?: React.ReactNode
  }[]
  readonly onChange: (next: string[]) => void
}

/// The hub's filter-column box (`ROW` in its list chrome).
const ROW =
  "flex h-[2.375rem] w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-3 text-left text-[0.875rem] transition-colors hover:border-hairline-strong"

/// One question as the hub's panel asks it: the box, and its menu.
function DockRow({ field }: { field: DockField }) {
  const [needle, setNeedle] = useState("")
  const typed = needle.trim().toLowerCase()
  const shortlist =
    typed === ""
      ? field.options
      : field.options.filter((one) => one.label.toLowerCase().includes(typed))
  const first = field.options.find((one) => one.value === field.chosen[0])
  const shown =
    field.chosen.length === 0
      ? null
      : field.chosen.length === 1
        ? (first?.label ?? field.chosen[0])
        : `${count(field.chosen.length)} chosen`

  return (
    <Menu.Root onOpenChange={(open) => !open && setNeedle("")}>
      <Menu.Trigger
        className={cn(
          ROW,
          "justify-between",
          shown !== null
            ? "border-accent/40 bg-accent-bg text-accent"
            : "text-body",
        )}
      >
        <span className="truncate">{shown ?? field.label}</span>
        {shown !== null ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Clear ${field.label}`}
            onClick={(event) => {
              event.stopPropagation()
              field.onChange([])
            }}
            className="grid size-4 shrink-0 place-items-center rounded-full text-accent"
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-line-ico" />
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50"
        >
          {/* Grows from its box, 160ms on the strong ease-out — the hub's
              `POP_MOTION`. Reduced motion keeps the fade. */}
          <Menu.Popup className="flex max-h-80 min-w-[15rem] origin-(--transform-origin) flex-col rounded-card border border-hairline bg-canvas p-1.5 shadow-pop transition-[opacity,scale] duration-(--t-pop) ease-(--ease-out) outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
            {field.options.length > 8 && (
              <div className="mb-1 flex items-center gap-2 border-b border-hairline px-2 pb-1.5">
                <Search className="size-3.5 shrink-0 text-line-ico" />
                <input
                  autoFocus
                  value={needle}
                  onChange={(event) => setNeedle(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={`Search ${field.label.toLowerCase()}`}
                  aria-label={`Search ${field.label}`}
                  className="min-w-0 flex-1 bg-transparent py-1 text-[0.875rem] text-ink outline-none placeholder:text-mute"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {shortlist.length === 0 && (
                <p className="px-2 py-3 text-[0.875rem] text-mute">
                  No {field.label.toLowerCase()} like that.
                </p>
              )}
              {shortlist.map((option) => {
                const ticked = field.chosen.includes(option.value)
                return (
                  <Menu.Item
                    key={option.value}
                    // Several colours are chosen in one visit to the menu;
                    // one division closes it.
                    closeOnClick={!field.multiple}
                    onClick={() =>
                      field.onChange(
                        field.multiple
                          ? ticked
                            ? field.chosen.filter((one) => one !== option.value)
                            : [...field.chosen, option.value]
                          : ticked
                            ? []
                            : [option.value],
                      )
                    }
                    className={cn(
                      "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem] outline-none select-none data-[highlighted]:bg-soft-2",
                      ticked ? "text-ink" : "text-text",
                      option.count === 0 && !ticked && "text-mute",
                    )}
                  >
                    <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                      {ticked && <Check className="size-3.5" />}
                    </span>
                    {option.leading}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="shrink-0 pl-3 text-mute tabular-nums">
                      {count(option.count)}
                    </span>
                  </Menu.Item>
                )
              })}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/// "Show sold out", the one switch the Catalogue's filters carry — shared by
/// the dock and the sheet.
function SoldOutSwitch({
  facets,
  filters,
  onChange,
  stockKnown,
}: {
  facets: Facets
  filters: Filters
  onChange: (next: Filters) => void
  stockKnown: boolean
}) {
  return (
    <label className="flex min-h-9 items-center gap-3 pointer-coarse:min-h-11">
      <span className="min-w-0 flex-1 text-[0.875rem] text-ink">
        Show sold out
        {stockKnown && facets.soldOut > 0 && (
          <span className="ml-1.5 text-mute tabular-nums">
            {count(facets.soldOut)}
          </span>
        )}
      </span>
      <Switch.Root
        checked={filters.soldOut}
        disabled={!stockKnown}
        onCheckedChange={(soldOut) => onChange({ ...filters, soldOut })}
        className="relative h-[1.625rem] w-11 shrink-0 rounded-full bg-hairline-strong transition-colors duration-(--t-hover) ease-(--ease-out) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 data-[checked]:bg-accent"
      >
        <Switch.Thumb className="block size-[1.375rem] translate-x-0.5 rounded-full bg-canvas shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-(--t-panel) ease-(--ease-out) data-[checked]:translate-x-[1.25rem] motion-reduce:transition-none" />
      </Switch.Root>
    </label>
  )
}
