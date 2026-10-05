import { Warehouse } from "lucide-react"
import { useLayoutEffect, useRef } from "react"

import { cn } from "@/lib/utils"
import { initials, timezoneOf } from "@/screens/setup/names"

/// The company, drawn as it is being described.
///
/// The right half of the wizard. Every answer on the left lands here as it is
/// typed — the name on the head office, the warehouse appearing and going with
/// its switch, a tile per store with the road from the warehouse to it — so
/// the three questions read as building one thing rather than filling three
/// forms. It also carries the two facts people get wrong about this system
/// without having to write them as prose: goods reach a store from the
/// warehouse, and the books are the company's, with every store inside them.
///
/// Decoration in the sense that nothing here is pressed; not in the sense of
/// being invented. Every box is a unit or a site the server will create.

export interface MapStore {
  readonly key: string
  readonly code: string
  readonly name: string
  readonly city: string
}

const HUES = [
  "bg-a-orange",
  "bg-a-green",
  "bg-a-blue",
  "bg-a-pink",
  "bg-a-violet",
] as const

const CAPTIONS: Record<1 | 2 | 3 | 4, readonly [string, string]> = {
  1: ["This is your business", "The map fills in as you type."],
  2: [
    "Goods flow from the Gudang to the stores",
    "Each store has its own stock, cash and reports.",
  ],
  3: [
    "One chart of accounts for everything",
    "New stores join it automatically — no accounts per store.",
  ],
  4: ["All set", "Just pair the server in each store."],
}

