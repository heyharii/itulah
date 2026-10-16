import { Dialog } from "@base-ui/react/dialog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { CornerDownLeft, Globe } from "lucide-react"
import { useMemo, useState } from "react"

import {
  allNavItems,
  hiddenModuleIds,
  isHiddenPath,
  moduleAllowed,
  moduleForPath,
} from "@/lib/navigation"
import { useIntentPreload } from "@/lib/prefetch"
import { runSearch, type SearchHit } from "@/lib/search"
import { useSections } from "@/lib/session"
import { cn } from "@/lib/utils"

/// ⌘K — jump to a screen, or find a record.
///
/// Two things are searched and they are kept visually apart, because they
/// answer different questions. **Go to** is navigation and comes from the
/// registry, so a screen added to the sidebar is findable here the same commit.
/// **Records** come from the module's own lists.
///
/// Search is **everywhere by default** (owner, 2026-10-01); Tab narrows it to
/// the module you are standing in. Across nine modules the same word names a
/// supplier, a store and an employee; an unscoped result list is a
/// disambiguation puzzle rather than an answer.
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const here = moduleForPath(pathname)
  const { sections, bypass } = useSections()

  const [query, setQuery] = useState("")
  const [everywhere, setEverywhere] = useState(true)
  const [cursor, setCursor] = useState(0)

  const needle = query.trim()

  const destinations = useMemo(() => {
    const lower = needle.toLowerCase()
    // A `soon` module's screens are declared for the sidebar, not for
    // offering: the palette must not hand somebody a jump that lands on a
    // screen that is not there.
    // Nor a jump the sidebar would not show this person: the same section
    // check, so ⌘K is not a side door into another department's screens.
    const routable = allNavItems.filter(
      (item) =>
        !item.module.soon &&
        !item.soon &&
        // Nor one this deployment leaves out of the menu (HR and GA on the
        // public demo), whoever is asking — an admin included.
        !hiddenModuleIds.has(item.module.id) &&
        moduleAllowed(item.module, sections, bypass)
    )
    const pool = everywhere
      ? routable
      : routable.filter((item) => item.module.id === here.id)
    if (!lower) return pool.slice(0, 12)
    return pool
      .filter(
        (item) =>
          item.label.toLowerCase().includes(lower) ||
          item.module.label.toLowerCase().includes(lower)
      )
      .slice(0, 12)
  }, [needle, everywhere, here.id, sections, bypass])

  /// Records are a Query of their own, so a slow list does not block the
  /// jump-to half and the answer is cached between openings.
  const records = useQuery({
    queryKey: ["search", everywhere ? "everywhere" : here.id, needle],
    queryFn: ({ signal }) =>
      runSearch(needle, everywhere ? "everywhere" : here.id, client, signal),
    enabled: open && needle.length >= 2,
    staleTime: 15_000,
  })

  const rows = useMemo(() => {
    const hits = (records.data ?? []).filter((hit) => !isHiddenPath(hit.to))
    return [
      ...destinations.map((item) => ({
        kind: "screen" as const,
        key: item.path,
        title: item.label,
        subtitle: item.module.label,
        icon: item.icon,
        go: () => navigate({ to: item.path }),
      })),
      ...hits.map((hit: SearchHit & { source: string }) => ({
        kind: "record" as const,
        key: `${hit.to}:${hit.id}`,
        title: hit.title,
        subtitle: hit.subtitle ? `${hit.source} · ${hit.subtitle}` : hit.source,
        icon: undefined,
        go: () =>
          navigate({
            to: hit.to,
            search: hit.sheet ? { [hit.sheet.key]: hit.sheet.value } : {},
          }),
      })),
    ]
  }, [destinations, records.data, navigate])

  // The cursor is reset where the list changes — in the handlers below — rather
  // than by an effect watching the query. Syncing state to state in an effect
  // renders twice and puts the highlight on the wrong row for one frame.
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  // The screen under the highlight is fetched — code and first data — once the
  // highlight rests, so Enter lands on it already warm (`lib/prefetch.ts`).
  useIntentPreload(
    open && rows[at]?.kind === "screen" ? rows[at].key : null,
    120
  )

  const dismiss = () => {
    onOpenChange(false)
    setQuery("")
    setEverywhere(false)
    setCursor(0)
  }

  const choose = (index: number) => {
    const row = rows[index]
    if (!row) return
    dismiss()
    row.go()
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        // Widening the scope is not sticky: reopening the palette in Finance
        // should search Finance. Reset on close, in the handler that already
        // runs there, rather than in an effect watching `open`.
        if (!next) {
          setQuery("")
          setEverywhere(true)
          setCursor(0)
        }
      }}
    >
      <Dialog.Portal>
        {/* The veil is white. Nothing in this system darkens. */}
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <Dialog.Popup className="fixed top-[15vh] left-1/2 z-50 w-[36rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-card border border-hairline bg-canvas shadow-float">
          <Dialog.Title className="sr-only">Search</Dialog.Title>

          {/* A form, so Enter submits natively. A `keydown` handler on the
              input is the obvious alternative and it is the wrong one: it does
              not survive an IME composition, and it competes with whatever the
              dialog does with keys of its own. */}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              choose(at)
            }}
            className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3"
          >
            {/* The scope, said out loud. A search box that quietly filters to
                one module is worse than an unscoped one: the missing results
                look like missing data. */}
            <button
              type="button"
              onClick={() => {
                setEverywhere((wide) => !wide)
                setCursor(0)
              }}
              className={cn(
                "inline-flex h-[1.625rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[0.9375rem] font-medium transition-colors",
                everywhere
                  ? "bg-accent-bg text-info-fg"
                  : "bg-soft-2 text-body hover:text-ink"
              )}
            >
              {everywhere ? <Globe className="size-3" /> : null}
              {everywhere ? "Everywhere" : here.label}
            </button>
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setCursor(0)
              }}
              onKeyDown={(event) => {
                // Arrows move the cursor; Tab widens the scope. Enter is the
                // form's, not ours.
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setCursor((now) => Math.min(now + 1, rows.length - 1))
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setCursor((now) => Math.max(now - 1, 0))
                } else if (event.key === "Tab") {
                  event.preventDefault()
                  setEverywhere((wide) => !wide)
                  setCursor(0)
                }
              }}
              // 16px under 48rem: a smaller field zooms the page on iOS when it
              // takes focus, and the palette is how a phone finds a screen.
              className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-mute max-md:text-[1rem]"
            />
            <kbd className="shrink-0 rounded-[5px] border border-hairline-2 bg-canvas px-1.5 py-px font-mono text-[0.9375rem] text-body max-md:hidden">
              tab
            </kbd>
            {/* Implicit submission already applies — one text field, nothing
                blocking it — but a real submit button is what guarantees Enter
                across browsers, and it gives a screen reader something to
                announce and activate. */}
            <button type="submit" className="sr-only">
              Open the highlighted result
            </button>
          </form>

          <div className="max-h-[24rem] overflow-y-auto py-1.5">
            {rows.length === 0 && (
              <p className="px-3.5 py-6 text-center text-meta text-body">
                {needle
                  ? everywhere
                    ? `Nothing in any module matches “${needle}”.`
                    : `Nothing in ${here.label} matches “${needle}”. Press tab to search everywhere.`
                  : "Type to search."}
              </p>
            )}

            {rows.map((row, index) => {
              const Icon = row.icon
              const first =
                row.kind === "record" && rows[index - 1]?.kind !== "record"
              return (
                <div key={row.key}>
                  {first && (
                    <div className="mt-1.5 border-t border-hairline px-3.5 pt-2.5 pb-1 text-eyebrow font-semibold text-mute uppercase">
                      Records
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors pointer-coarse:min-h-11",
                      index === at ? "bg-soft" : "hover:bg-soft"
                    )}
                  >
                    {Icon ? (
                      <Icon className="size-4 shrink-0 stroke-[1.55] text-line-ico" />
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-ink">
                      {row.title}
                    </span>
                    <span className="shrink-0 truncate text-[0.9375rem] text-mute">
                      {row.subtitle}
                    </span>
                    {index === at && (
                      <CornerDownLeft className="size-3 shrink-0 text-faint" />
                    )}
                  </button>
                </div>
              )
            })}

            {records.isFetching && needle.length >= 2 && (
              <p className="px-3.5 py-2 text-[0.9375rem] text-mute">
                Looking through {everywhere ? "every module" : here.label}…
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
