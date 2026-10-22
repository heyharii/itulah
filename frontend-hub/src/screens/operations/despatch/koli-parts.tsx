import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { useQuery } from "@tanstack/react-query"
import { Box } from "lucide-react"
import { useMemo, useState } from "react"

import { DEFAULT_PACKING_PAPER } from "@/components/operations/outbound-papers"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { PhotoViewer } from "@/components/ui/photo-viewer"
import { Problem } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { Thumbnail } from "@/components/ui/thumbnail"
import { TintButton } from "@/components/ui/tint-button"
import { useColourwayFill } from "@/lib/colourway-fill"
import { clock, count, quantity, sku as skuNumber } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useCatalogue } from "@/lib/operations/catalogue"
import { koliManifestQuery } from "@/lib/operations/queries"
import { cn } from "@/lib/utils"
import type { Paper } from "@/screens/procurement/po-print"
import { PrintMenu } from "@/screens/procurement/print-menu"
import type { Koli } from "@itulah/contract"

/// The pieces of the Dispatch sheet that are not the sheet itself: the koli row,
/// the dialogs it opens, and the trip chooser (owner, 18 Oct 2026,
/// pack-sheet-options.html, Dispatch).

/// How wide each of the Dispatch dialogs stands (prototype: 480, 520, 560).
const POP_WIDTH = {
  chooser: "w-[30rem]",
  contents: "w-[32.5rem]",
  back: "w-[35rem]",
} as const

/// A small centred question card (a bottom drawer on a phone) with a head, a
/// body and a foot. The shared `Dialog` is one yes/no question with a confirm;
/// these are a chooser and a read-out, so they have their own foot.
export function Pop({
  open,
  onOpenChange,
  title,
  sub,
  children,
  foot,
  width = "chooser",
  bodyClass = "mt-4",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  sub?: React.ReactNode
  children?: React.ReactNode
  foot?: React.ReactNode
  width?: keyof typeof POP_WIDTH
  /// The gap between the head and the body, as a margin-top class.
  bodyClass?: string
}) {
  const phone = useLayout() === "phone"
  const Parts: { Title: React.ElementType } = phone ? Drawer : BaseDialog
  const body = (
    <>
      <Parts.Title className="text-card-title font-semibold text-ink">
        {title}
      </Parts.Title>
      {sub !== undefined && (
        <p className="mt-0.5 text-[0.9375rem] text-mute tabular-nums">{sub}</p>
      )}
      {children !== undefined && <div className={bodyClass}>{children}</div>}
      {foot !== undefined && (
        <div className="mt-4 flex items-center justify-end gap-4 max-md:[&>*]:h-11">
          {foot}
        </div>
      )}
    </>
  )
  if (phone) {
    return (
      <PhoneDrawer open={open} onOpenChange={onOpenChange}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {body}
        </div>
      </PhoneDrawer>
    )
  }
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-card border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100",
            POP_WIDTH[width]
          )}
        >
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// The arrow into a tray: "put it on a trip" (pack-sheet-options.html, svgInto).
function IntoTray() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v9m0 0l-3.5-3.5M12 12l3.5-3.5" />
      <path d="M4 13.5V19a2 2 0 002 2h12a2 2 0 002-2v-5.5" />
    </svg>
  )
}