export function BusinessMap({
  step,
  name,
  hasWarehouse,
  stores,
  books,
}: {
  step: 1 | 2 | 3 | 4
  /// The company as it will be written, legal form included. Empty until
  /// something is typed.
  name: string
  hasWarehouse: boolean
  stores: readonly MapStore[]
  /// The first open month, once the books question has been reached.
  books: string | null
}) {
  const frame = useRef<HTMLDivElement>(null)
  const wires = useRef<SVGSVGElement>(null)
  const office = useRef<HTMLDivElement>(null)
  const warehouse = useRef<HTMLDivElement>(null)
  const [title, detail] = CAPTIONS[step]

  // The roads are measured, not laid out: the tiles wrap however the pane is
  // wide, and a line has to end on the tile wherever it landed. Written to the
  // SVG directly because they are a picture of the layout, redrawn whenever it
  // moves — state would render the whole map again for every pixel of a
  // resize.
  useLayoutEffect(() => {
    const root = frame.current
    const svg = wires.current
    if (!root || !svg) return
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const draw = () => {
      const box = root.getBoundingClientRect()
      const from = (
        hasWarehouse ? warehouse.current : office.current
      )?.getBoundingClientRect()
      if (!from) return
      const sx = from.left + from.width / 2 - box.left
      const sy = from.bottom - box.top
      const paths: string[] = []
      const head = office.current?.getBoundingClientRect()
      if (hasWarehouse && head) {
        const y = head.top + head.height / 2 - box.top
        paths.push(
          `M${head.right - box.left} ${y} L${from.left - box.left} ${y}`
        )
      }
      root
        .querySelectorAll<HTMLElement>("[data-store-tile]")
        .forEach((tile) => {
          const r = tile.getBoundingClientRect()
          const tx = r.left + r.width / 2 - box.left
          const ty = r.top - box.top
          const bend = (ty - sy) / 2
          paths.push(
            `M${sx} ${sy} C${sx} ${sy + bend} ${tx} ${ty - bend} ${tx} ${ty}`
          )
        })
      svg.replaceChildren(
        ...paths.map((d) => {
          const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
          )
          path.setAttribute("d", d)
          if (!still) {
            // Goods moving: the dashes travel away from the warehouse.
            const flow = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "animate"
            )
            flow.setAttribute("attributeName", "stroke-dashoffset")
            flow.setAttribute("from", "0")
            flow.setAttribute("to", "-16")
            flow.setAttribute("dur", "1.2s")
            flow.setAttribute("repeatCount", "indefinite")
            path.appendChild(flow)
          }
          return path
        })
      )
    }
    draw()
    const watch = new ResizeObserver(draw)
    watch.observe(root)
    return () => watch.disconnect()
  }, [hasWarehouse, stores, step])

  return (
    <div className="relative min-h-full overflow-hidden bg-soft bg-[radial-gradient(var(--hairline-2)_1px,transparent_1px)] bg-size-[18px_18px]">
      <div
        ref={frame}
        className="relative flex min-h-full flex-col items-center justify-center px-10 py-12"
      >
        <svg
          ref={wires}
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full overflow-visible fill-none stroke-hairline-strong [stroke-width:1.5] [stroke-dasharray:3_5]"
        />

        <div
          key={step}
          className="max-w-90 animate-[assistant-rise_var(--t-page)_var(--ease-out)_both] text-center"
        >
          <p className="text-cell font-medium text-ink">{title}</p>
          <p className="text-meta text-body">{detail}</p>
        </div>

        <div className="relative z-10 mt-6 flex items-start gap-8">
          <div ref={office} className={node}>
            <span className="grid size-10 shrink-0 place-items-center rounded-[0.6875rem] bg-linear-135 from-avatar-from to-avatar-to text-card-title font-semibold text-ink">
              {initials(name)}
            </span>
            <span className="min-w-0">
              <b className="block truncate text-cell font-semibold text-ink">
                {name || "Business name"}
              </b>
              <span className="block text-meta text-mute">Head office</span>
              {books !== null && (
                <span className="mt-2 flex animate-[assistant-rise_var(--t-panel)_var(--ease-out)_both] flex-col items-start gap-1">
                  <span className="rounded-full bg-accent-bg px-2 text-pill text-info-fg">
                    Standard chart
                  </span>
                  <span className="rounded-full bg-ok-bg px-2 text-pill text-ok-fg">
                    {books} open
                  </span>
                </span>
              )}
            </span>
          </div>
          <div
            ref={warehouse}
            aria-hidden={!hasWarehouse}
            className={cn(
              node,
              "transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out)",
              !hasWarehouse &&
                "pointer-events-none absolute right-0 scale-95 opacity-0"
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[0.6875rem] bg-warn-bg text-warn-fg">
              <Warehouse className="size-5" />
            </span>
            <span className="min-w-0">
              <b className="block truncate text-cell font-semibold text-ink">
                Gudang
              </b>
              <span className="block text-meta text-mute">
                Same address as the office
              </span>
            </span>
          </div>
        </div>

        <div className="relative z-10 mt-14 flex max-w-160 flex-wrap justify-center gap-3">
          {stores.map((store, index) => (
            <div
              key={store.key}
              data-store-tile
              className={cn(
                "w-37 animate-[assistant-rise_var(--t-panel)_var(--ease-out)_both] rounded-card border bg-canvas px-3 py-2.5 shadow-soft transition-colors duration-(--t-panel)",
                step === 4 ? "border-ok-bg" : "border-hairline-2"
              )}
            >
              <span className="flex items-center gap-1.5 font-mono text-id text-mute">
                <i
                  className={cn(
                    "size-2 rounded-[0.1875rem]",
                    HUES[index % HUES.length]
                  )}
                />
                {store.code}
                <i
                  className={cn(
                    "ml-auto size-2 rounded-full transition-colors duration-(--t-panel)",
                    step === 4 ? "bg-ok" : "bg-hairline-2"
                  )}
                />
              </span>
              <b className="mt-0.5 block truncate text-cell font-semibold text-ink">
                {store.name}
              </b>
              <span className="mt-1 block truncate text-meta text-mute">
                {store.city.trim() === ""
                  ? "no city yet"
                  : `${store.city} · ${timezoneOf(store.city)}`}
              </span>
            </div>
          ))}
          {stores.length === 0 && (
            <div className="grid min-h-16 w-37 place-items-center rounded-card border border-dashed border-hairline-strong px-3 text-center text-meta text-mute">
              {step >= 2 ? "Type a store name…" : "Stores appear here"}
            </div>
          )}
        </div>
        <p className="mt-5 min-h-5 text-meta text-mute">
          {stores.length > 1 ? `${stores.length} stores` : ""}
        </p>
      </div>
    </div>
  )
}

const node =
  "flex w-59 items-start gap-3 rounded-[0.875rem] border border-hairline-2 bg-canvas px-4 py-3.5 shadow-soft"
