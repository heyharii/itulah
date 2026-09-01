/**
 * The palette's actual dialog — everything that needs `cmdk`.
 *
 * Split out of `command-palette.tsx` so the shell can own the ⌘K hotkey
 * without the shell pulling `cmdk` and the whole `ui/command` tree into the
 * entry chunk. The palette is mounted on every screen and opened on almost
 * none of them, which is the exact shape a lazy boundary is for.
 *
 * See `./command-palette.tsx` for how the chunk is warmed before it is needed.
 */

import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useDeferredValue, useState } from "react"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { searchQueries, type SearchHit } from "./api"
import { destinationFor } from "./routes"

export interface PaletteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * `useNavigate()` here is the global one on purpose — the palette's whole job
 * is landing on a route it does not belong to, so there is no `from` to give.
 * The hazard the rule guards against (`prev` typed as the union of every
 * route's search params) needs an updater function; this passes a literal
 * `search` object and never reads `prev`.
 */
export default function PaletteDialog({ open, onOpenChange }: PaletteDialogProps) {
  const [query, setQuery] = useState("")
  const navigate = useNavigate()

  /* The typed value drives the input; the deferred one drives the request. That
   * is the whole debounce — React holds the stale result while the new one is
   * computed, so typing never waits on a round trip and no timer has to be
   * tuned. */
  const deferred = useDeferredValue(query)

  const results = useQuery(searchQueries.global(deferred))

  /* Grouped by where each hit would land, and silently dropping anything this
   * app has no screen for — the index is shared with another client and carries
   * record types we cannot show. */
  const groups = new Map<
    string,
    { hit: SearchHit; to: string; search: Record<string, unknown> }[]
  >()
  for (const hit of results.data ?? []) {
    const destination = destinationFor(hit.type, hit.recordId)
    if (!destination) continue
    const bucket = groups.get(destination.group) ?? []
    bucket.push({ hit, to: destination.to, search: destination.search })
    groups.set(destination.group, bucket)
  }

  const go = (to: string, search: Record<string, unknown>) => {
    onOpenChange(false)
    setQuery("")
    void navigate({ to, search } as never)
  }

  const searching = deferred.trim().length >= 2
  const stale = query !== deferred

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Find an article, customer, supplier, order or person"
    >
      {/* `shouldFilter={false}` belongs on the Command root, not the dialog.
       * cmdk filters its own items by substring, and the hub has already
       * ranked these against a real index — re-filtering here would throw that
       * ordering away and hide every fuzzy match the index found. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search articles, customers, suppliers, orders, people…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {!searching && (
            <CommandEmpty>Type at least two characters.</CommandEmpty>
          )}

          {searching && results.isPending && (
            <CommandEmpty>Searching…</CommandEmpty>
          )}

          {searching && results.isError && (
            <CommandEmpty>Search is unavailable right now.</CommandEmpty>
          )}

          {searching &&
            !results.isPending &&
            !results.isError &&
            groups.size === 0 && <CommandEmpty>No matches.</CommandEmpty>}

          {[...groups.entries()].map(([group, hits]) => (
            <CommandGroup key={group} heading={group}>
              {hits.map(({ hit, to, search }) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => go(to, search)}
                  className={stale ? "opacity-60" : undefined}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">
                      {hit.title}
                    </span>
                    {hit.subtitle && (
                      <span className="block truncate font-mono text-[10.5px] text-ink-4">
                        {hit.subtitle}
                      </span>
                    )}
                  </span>
                  {hit.badge && (
                    <span className="ml-auto shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
                      {hit.badge.label}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