/// A koli as a row: a grey box, "Koli N · code" and when it was packed, pieces
/// at the right, then one tinted button. The row itself is not pressable (unless
/// `onPress` says so, in the Back to Pick choice); the box and the name open
/// what is inside.
export function KoliRow({
  box,
  no,
  onOpen,
  action,
  leading,
  onPress,
}: {
  box: Koli
  /// The koli's number among its store's waiting koli.
  no: number
  onOpen: () => void
  action: React.ReactNode
  /// Before the box: a checkbox in a chooser.
  leading?: React.ReactNode
  /// A press anywhere on the row (the box and the name apart) does this: a
  /// chooser's row ticks and unticks.
  onPress?: () => void
}) {
  const open = (event: React.MouseEvent) => {
    // The box and the name open the contents; they do not tick the row.
    event.stopPropagation()
    onOpen()
  }
  return (
    <div
      onClick={onPress}
      className={cn(
        "flex min-h-[4.75rem] items-center gap-3.5 border-t border-hairline",
        onPress && "cursor-pointer"
      )}
    >
      {leading}
      <button
        type="button"
        aria-label={`What is inside Koli ${no}`}
        onClick={open}
        className="grid size-[2.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-mute transition-[color,scale] duration-150 ease-out active:scale-[0.95] [&_svg]:size-[1.375rem] [@media(hover:hover)]:hover:text-accent"
      >
        <Box />
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={open}
          className="block max-w-full truncate text-left font-semibold text-ink [@media(hover:hover)]:hover:underline"
        >
          Koli {no} · <span className="text-mute">{box.koli_number}</span>
        </button>
        <span className="block text-[0.9375rem] text-mute tabular-nums">
          Packed {clock(box.sealed_at)}
        </span>
      </div>
      <span className="min-w-[3.75rem] text-right text-[1.0625rem] font-semibold text-ink tabular-nums">
        {quantity(box.unit_count)}
      </span>
      {action}
    </div>
  )
}

/// Put a koli (or several) on a trip: icon and words, tinted.
export function PutOnTrip({
  onPress,
}: {
  onPress: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <Button
      variant="primary"
      size="sm"
      onClick={(event) => {
        // Not the row's own press (the Back to Pick choice has none, but a
        // row never asks twice).
        event.stopPropagation()
        onPress(event)
      }}
    >
      <IntoTray />
      Put on trip
    </Button>
  )
}

