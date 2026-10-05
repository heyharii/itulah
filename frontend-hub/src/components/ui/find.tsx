import { Combobox } from "@base-ui/react/combobox"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronDown, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Tag } from "@/components/ui/tag"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"

/// Several things out of a catalogue too large to hold.
///
/// `<PickOne>` and `<PickMany>` choose from a vocabulary the browser already
/// has — five divisions, a dozen sizes, forty tags. This is their sibling for
/// the lists far too big for that: five hundred articles, a supplier's
/// thousands of items, every SKU in the shop. It is typed at, the server
/// answers, and what is kept is held here as chips.

/// One thing that was found, in the three parts a picker row has room for.
export interface Found {
  readonly value: string
  readonly label: string
  /// The second line — a colour and a size, a division, what it is.
  readonly note?: string
  /// The right-hand column — a price, a count.
  readonly aside?: string
}

/// A stable empty selection.
///
/// A fresh `[]` on every render is a new identity, which Base UI reads as the
/// value having changed. Same constant, same reason, as `filter-omnibox`.
const NOTHING_HELD: Found[] = []

/// Search a catalogue, keep several of it.
///
/// The chosen things are held **here**, as chips, and not by the combobox: a
/// row picked out of one search is a different object from the same row in the
/// next one, so handing Base UI a multi-select value assembled from two
/// different result sets is how a chip silently stops matching the row it came
/// from. So the control is `multiple` with a permanently empty value — every
/// press is a toggle against the list the caller holds — which is also what
/// keeps the panel open while three things are picked.
export function FindMany({
  chosen,
  onChange,
  queryKey,
  search,
  label,
  offline,
  className,
}: {
  chosen: readonly Found[]
  onChange: (next: readonly Found[]) => void
  /// The React Query key for one needle. Given by the caller because the key's
  /// first segment is its own module's namespace.
  queryKey: (needle: string) => readonly unknown[]
  search: (needle: string, signal?: AbortSignal) => Promise<readonly Found[]>
  label: string
  /// What to say when the route answers 404 rather than an empty list. Not a
  /// generic error: a picker whose endpoint is newer than the node it is
  /// talking to is an operational fact, and it has a different remedy from a
  /// search that found nothing.
  offline: string
  className?: string
}) {
  const [typed, setTyped] = useState("")
  const [open, setOpen] = useState(false)
  // The value lags the keystrokes, so one question is asked rather than six —
  // see `useDebounced`, which delays the VALUE and not the request.
  const needle = useDebounced(typed.trim(), 200)
  const ready = needle.length >= 2

  const found = useQuery({
    queryKey: queryKey(needle),
    queryFn: ({ signal }) => search(needle, signal),
    enabled: open && ready,
    // A catalogue does not change while somebody is typing at it.
    staleTime: 60 * 1000,
    // 404 is a state this has to survive rather than retry: the route can be
    // newer than the binary answering it.
    retry: false,
  })

  const rows = found.data ?? []
  const held = useMemo(() => new Set(chosen.map((one) => one.value)), [chosen])

  const toggle = (row: Found) =>
    onChange(
      held.has(row.value)
        ? chosen.filter((one) => one.value !== row.value)
        : [...chosen, row]
    )

  return (
    <Combobox.Root
      items={rows as Found[]}
      // Already filtered by the server. The built-in matcher would filter the
      // answer a second time, against the label only.
      filter={null}
      multiple
      value={NOTHING_HELD}
      onValueChange={(picked) => {
        const row = (picked as Found[])[picked.length - 1]
        if (row) toggle(row)
      }}
      inputValue={typed}
      onInputValueChange={(next, details) => {
        // Base UI empties the box on a pick, which is right for a control that
        // chooses one thing and wrong for this one: the second style somebody
        // wants is nearly always still on screen in the same list, and
        // retyping the word to get it back is the reason people give up and
        // paste codes instead.
        if (details.reason === "item-press") return
        setTyped(next)
      }}
      open={open}
      onOpenChange={(next, details) => {
        // Picking is not leaving: choosing one product says nothing about
        // whether the next one is wanted.
        if (!next && details.reason === "item-press") return
        setOpen(next)
      }}
      itemToStringLabel={(one) => (one ? (one as Found).label : "")}
      modal={false}
    >
      <Combobox.InputGroup
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-[1.125rem] border border-hairline-2 bg-canvas px-2.5 py-1.5 text-left text-[0.875rem] transition-colors",
          "hover:bg-soft-2 has-[input:focus-visible]:border-accent has-[input:focus-visible]:bg-canvas",
          className
        )}
      >
        <Search className="size-3.5 shrink-0 text-line-ico" />
        {chosen.map((one) => (
          <Tag key={one.value} tone="accent" className="gap-1">
            {one.label}
            <button
              type="button"
              aria-label={`Remove ${one.label}`}
              className="-mr-0.5 rounded-full text-accent hover:text-ink"
              onClick={(event) => {
                event.stopPropagation()
                onChange(chosen.filter((other) => other.value !== one.value))
              }}
            >
              <X className="size-2.5" />
            </button>
          </Tag>
        ))}
        <Combobox.Input
          aria-label={label}
          className="min-w-[6rem] flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        <Combobox.Trigger
          aria-label="Open"
          className="shrink-0 text-line-ico hover:text-ink"
        >
          <ChevronDown className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-[var(--anchor-width)] min-w-[16rem]"
        >
          <Combobox.Popup className={cn(POPUP, "w-full")}>
            {!ready ? (
              <Note>Two characters is enough to start.</Note>
            ) : found.isError ? (
              <Note>{offline}</Note>
            ) : found.isPending ? (
              <Note>Searching…</Note>
            ) : rows.length === 0 ? (
              <Note>Nothing matches “{needle}”.</Note>
            ) : (
              <Combobox.List>
                {rows.map((row) => (
                  <Combobox.Item
                    key={row.value}
                    value={row}
                    className={cn(ITEM, "justify-between gap-3")}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-ink">{row.label}</span>
                      {row.note && (
                        <span className="truncate text-[0.875rem] text-mute">
                          {row.note}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {row.aside && (
                        <span className="text-[0.875rem] text-mute tabular-nums">
                          {row.aside}
                        </span>
                      )}
                      {held.has(row.value) && (
                        <Check className="size-3.5 text-accent" />
                      )}
                    </span>
                  </Combobox.Item>
                ))}
              </Combobox.List>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 py-3 text-center text-[0.875rem] leading-relaxed text-mute">
      {children}
    </p>
  )
}
