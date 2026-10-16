import { Popover } from "@base-ui/react/popover"
import { ArrowLeft, ChevronRight, Search, Wand2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Checkbox, Input } from "@/components/ui/field"
import { PANEL, POSITIONER } from "@/lib/filter-chrome"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What the person asked for.
export type FillPlan =
  | { readonly kind: "one"; readonly store: string }
  | { readonly kind: "even" }
  | { readonly kind: "chosen"; readonly stores: readonly string[] }

/// A store column, as the pickers name it: "C001 · Cikupa".
export interface FillStore {
  readonly id: string
  readonly code: string
  readonly label: string
}

type View = "main" | "one" | "chosen"

const ROW =
  "flex min-h-10 w-full items-center gap-3 rounded-inner px-3 text-left text-[0.9375rem] text-ink transition-colors hover:bg-soft-2 focus-visible:bg-soft-2 outline-none disabled:pointer-events-none disabled:opacity-50"

/// The Fill popover: the small wand on an article row, for that article's
/// SKUs. (A grid-wide Quick fill was tried and dropped, the owner, 2 Oct.)
export function QuickFillMenu({
  stores,
  onFill,
  onClear,
  canClear,
  article,
}: {
  stores: readonly FillStore[]
  onFill: (plan: FillPlan) => void
  onClear: () => void
  canClear: boolean
  /// The article's name, for the button's label.
  article: string
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>("main")
  const [query, setQuery] = useState("")
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === "") return stores
    return stores.filter((one) =>
      `${one.code} ${one.label}`.toLowerCase().includes(needle)
    )
  }, [stores, query])

  const close = () => setOpen(false)
  const run = (plan: FillPlan) => {
    close()
    onFill(plan)
  }
  const picked = stores.filter((one) => chosen.has(one.id)).map((one) => one.id)

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setView("main")
          setQuery("")
        }
      }}
    >
      <Popover.Trigger
        aria-label={`Fill ${article}`}
        title="Fill this article"
        className="grid size-8 shrink-0 place-items-center rounded-inner text-mute transition-colors hover:bg-hairline hover:text-ink data-[popup-open]:bg-hairline data-[popup-open]:text-ink"
      >
        <Wand2 className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={POSITIONER}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup
            className={cn(PANEL, "w-[22rem] max-w-[calc(100vw-2rem)] p-1.5")}
          >
            {view === "main" && (
              <>
                <button
                  type="button"
                  className={ROW}
                  disabled={stores.length === 0}
                  onClick={() => setView("one")}
                >
                  <span className="flex-1">Everything to one store…</span>
                  <ChevronRight className="size-4 text-mute" />
                </button>
                <button
                  type="button"
                  className={ROW}
                  disabled={stores.length === 0}
                  onClick={() => run({ kind: "even" })}
                >
                  <span className="flex-1">Split evenly across all stores</span>
                  <span className="text-[0.9375rem] text-mute tabular-nums">
                    {count(stores.length)}
                  </span>
                </button>
                <button
                  type="button"
                  className={ROW}
                  disabled={stores.length === 0}
                  onClick={() => setView("chosen")}
                >
                  <span className="flex-1">
                    Split evenly across chosen stores…
                  </span>
                  <ChevronRight className="size-4 text-mute" />
                </button>
                <div className="mx-1.5 my-1 h-px bg-hairline" />
                <button
                  type="button"
                  className={cn(ROW, "text-bad-fg")}
                  disabled={!canClear}
                  onClick={() => {
                    close()
                    onClear()
                  }}
                >
                  Clear this article
                </button>
              </>
            )}

            {view === "one" && (
              <>
                <Back label="Everything to one store" onBack={setView} />
                <div className="relative px-1.5 pb-1.5">
                  <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-mute" />
                  <Input
                    autoFocus
                    aria-label="Find a store"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || found.length === 0) return
                      event.preventDefault()
                      run({ kind: "one", store: found[0].id })
                    }}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-[16rem] overflow-y-auto">
                  {found.length === 0 ? (
                    <p className="px-3 py-2.5 text-[0.9375rem] text-mute">
                      No store matches.
                    </p>
                  ) : (
                    found.map((one) => (
                      <button
                        key={one.id}
                        type="button"
                        className={ROW}
                        onClick={() => run({ kind: "one", store: one.id })}
                      >
                        <StoreName store={one} />
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {view === "chosen" && (
              <>
                <Back label="Split across chosen stores" onBack={setView} />
                <div className="flex items-center gap-1 px-1.5 pb-1">
                  <button
                    type="button"
                    className={cn(button({ variant: "quiet", size: "sm" }))}
                    onClick={() =>
                      setChosen(new Set(stores.map((one) => one.id)))
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={cn(button({ variant: "quiet", size: "sm" }))}
                    onClick={() => setChosen(new Set())}
                  >
                    None
                  </button>
                </div>
                <div className="max-h-[16rem] overflow-y-auto">
                  {stores.map((one) => (
                    <Checkbox
                      key={one.id}
                      checked={chosen.has(one.id)}
                      onChange={(on) =>
                        setChosen((current) => {
                          const next = new Set(current)
                          if (on) next.add(one.id)
                          else next.delete(one.id)
                          return next
                        })
                      }
                      label={<StoreName store={one} />}
                      className="flex w-full [&>label]:min-h-10 [&>label]:flex-1 [&>label]:gap-3 [&>label]:rounded-inner [&>label]:px-3 [&>label]:hover:bg-soft-2"
                    />
                  ))}
                </div>
                <div className="px-1.5 pt-2 pb-1">
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={picked.length === 0}
                    onClick={() => run({ kind: "chosen", stores: picked })}
                  >
                    {picked.length === 0
                      ? "Choose stores"
                      : `Split across ${count(picked.length)} ${picked.length === 1 ? "store" : "stores"}`}
                  </Button>
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Back({
  label,
  onBack,
}: {
  label: string
  onBack: (view: View) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onBack("main")}
      className={cn(ROW, "font-medium")}
    >
      <ArrowLeft className="size-4 text-mute" />
      {label}
    </button>
  )
}

function StoreName({ store }: { store: FillStore }) {
  return (
    <span className="min-w-0 flex-1 truncate text-[0.9375rem]">
      <span className="font-medium text-ink">{store.code}</span>
      {store.label !== "" && (
        <span className="text-body"> · {store.label}</span>
      )}
    </span>
  )
}