/// What is in a koli: one row per SKU (its picture, "article · colour · size",
/// its code and the pieces), then Print packing list and Close.
export function KoliContentsDialog({
  box,
  no,
  store,
  onClose,
  onPrint,
}: {
  box: Koli | null
  no: number
  store: string
  onClose: () => void
  onPrint: (koliId: string, paper: Paper) => void
}) {
  const manifest = useQuery({
    ...koliManifestQuery(box?.koli_id ?? ""),
    enabled: box !== null,
    staleTime: 60_000,
  })
  const { identities: catalogue } = useCatalogue()
  const fill = useColourwayFill()
  const [photo, setPhoto] = useState<string | null>(null)
  /// One picture per article, for a SKU that has none of its own.
  const articlePhoto = useMemo(() => {
    const byArticle = new Map<string, string>()
    for (const one of catalogue.values())
      if (one.image_url && !byArticle.has(one.article_code))
        byArticle.set(one.article_code, one.image_url)
    return byArticle
  }, [catalogue])
  const infoOf = (sku: string) => {
    const one = catalogue.get(sku)
    return {
      title:
        [one?.article_name, one?.colour, one?.size]
          .filter(Boolean)
          .join(" · ") || sku,
      url:
        one?.image_url ??
        (one ? (articlePhoto.get(one.article_code) ?? null) : null),
      name: one?.article_name ?? "",
      division: one?.division_code ?? null,
      colours: fill(one?.colour ?? null),
    }
  }
  // One row per SKU: the manifest can split a SKU across allotment lines.
  const rows = [
    ...(manifest.data?.lines ?? [])
      .reduce((bySku, line) => {
        bySku.set(
          line.sku_code,
          (bySku.get(line.sku_code) ?? 0) + line.quantity
        )
        return bySku
      }, new Map<string, number>())
      .entries(),
  ]
  const shown = photo !== null ? infoOf(photo) : null
  return (
    <>
      <Pop
        open={box !== null}
        onOpenChange={(next) => !next && onClose()}
        width="contents"
        bodyClass="mt-1.5"
        title={
          box ? (
            <>
              Koli {no} · {box.koli_number}
            </>
          ) : (
            "Koli"
          )
        }
        sub={
          box
            ? `${store} · Packed ${clock(box.sealed_at)} · ${quantity(box.unit_count)}`
            : undefined
        }
        foot={
          <>
            {box && (
              <PrintMenu
                label="Print packing list"
                defaultPaper={DEFAULT_PACKING_PAPER}
                paperKey="packing"
                onChoose={(choice) => onPrint(box.koli_id, choice.paper)}
              />
            )}
            <div className="flex-1" />
            <Button variant="ghost" className="px-5" onClick={onClose}>
              Close
            </Button>
          </>
        }
      >
        {manifest.isError ? (
          <Problem error={manifest.error} />
        ) : manifest.data === undefined ? (
          <p className="text-[0.9375rem] text-mute">Reading the koli…</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map(([sku, qty]) => {
              const one = infoOf(sku)
              return (
                <li
                  key={sku}
                  className="flex min-h-[3.75rem] items-center gap-3 border-t border-hairline py-2"
                >
                  <button
                    type="button"
                    aria-label={`Photo of ${one.title}`}
                    onClick={() => setPhoto(sku)}
                    className="shrink-0 rounded-inner transition-[box-shadow,scale] duration-150 ease-out active:scale-[0.95] [@media(hover:hover)]:hover:ring-[1.5px] [@media(hover:hover)]:hover:ring-accent"
                  >
                    <Thumbnail
                      url={one.url}
                      name={one.name}
                      division={one.division}
                      colours={one.colours}
                      className="size-11 rounded-inner"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <b className="block font-medium text-ink">{one.title}</b>
                    <span className="text-[0.9375rem] text-mute tabular-nums">
                      {skuNumber(sku)}
                    </span>
                  </div>
                  <span className="min-w-10 text-right text-[1.0625rem] font-semibold text-ink tabular-nums">
                    {count(qty)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Pop>
      <PhotoViewer
        open={photo !== null}
        onOpenChange={(next) => {
          if (!next) setPhoto(null)
        }}
        url={shown?.url ?? ""}
        name={shown?.title}
        placeholder={
          shown ? (
            <Thumbnail
              url={null}
              name={shown.name}
              division={shown.division}
              colours={shown.colours}
              className="size-72 rounded-card"
            />
          ) : undefined
        }
      />
    </>
  )
}

/// Which trip a press goes on, when there are two or more: the koli (or "All
/// in") up top, a tile per trip and a dashed "+ Trip N", and Cancel.
export function TripChooser({
  open,
  onClose,
  title,
  sub,
  trips,
  nextNo,
  onChoose,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  sub: React.ReactNode
  trips: readonly { no: number; koli: number }[]
  nextNo: number
  /// `null`: a new trip.
  onChoose: (no: number | null) => void
}) {
  return (
    <Pop
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={title}
      sub={sub}
      bodyClass="mt-[1.125rem]"
      foot={<TintButton onClick={onClose}>Cancel</TintButton>}
    >
      <div className="mb-2 text-mute">Trip</div>
      <div className="grid grid-cols-3 gap-2.5">
        {trips.map((trip) => (
          <button
            key={trip.no}
            type="button"
            onClick={() => onChoose(trip.no)}
            className="flex min-h-[4.75rem] flex-col items-start gap-0.5 rounded-card border-[1.5px] border-hairline bg-canvas px-3 py-2.5 text-left transition-[border-color,scale] duration-150 ease-out active:scale-[0.97] [&_svg]:mb-1 [&_svg]:size-[1.375rem] [&_svg]:text-mute [@media(hover:hover)]:hover:border-accent [@media(hover:hover)]:hover:[&_svg]:text-accent"
          >
            <TruckIcon />
            <b className="font-semibold text-ink">Trip {trip.no}</b>
            <span className="text-mute tabular-nums">
              {count(trip.koli)} koli
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChoose(null)}
          className="flex min-h-[4.75rem] items-center justify-center rounded-card border-[1.5px] border-dashed border-hairline bg-canvas px-3 py-2.5 font-semibold text-accent transition-[background-color,scale] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-accent-bg"
        >
          + Trip {nextNo}
        </button>
      </div>
    </Pop>
  )
}

/// The truck of a trip's tile (pack-sheet-options.html, svgTruckIc).
export function TruckIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z" />
      <circle cx="6" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </svg>
  )
}
